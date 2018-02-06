const assert = require('assert');
const path = require('path');

const target = require('../update-expectations');
const parseArgs = target.parseArgs;
const setArgs = target.setArgs;
const TestExpectation = target.TestExpectation;
const TestResult = target.TestResult;
const TestResults = target.TestResults;

const resultsPath = path.join(__dirname, 'full_results.json');

describe('parseArgs', function () {
  describe('bug', function () {
    it('123', function () {
      let options = parseArgs(['-b', '123']);
      assert.equal(options.bug, 'crbug.com/123');
    });
  });

  describe('expects', function () {
    it('default', function () {
      let options = parseArgs([]);
      assert.deepEqual(options.expects, { Pass: 0, Failure: 0, Crash: 0, Timeout: 0 });
    });
    it('none', function () {
      let options = parseArgs(['-e=']);
      assert.deepEqual(options.expects, {});
    });
    it('exclude', function () {
      let options = parseArgs(['-e=-Pass']);
      assert.deepEqual(options.expects, { Failure: 0, Crash: 0, Timeout: 0 });
    });
    it('set', function () {
      let options = parseArgs(['-e=Failure,Crash']);
      assert.deepEqual(options.expects, { Failure: 0, Crash: 0 });
    });
  });

  describe('tryResults', function () {
    const parseTryResults = target.parseTryResults;
    it('one', function () {
      let args = parseTryResults(
`  linux_layout_tests_layout_ng  http://build/linux_layout_tests_layout_ng/builds/3241
`.split(/\n/));
      assert.deepEqual(args, ['3241']);
    });
    it('states', function () {
      let args = parseTryResults(
`Success:
  linux_layout_tests_layout_ng  http://build/linux_layout_tests_layout_ng/builds/3240
  linux_layout_tests_layout_ng  http://build/linux_layout_tests_layout_ng/builds/3241
Failures:
  linux_layout_tests_layout_ng  http://build/linux_layout_tests_layout_ng/builds/3242
Started:
  linux_layout_tests_layout_ng  http://build/linux_layout_tests_layout_ng/builds/3243
`.split(/\n/));
      assert.deepEqual(args, ['3240', '3241', '3242']);
    });
  });
});

describe('TestResults', function() {
  it('load', async function () {
    const results = await TestResults.load(resultsPath);
  });

  it('result', async function () {
    const results = await TestResults.load(resultsPath);
    const result = results.result('dir1/subdir/reftest.html');
    assert.equal(result.time, 0.3);
  });

  it('results', async function () {
    const results = await TestResults.load(resultsPath);
    let actual = [];
    for (let result of results) {
      actual.push(result);
    }
    assert.equal(actual.length, 3);
    let reftest = actual[0];
    assert.equal(reftest.path, 'dir1/subdir/reftest.html');
    assert(reftest.isRefTest);

    let unexpected = actual[1];
    assert.equal(unexpected.path, 'dir1/subdir/unexpected.html');
    assert(!unexpected.isRefTest);

    let flaky = actual[2];
    assert.equal(flaky.path, 'dir2/flaky.html');
    assert(!flaky.isRefTest);
  });
});

describe('TestResult', function() {
  it('actualExpectations', async function () {
    let result = new TestResult('test', {
      actual: 'PASS IMAGE IMAGE+TEXT TEXT CRASH TIMEOUT MISSING SKIP'
    });
    assert.deepEqual(result.actualExpectations,
		     [ 'Pass', 'Failure', 'Failure', 'Failure', 'Crash', 'Timeout', 'Skip' ]);
  });
});

describe('deflake', function() {
  function deflakeTest(expects, actual, args = []) {
    setArgs(args);
    let expectation = new TestExpectation('', 'path', expects);
    expectation.addActual(actual);
    expectation.deflake();
    return expectation;
  }

  it('fail', function () {
    let expectation = deflakeTest([ 'Failure' ], [ 'Failure' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations, [ 'Failure' ]);
  });

  it('deflake', function () {
    let expectation = deflakeTest([ 'Crash', 'Failure', 'Pass' ],
				  [ 'Failure' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations, [ 'Failure' ]);
  });

  it('flaky', function () {
    let expectation = deflakeTest([ 'Crash', 'Failure' ],
				  [ 'Crash', 'Failure', 'Pass' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations, [ 'Crash', 'Failure' ]);
  });

  it('fixed', function () {
    let expectation = deflakeTest([ 'Failure' ], [ 'Pass' ]);
    assert(expectation.isRemoved);
  });

  it('no-confirm should be no-op', function () {
    let expectation = deflakeTest([ 'Failure' ], []);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations, [ 'Failure' ]);
  });

  it('pass-only should not be deflaked', function () {
    let expectation = deflakeTest([ 'Pass' ], [ 'Failure' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations, [ 'Pass' ]);
  });
});
