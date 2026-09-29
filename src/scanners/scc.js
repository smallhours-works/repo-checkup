'use strict';

const fs = require('fs');
const path = require('path');
const { isOnPath } = require('../util/which');
const { run } = require('../util/exec');

const BIN = 'scc';

const INSTALL = 'go install github.com/boyter/scc/v3@latest ' +
  '(or download a prebuilt binary from https://github.com/boyter/scc/releases)';

/**
 * Size/complexity/COCOMO counts, written as JSON to a file (scc has no
 * built-in --output flag for JSON, so stdout is captured and written by us).
 */
function runScc({ targetRepo, outDir }) {
  if (!isOnPath(BIN)) {
    return { tool: 'scc', status: 'missing', install: INSTALL };
  }

  const outFile = path.join(outDir, 'scc.json');
  // json2 (vs. plain json) adds the COCOMO effort-estimate totals
  // (estimatedCost/estimatedScheduleMonths/estimatedPeople) alongside the
  // same per-language languageSummary array — needed for the report's
  // size/complexity section.
  const result = run(BIN, [targetRepo, '--format', 'json2']);

  if (result.spawnError) {
    return { tool: 'scc', status: 'error', error: result.spawnError, timedOut: result.timedOut, durationMs: result.durationMs };
  }
  if (result.code !== 0) {
    return {
      tool: 'scc',
      status: 'error',
      exitCode: result.code,
      stderr: result.stderr.slice(0, 2000),
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  }

  fs.writeFileSync(outFile, result.stdout);

  return {
    tool: 'scc',
    status: 'ok',
    exitCode: result.code,
    outputFile: outFile,
    durationMs: result.durationMs,
  };
}

module.exports = { runScc, BIN, INSTALL };
