const target = require('../update-expectations');
const assert = require('assert');

describe('parseArgs', function () {
  const parseArgs = target.parseArgs;
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
