const assert = require('assert');
const path = require('path');

const target = require('../update-expectations');
const parseArgs = target.parseArgs;
const setArgs = target.setArgs;
const TestExpectation = target.TestExpectation;
const TestResult = target.TestResult;
const TestResults = target.TestResults;
const TestResultTypes = target.TestResultTypes;

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
    const parseTryResults = TestResults.parseTryResults;
    it('parse', function () {
      let args = parseTryResults(
`[
  {
    "result": "FAILURE",
    "status": "COMPLETED",
    "url": "http://test.org/builds/4001"
  },
  {
    "result": "SUCCESS",
    "status": "COMPLETED",
    "url": "http://test.org/builds/4004"
  }
]`);
      assert.deepEqual(args, ['4001', '4004']);
    });
  });
});

describe('TestResultTypes', function() {
  it('ctor', function () {
    assert.deepEqual(new TestResultTypes().types, []);
    assert.deepEqual(new TestResultTypes("").types, []);
    assert.deepEqual(new TestResultTypes(" ").types, []);
    assert.deepEqual(new TestResultTypes("a b").types, ['a', 'b']);
    assert.deepEqual(new TestResultTypes(" a b ").types, ['a', 'b']);
    assert.deepEqual(new TestResultTypes(['a', 'b']).types, ['a', 'b']);
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
  it('actualExpectations', function () {
    let result = new TestResult('test', {
      actual: 'PASS IMAGE IMAGE+TEXT TEXT CRASH TIMEOUT MISSING SKIP'
    });
    assert.deepEqual(result.actualExpectations,
		     [ 'Pass', 'Failure', 'Failure', 'Failure', 'Crash', 'Timeout', 'Skip' ]);
  });

  [
    {path:'test.html', actual:'IMAGE',
     expect:[{source: 'test-actual.png', dest: 'test-expected.png'}]},
    {path:'test.html', actual:'TEXT',
     expect:[{source: 'test-actual.txt', dest: 'test-expected.txt'}]},
    {path:'test.html', actual:'IMAGE+TEXT',
     expect:[{source: 'test-actual.png', dest: 'test-expected.png'},
	     {source: 'test-actual.txt', dest: 'test-expected.txt'}]},
  ].forEach(data => it(`rebaselineDataFromActual ${data.actual}`, function () {
    let result = new TestResult(data.path);
    let download = Array.from(result.rebaselineDataFromActual(data.actual));
    assert.deepEqual(download, data.expect);
  }));
});

describe('deflake', function() {
  function deflakeTest(expects, actual, args = []) {
    setArgs(args);
    let expectation = new TestExpectation('', 'path', expects);
    expectation.addActualExpectations(actual);
    expectation.deflake();
    return expectation;
  }

  it('fail', function () {
    let expectation = deflakeTest([ 'Failure' ], [ 'Failure' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations.toArray(), [ 'Failure' ]);
  });

  it('deflake', function () {
    let expectation = deflakeTest([ 'Crash', 'Failure', 'Pass' ],
				  [ 'Failure' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations.toArray(), [ 'Failure' ]);
  });

  it('flaky', function () {
    let expectation = deflakeTest([ 'Crash', 'Failure' ],
				  [ 'Crash', 'Failure', 'Pass' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations.toArray(), [ 'Crash', 'Failure' ]);
  });

  it('fixed', function () {
    let expectation = deflakeTest([ 'Failure' ], [ 'Pass' ]);
    assert(expectation.isRemoved);
  });

  it('no-confirm should be no-op', function () {
    let expectation = deflakeTest([ 'Failure' ], []);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations.toArray(), [ 'Failure' ]);
  });

  it('pass-only should not be deflaked', function () {
    let expectation = deflakeTest([ 'Pass' ], [ 'Failure' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations.toArray(), [ 'Pass' ]);
  });
});
