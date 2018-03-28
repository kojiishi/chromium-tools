#!/usr/bin/env node
'use strict';
const fs = require('fs-extra');
const path = require('path');
let log = console.log.bind(console);
let debug = () => {};
const TestResults = require('./update-expectations').TestResults;

class Summarizer {
  async run() {
    let args = process.argv.slice(2);
    let by_date = new Set();
    let rows = [];
    let intradays = [];

    // Process in the reversed order to pick up the largest file name in a day.
    args.sort((a, b) => parseInt(path.basename(b)) - parseInt(path.basename(a)));
    for (let arg of args) {
      let results = await fs.readJson(arg);

      // Pick only first result per day.
      let days_since_epoch = Math.floor(results.seconds_since_epoch / (60 * 60 * 24));
      if (by_date.has(days_since_epoch)) {
        intradays.push(arg);
        continue;
      }
      by_date.add(days_since_epoch);

      rows.push(this.rowFromJson(results));
    }
    await fs.outputFile('intraday.txt', intradays.join('\n') + '\n')

    rows.sort((a, b) => a[0] - b[0]);
    for (let row of rows)
      row[0] = row[0].toISOString().slice(0, 10);

    let by_types = this.toByTypes(rows);
    await fs.outputJson('by_failure.json', by_types, {spaces: '\t'});

    let by_dirs = this.toByDirectories(rows);
    await fs.outputJson('by_dir.json', by_dirs, {spaces: '\t'});
  }

  rowFromJson(results) {
    let datetime = new Date(results.seconds_since_epoch * 1000);
    log(`${results.build_number} ${datetime.toISOString()}`);
    results = new TestResults(results);
    let by_type = {};
    let by_dir = {};
    let base_failures = [];
    let failures = 0;
    for (let result of results) {
      let actuals = result.actuals;
      let failure = actuals.severestFailure;
      if (!failure)
        continue;
      if (!result.isFlagSpecificFailure) {
        debug(`Ignored due to failure in base: ${result.path}`);
        base_failures.push(result.path);
        continue;
      }
      failures++;
      increment(by_type, failure);
      let path = result.path
          .replace(/^css3\//, '')
          .replace(/^fast\//, '')
          .replace(/^external\/wpt\/css\/CSS2\//, '')
          .replace(/^external\/wpt\/css\//, '')
          .replace(/^external\/wpt\//, '')
          .replace(/^virtual\//, '');
      let dir = path.split('/')[0];
      increment(by_dir, dir);
    }
    log(`${failures} failures, ${base_failures.length} ignored due to failures in base.`);
    return [datetime, by_type, by_dir];
  }

  toByTypes(rows) {
    let by_types = [['Date', 'Crash', 'Timeout', 'Image', 'Image+Text', 'Text']];
    for (let row of rows) {
      let by_type = row[1];
      by_types.push([row[0], by_type.CRASH, by_type.TIMEOUT,
                     by_type.IMAGE, by_type['IMAGE+TEXT'], by_type.TEXT])
    }
    return by_types;
  }

    // Get the list of directory name in the descending order of failures.
  directoryList(rows) {
    let last_row = rows[rows.length - 1];
    log('Sort directory name using ' + last_row[0]);
    let last_by_dir = last_row[2];
    let dirs = {};
    for (let dir in last_by_dir)
      increment(dirs, dir, last_by_dir[dir]);
    for (let row of rows) {
      let by_dir = row[2];
      for (let dir in by_dir) {
        if (!(dir in dirs))
          dirs[dir] = 0;
      }
    }
    let dir_list = [];
    for (let dir in dirs)
      dir_list.push([dir, dirs[dir]]);
    dir_list.sort((a, b) => b[1] - a[1]);
    return dir_list.map(row => row[0]);
  }

  toByDirectories(rows) {
    let dirs = this.directoryList(rows);
    let by_dirs = [['date'].concat(dirs)];
    for (let source of rows) {
      let by_dir = source[2];
      let row = [source[0]];
      for (let dir of dirs) {
        row.push(by_dir[dir] || 0);
      }
      by_dirs.push(row);
    }
    return by_dirs;
  }
}

function increment(dict, key, value = 1) {
  let current = dict[key];
  dict[key] = current ? (current + value) : value;
}

new Summarizer().run().catch(err => {
  console.log(err);
  process.exit(1);
});
