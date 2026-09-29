'use strict';

const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Runs `bin args...` and returns { code, stdout, stderr, timedOut, durationMs }.
 * Never throws for a non-zero exit or a missing binary (ENOENT) — callers
 * decide what a given exit code means for that tool.
 */
function run(bin, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const start = Date.now();
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - start;

  if (result.error) {
    return {
      code: null,
      stdout: '',
      stderr: String(result.error.message || result.error),
      timedOut: result.error.code === 'ETIMEDOUT',
      durationMs,
      spawnError: result.error.code || String(result.error),
    };
  }

  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    timedOut: result.signal === 'SIGTERM' && durationMs >= timeoutMs,
    durationMs,
    spawnError: null,
  };
}

module.exports = { run, DEFAULT_TIMEOUT_MS };
