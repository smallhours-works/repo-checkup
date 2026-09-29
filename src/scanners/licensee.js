'use strict';

const fs = require('fs');
const path = require('path');
const { isOnPath } = require('../util/which');
const { run } = require('../util/exec');

const BIN = 'licensee';

const INSTALL = 'gem install licensee (requires Ruby)';

/**
 * License-file check. Confirmed by hands-on testing this run: licensee
 * exits 1 (not 0) when no license is confidently detected — that's a
 * normal finding for this tool, not a crash.
 */
function runLicensee({ targetRepo, outDir }) {
  if (!isOnPath(BIN)) {
    return { tool: 'licensee', status: 'missing', install: INSTALL };
  }

  const outFile = path.join(outDir, 'licensee.json');
  const result = run(BIN, ['detect', targetRepo, '--json']);

  if (result.spawnError) {
    return { tool: 'licensee', status: 'error', error: result.spawnError, timedOut: result.timedOut, durationMs: result.durationMs };
  }
  if (result.code !== 0 && result.code !== 1) {
    return {
      tool: 'licensee',
      status: 'error',
      exitCode: result.code,
      stderr: result.stderr.slice(0, 2000),
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  }

  fs.writeFileSync(outFile, result.stdout);

  return {
    tool: 'licensee',
    status: 'ok',
    exitCode: result.code,
    licenseDetected: result.code === 0,
    outputFile: outFile,
    durationMs: result.durationMs,
  };
}

module.exports = { runLicensee, BIN, INSTALL };
