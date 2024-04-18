#!/usr/bin/env python3
#
# A tool for profiling Chromium renderer processes.
#
# Also see:
# https://source.chromium.org/chromium/chromium/src/+/main:docs/profiling.md
# https://source.chromium.org/chromium/chromium/src/+/main:docs/linux/profiling.md
#
import argparse
import logging
import os
import re
import shlex
import signal
import subprocess
import sys

logger = logging.getLogger('crprof')


class Profiler(object):
    def __init__(self, pid, frequency=None):
        self.pid = pid
        self.perf_data_path = f'perf-{pid}.data'
        args = [
            'perf', 'record', '-g', '-p',
            str(pid), '-o', self.perf_data_path
        ]
        # On virtualized systems, the PMU counters may not be available or may
        # be broken. b/313526654
        args.extend(['-e', 'cpu-clock'])
        if frequency:
            args.extend(['-F', frequency])
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


class Profilers(object):
    def __init__(self) -> None:
        self.profilers = []

    def run(self):
        args = [
            self.target,
            '--renderer-startup-dialog',
            '--no-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
            '--remote-debugging-port=9999',
            '--user-data-dir=/tmp/chromium',
        ]
        args += self.args
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
        for line in iter(target.stdout.readline, ''):
            print(line, end='', flush=True)
            match = pid_pattern.search(line)
            if match:
                pid = int(match[1])
                profiler = Profiler(pid, frequency=self.frequency)
                profilers.append(profiler)
                os.kill(pid, signal.SIGUSR1)
                logger.info('SIGUSR1 %d', pid)
        for profiler in profilers:
            profiler.wait()
        self.profilers = profilers

    def interactive(self):
        for profiler in self.profilers:
            profiler.is_done = False
        while True:
            for i, profiler in enumerate(self.profilers):
                print(f'{"*" if profiler.is_done else " "} '
                      f'{i + 1}: {profiler.perf_data_path} '
                      f'{os.stat(profiler.perf_data_path).st_size:10,}')
            print(' -*: Set options (e.g., "-web -show_from=BlockNode::Layout")')
            print(' +*: Add "-*" to the current options')
            print(' /*: Remove "-*" from the current options')
            print('  q: Quit, ^C: Keep data and exit')
            prompt = (f'Run "pprof {shlex.join(self.pprof)}" for: ')
            print(prompt, end='', flush=True)
            line = sys.stdin.readline().rstrip()
            if not line:
                continue
            if line == 'q':
                break
            if line[0] == '-':
                self.pprof = shlex.split(line)
                continue
            if line[0] == '+':
                self.pprof.extend(shlex.split('-' + line[1:]))
                continue
            if line[0] == '/':
                for option in shlex.split('-' + line[1:]):
                    try:
                        self.pprof.remove(option)
                    except ValueError:
                        print(f'The "{option}" is not in the current options: '
                              f'{self.pprof}')
                continue
            try:
                i = int(line) - 1
                profiler = self.profilers[i]
                profiler.pprof(options=self.pprof)
                profiler.is_done = True
            except ValueError:
                print(f'"{line}" not recognized.')
        for profiler in self.profilers:
            os.unlink(profiler.perf_data_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-t', '--target',
                        default=os.path.join(os.environ.get('OUT'), 'chrome'))
    parser.add_argument('-F', '--frequency', help='perf frequency')
    parser.add_argument('--pprof', default=['-web'], help='pprof options', nargs='*')
    parser.add_argument('args', nargs='*')
    profilers = Profilers()
    parser.parse_args(namespace=profilers)
    logging.basicConfig(level=logging.INFO)
    profilers.run()
    profilers.interactive()


if __name__ == '__main__':
    main()
