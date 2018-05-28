const assert = require('assert');
const path = require('path');

const target = require('../update-expectations');
const parseArgs = target.parseArgs;
const setArgs = target.setArgs;
const Options = target.Options;
const StringList = target.StringList;
const TestExpectation = target.TestExpectation;
const TestResult = target.TestResult;
const TestResults = target.TestResults;
const TestResultTypes = target.TestResultTypes;

const resultsPath = path.join(__dirname, 'full_results.json');

describe('Options', function () {
  const options = new Options;
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
        let args = parseTryResults(`[
          { "result": "FAILURE", "status": "COMPLETED", "url": "http://test.org/builds/4001" },
          { "result": "SUCCESS", "status": "COMPLETED", "url": "http://test.org/builds/4004" } ]`);
        assert.deepEqual(args, ['4001', '4004']);
      });

      it('not completed', function () {
        let args = parseTryResults(`[
          { "result": "FAILURE", "status": "COMPLETED", "url": "http://test.org/builds/4001" },
          { "result": null, "status": "STARTED", "url": "http://test.org/builds/4001" },
          { "result": "SUCCESS", "status": "COMPLETED", "url": "http://test.org/builds/4004" } ]`);
        assert.deepEqual(args, ['4001', '4004']);
      });

      it('sort', function () {
        let args = parseTryResults(`[
          { "result": "SUCCESS", "status": "COMPLETED", "url": "http://test.org/builds/4004" },
          { "result": "SUCCESS", "status": "COMPLETED", "url": "http://test.org/builds/900" },
          { "result": "SUCCESS", "status": "COMPLETED", "url": "http://test.org/builds/4001" } ]`);
        assert.deepEqual(args, ['900', '4001', '4004']);
      });
    });
  });

  it('baselineDirs', function () {
    assert.deepEqual(Array.from(options.baselineDirs(null, null)),
                     ['']);
    assert.deepEqual(Array.from(options.baselineDirs([], [])),
                     ['']);
    assert.deepEqual(Array.from(options.baselineDirs(['a', 'b'], null)),
                     ['platform/a', 'platform/b',
                      '']);
    assert.deepEqual(Array.from(options.baselineDirs(null, ['a'])),
                     ['flag-specific/a',
                      '']);
  });
  it('checkPng', async function () {
    assert.equal(await options.checkPng(path.join(__dirname, '1x1.png')), true);
    assert.equal(await options.checkPng(__filename), false);
    assert.equal(await options.checkPng(path.join(__dirname, 'not-exist')), false);
  });
});

describe('StringList', function() {
  it('push', function () {
    let list = new StringList([1, 2]);
    list.push(5);
    assert.deepEqual(list.items, [1, 2, 5]);
  });
  it('push-array', function () {
    let list = new StringList([1, 2]);
    list.push([5, 6]);
    assert.deepEqual(list.items, [1, 2, 5, 6]);
  });
  it('push-list', function () {
    let list = new StringList([1, 2]);
    list.push(new StringList([5, 6]));
    assert.deepEqual(list.items, [1, 2, 5, 6]);
  });
});

describe('TestResultTypes', function() {
  it('ctor', function () {
    assert.deepEqual(new TestResultTypes().items, []);
    assert.deepEqual(new TestResultTypes("").items, []);
    assert.deepEqual(new TestResultTypes(" ").items, []);
    assert.deepEqual(new TestResultTypes("a b").items, ['a', 'b']);
    assert.deepEqual(new TestResultTypes(" a b ").items, ['a', 'b']);
    assert.deepEqual(new TestResultTypes(['a', 'b']).items, ['a', 'b']);
  });
  it('is', function () {
    assert.equal(new TestResultTypes().is('Pass'), false);
    assert.equal(new TestResultTypes(['Pass']).is('Pass'), true);
    assert.equal(new TestResultTypes(['Pass', 'Failure']).is('Pass'), false);
    assert.equal(new TestResultTypes(['Failure', 'Pass']).is('Pass'), false);
  });
  it('has', function () {
    assert.equal(new TestResultTypes().has('Pass'), false);
    assert.equal(new TestResultTypes(['Pass']).has('Pass'), true);
    assert.equal(new TestResultTypes(['Pass', 'Failure']).has('Pass'), true);
    assert.equal(new TestResultTypes(['Failure', 'Pass']).has('Pass'), true);
  });
  it('hasFailure', function () {
    assert.equal(new TestResultTypes().hasFailure, false);
    assert.equal(new TestResultTypes(['Pass']).hasFailure, false);
    assert.equal(new TestResultTypes(['Pass', 'Failure']).hasFailure, true);
    assert.equal(new TestResultTypes(['Failure', 'Pass']).hasFailure, true);
  });
  it('severestFailure', function () {
    assert.equal(new TestResultTypes().severestFailure, null);
    assert.equal(new TestResultTypes(['PASS']).severestFailure, null);
    assert.equal(new TestResultTypes(['PASS', 'CRASH']).severestFailure, 'CRASH');
    assert.equal(new TestResultTypes(['IMAGE+TEXT', 'CRASH']).severestFailure, 'CRASH');
    assert.equal(new TestResultTypes(['PASS', 'IMAGE+TEXT']).severestFailure, 'IMAGE+TEXT');
  });
  it('failureExtensions', function () {
    assert.deepEqual(Array.from(new TestResultTypes([]).failureExtensions()),
                     []);
    assert.deepEqual(Array.from(new TestResultTypes(['IMAGE']).failureExtensions()),
                     ['.png']);
    assert.deepEqual(Array.from(new TestResultTypes(['TEXT']).failureExtensions()),
                     ['.txt']);
    assert.deepEqual(Array.from(new TestResultTypes(['IMAGE+TEXT']).failureExtensions()),
                     ['.png', '.txt']);
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
    assert.deepEqual(
        result.actuals.toExpectations().toArray(),
        [ 'Pass', 'Failure', 'Failure', 'Failure', 'Crash', 'Timeout' ]);
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
    let download = Array.from(result.rebaselineDataFromActual(new TestResultTypes(data.actual)));
    assert.deepEqual(download, data.expect);
  }));
});

describe('deflake', function() {
  function deflakeTest(expects, actuals, args = []) {
    setArgs(args);
    let expectation = new TestExpectation('', 'path', expects);
    expectation.addActuals(new TestResultTypes(actuals));
    expectation.deflake();
    return expectation;
  }

  it('fail', function () {
    let expectation = deflakeTest([ 'Failure' ], [ 'IMAGE' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations.toArray(), [ 'Failure' ]);
  });

  it('deflake', function () {
    let expectation = deflakeTest([ 'Crash', 'Failure', 'Pass' ],
                                  [ 'IMAGE' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations.toArray(), [ 'Failure' ]);
  });

  it('flaky', function () {
    let expectation = deflakeTest([ 'Crash', 'Failure' ],
                                  [ 'CRASH', 'IMAGE', 'PASS' ]);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations.toArray(), [ 'Crash', 'Failure' ]);
  });

  it('fixed', function () {
    let expectation = deflakeTest([ 'Failure' ], [ 'PASS' ]);
    assert(expectation.isRemoved);
  });

  it('no-confirm should be no-op', function () {
    let expectation = deflakeTest([ 'Failure' ], []);
    assert(!expectation.isRemoved);
    assert.deepEqual(expectation.expectations.toArray(), [ 'Failure' ]);
  });
});
