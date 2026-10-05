'use strict';

// Direct tests for the two lowest-level primitives every scanner wrapper is
// built on: util/which.js's isOnPath and util/exec.js's run. These use real
// subprocesses (echo, sleep, a nonexistent binary) rather than mocks, since
// they're cheap, deterministic, and are exactly the layer scanners.test.js
// assumes behaves this way when it mocks them out.

const test = require('node:test');
const assert = require('node:assert/strict');

const { run } = require('../src/util/exec');
const { isOnPath } = require('../src/util/which');

test('isOnPath finds a real binary on PATH', () => {
  assert.equal(isOnPath('ls'), true);
});

test('isOnPath returns false for a binary that does not exist', () => {
  assert.equal(isOnPath('definitely-not-a-real-binary-abcxyz123'), false);
});

test('run captures stdout and a zero exit code for a real command', () => {
  const result = run('echo', ['hello']);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), 'hello');
  assert.equal(result.timedOut, false);
  assert.equal(result.spawnError, null);
});

test('run reports spawnError (ENOENT) for a missing binary rather than throwing', () => {
  const result = run('definitely-not-a-real-binary-abcxyz123', []);
  assert.equal(result.code, null);
  assert.equal(result.spawnError, 'ENOENT');
  assert.equal(result.timedOut, false);
});

test('run reports timedOut for a command that outlives its timeout', () => {
  const result = run('sleep', ['2'], { timeoutMs: 150 });
  assert.equal(result.timedOut, true);
  assert.equal(result.spawnError, 'ETIMEDOUT');
});
