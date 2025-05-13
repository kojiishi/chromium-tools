#!/usr/bin/env python3
#
# A tool for profiling Chromium renderer processes.
#
# Also see:
# https://source.chromium.org/chromium/chromium/src/+/main:docs/profiling.md
# https://source.chromium.org/chromium/chromium/src/+/main:docs/linux/profiling.md
#
import argparse
import json
import logging
import os
import re
import shlex
import signal
from types import SimpleNamespace
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger('crprof')


class Profiler(object):
    def __init__(self, pid, perf_record_options=None):
        self.pid = pid
        self.perf_data_path = f'perf-{pid}.data'
        args = [
            'perf', 'record', '-g', '-p',
            str(pid), '-o', self.perf_data_path
        ]
        if perf_record_options:
            args.extend(perf_record_options)
        self.perf = subprocess.Popen(args)
        logger.info('Profiler for pid %d started: %s', pid, shlex.join(args))

    def wait(self):
        logger.debug('Waiting for perf to finish...')
        self.perf.wait()
        logger.info('perf "%s" done.', self.perf_data_path)

    def pprof(self, options=['-web']):
        args = ['pprof']
        args += options
        args.append(self.perf_data_path)
        logger.info('Running %s', args)
        subprocess.run(args)

    @staticmethod
    def get_perf_record_options(cli_args):
        options = []
        if cli_args.frequency:
            options.extend(['-F', cli_args.frequency])
        if cli_args.event:
            options.extend(['-e', cli_args.event])
        return options

class Profilers(object):
    def __init__(self) -> None:
        self.options = SimpleNamespace(pprof=['-web'])
        self.profilers = []

    def run(self):
        options = self.options
        args = [
            options.target,
            '--renderer-startup-dialog',
            '--no-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
            '--remote-debugging-port=9999',
            '--user-data-dir=/tmp/chromium',
        ]
        args += options.args
        logger.info('Starting: %s', shlex.join(args))
        target = subprocess.Popen(args,
                                stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT,
                                text=True)
        profilers = []
        pid_pattern = re.compile(
            r'Renderer \((\d+)\) paused waiting for debugger to attach. '
            r'Send SIGUSR1 to unpause.')
        perf_record_options = Profiler.get_perf_record_options(options)
        for line in iter(target.stdout.readline, ''):
            print(line, end='', flush=True)
            match = pid_pattern.search(line)
            if match:
                pid = int(match[1])
                profiler = Profiler(pid, perf_record_options)
                profilers.append(profiler)
                os.kill(pid, signal.SIGUSR1)
                logger.info('SIGUSR1 %d', pid)
        for profiler in profilers:
            profiler.wait()
        self.profilers = profilers

    def interactive(self):
        options = self.options
        for profiler in self.profilers:
            profiler.is_done = False
        while True:
            for i, profiler in enumerate(self.profilers):
                if not os.path.exists(profiler.perf_data_path):
                    logger.warning(f'{profiler.perf_data_path} not found')
                    continue
                print(f'{"*" if profiler.is_done else " "} '
                      f'{i + 1}: {profiler.perf_data_path} '
                      f'{os.stat(profiler.perf_data_path).st_size:10,}')
            print(' -*: Set options (e.g., "-web -show_from=BlockNode::Layout")')
            print(' +*: Add "-*" to the current options')
            print(' /*: Remove "-*" from the current options')
            print('  s: Substitute strings in the current options')
            print('  q: Quit, ^C: Keep data and exit')
            prompt = (f'Run "pprof {shlex.join(self.options.pprof)}" for: ')
            print(prompt, end='', flush=True)
            line = sys.stdin.readline().rstrip()
            if not line:
                continue
            if line == 'q':
                break
            if line[0] == '-':
                options.pprof = shlex.split(line)
                continue
            if line[0] == '+':
                options.pprof.extend(shlex.split('-' + line[1:]))
                continue
            if line[0] == '/':
                for option in shlex.split('-' + line[1:]):
                    try:
                        options.pprof.remove(option)
                    except ValueError:
                        print(f'The "{option}" is not in the current options: '
                              f'{options.pprof}')
                continue
            if line[0] == 's':
                match = re.match(r'/([^/]*)/([^/]*)/?$', line[1:])
                if match:
                    old = match.group(1)
                    new = match.group(2)
                    options.pprof = [i.replace(old, new) for i in options.pprof]
                    continue
            try:
                i = int(line) - 1
                profiler = self.profilers[i]
                profiler.pprof(options=options.pprof)
                profiler.is_done = True
            except ValueError:
                print(f'"{line}" not recognized.')
        for profiler in self.profilers:
            if not os.path.exists(profiler.perf_data_path):
                logger.warning(f'{profiler.perf_data_path} not found')
                continue
            os.unlink(profiler.perf_data_path)

    @staticmethod
    def settings_path() -> Path:
        return Path.home() / '.config/crprof.json'

    def load_settings(self):
        path = self.settings_path()
        if not path.exists(): return
        with path.open() as fp:
            self.options = json.load(fp, object_hook=lambda d: SimpleNamespace(**d))

    def save_settings(self):
        path = self.settings_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('w') as fp:
            json.dump(self.options, fp, indent=2, default=lambda d: d.__dict__)


def main():
    profilers = Profilers()
    profilers.load_settings()
    options = profilers.options
    parser = argparse.ArgumentParser()
    parser.add_argument('-t', '--target', default=os.environ.get('OUT'))
    parser.add_argument('-F', '--frequency', help='perf frequency')
    # On virtualized systems, the PMU counters may not be available or may
    # be broken. Use `-e cpu-clock`. b/313526654
    parser.add_argument('-e', '--event', help='The PMU event for `perf`')
    parser.add_argument('--pprof', default=options.pprof, help='pprof options', nargs='*')
    parser.add_argument('args', nargs='*')
    parser.parse_args(namespace=options)

    logging.basicConfig(level=logging.INFO)
    if os.path.isdir(options.target):
        options.target = os.path.join(options.target, 'chrome')

    for (name, value) in options.__dict__.items():
        logger.info('Option %s: %s', name, value)

    profilers.run()
    profilers.interactive()
    profilers.save_settings()


if __name__ == '__main__':
    main()
