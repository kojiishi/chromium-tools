#!/usr/bin/env python3
import argparse
import logging
import os
import pathlib
import re
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
        if frequency:
            args.extend(['-F', frequency])
        self.perf = subprocess.Popen(args)
        logger.info('Profiler for pid %d started: %s', pid, args)

    def wait(self):
        logger.debug('Waiting for perf to finish...')
        self.perf.wait()
        logger.info('perf "%s" done.', self.perf_data_path)

    def pprof(self):
        args = ['pprof', '-svg', self.perf_data_path]
        subprocess.run(args)


def run(args, options):
    logger.info('Starting %s', args)
    target = subprocess.Popen(args,
                              bufsize=0,
                              stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT)
    profilers = []
    pid_pattern = re.compile(
        r'Renderer \((\d+)\) paused waiting for debugger to attach. '
        r'Send SIGUSR1 to unpause.')
    for line in iter(target.stdout.readline, b''):
        line = line.decode('utf-8')
        print(line, end='', flush=True)
        match = pid_pattern.search(line)
        if match:
            pid = int(match[1])
            profiler = Profiler(pid, frequency=options.frequency)
            profilers.append(profiler)
            os.kill(pid, signal.SIGUSR1)
            logger.info('SIGUSR1 %d', pid)
    return profilers


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('program',
                        default=os.path.join(os.environ.get('OUT'), 'chrome'))
    parser.add_argument('args', nargs='*')
    parser.add_argument('-f', '--frequency')
    options = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    args = [
        options.program,
        '--renderer-startup-dialog',
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=9999',
        '--user-data-dir=/tmp/chromium',
    ]
    args += options.args
    profilers = run(args, options)
    for profiler in profilers:
        profiler.wait()


if __name__ == '__main__':
    main()
