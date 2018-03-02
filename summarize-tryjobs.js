#!/usr/bin/env node
'use strict';
const fs = require('fs-extra');
let log = console.log.bind(console);
const TestResults = require('./update-expectations').TestResults;

async function run() {
  let args = process.argv.slice(2);
  let by_date = new Set();
  let by_failures = [];
  let by_dirs = [];
  // Process in the reversed order to pick up the largest file name in a day.
  args.reverse();
  for (let arg of args) {
    let results = await fs.readJson(arg);

    // Pick only first result per day.
    let days_since_epoch = Math.floor(results.seconds_since_epoch / (60 * 60 * 24));
    if (by_date.has(days_since_epoch))
      continue;
    by_date.add(days_since_epoch);

    let datetime = new Date(results.seconds_since_epoch * 1000);
    log(`${datetime.toISOString()} ${results.build_number}`);
    let num_failures_by_type = results.num_failures_by_type;
    let summary = [
      datetime,
      num_failures_by_type.CRASH,
      num_failures_by_type.TIMEOUT,
      num_failures_by_type.IMAGE,
      num_failures_by_type['IMAGE+TEXT'],
      num_failures_by_type.TEXT,
    ];
    by_failures.push(summary);

    results = new TestResults(results);
    let failure_by_dir = {};
    for (let result of results) {
      if (result.actuals.is('PASS') || result.actuals.is('SKIP') || result.actuals.is('MISSING'))
        continue;
      let path = result.path
          .replace(/^fast\//, '')
          .replace(/^external\/wpt\/css\/CSS2\//, '')
          .replace(/^external\/wpt\/css\//, '')
          .replace(/^external\/wpt\//, '')
          .replace(/^virtual\//, '');
      let dir = path.split('/')[0];
      increment(failure_by_dir, dir);
    }
    by_dirs.push([datetime, failure_by_dir]);
  }

  by_failures.sort((a, b) => a[0] - b[0]);
  by_dirs.sort((a, b) => a[0] - b[0]);

  for (let row of by_failures)
    row[0] = row[0].toISOString().slice(0, 10);
  by_failures.splice(0, 0, ['Date', 'Crash', 'Timeout', 'Image', 'Image+Text', 'Text']);
  await fs.outputJson('by_failure.json', by_failures);

  // Get the list of directory name in the descending order of failures.
  let dirs = {};
  log('Sort using ' + by_dirs[by_dirs.length - 1][0]);
  let last_by_dir = by_dirs[by_dirs.length - 1][1];
  for (let dir in last_by_dir) {
    increment(dirs, dir, last_by_dir[dir]);
  }
  for (let row of by_dirs) {
    let by_dir = row[1];
    for (let dir in by_dir) {
      if (!(dir in dirs))
        dirs[dir] = 0;
    }
  }
  let dir_list = [];
  for (let dir in dirs)
    dir_list.push([dir, dirs[dir]]);
  dir_list.sort((a, b) => b[1] - a[1]);
  dirs = dir_list.map(row => row[0]);

  by_dirs = by_dirs.map(source => {
    let row = [source[0].toISOString().slice(0, 10)];
    let failure_by_dir = source[1];
    for (let dir of dirs) {
      let value = failure_by_dir[dir];
      row.push(value ? value : 0);
    }
    return row;
  });
  dirs.splice(0, 0, 'date');
  by_dirs.splice(0, 0, dirs);
  await fs.outputJson('by_dir.json', by_dirs);
}

function increment(dict, key, value = 1) {
  let current = dict[key];
  dict[key] = current ? (current + value) : value;
}

run().catch(err => {
  console.log(err);
  process.exit(1);
});
