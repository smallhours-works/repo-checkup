'use strict';

const fs = require('fs');
const path = require('path');
const { isOnPath } = require('../util/which');
const { run } = require('../util/exec');

const BIN = 'gitleaks';

const INSTALL = 'go install github.com/zricethezav/gitleaks/v8@latest ' +
  '(or download a prebuilt binary from https://github.com/gitleaks/gitleaks/releases)';

/**
 * Secret scanning. Scans git history when the target is a git repo,
 * otherwise falls back to a plain working-tree scan (--no-git).
 */
function runGitleaks({ targetRepo, outDir }) {
  if (!isOnPath(BIN)) {
    return { tool: 'gitleaks', status: 'missing', install: INSTALL };
  }

  const outFile = path.join(outDir, 'gitleaks.json');
  const isGitRepo = fs.existsSync(path.join(targetRepo, '.git'));

  const args = [
    'detect',
    '--source', targetRepo,
    '--report-format', 'json',
    '--report-path', outFile,
    '--exit-code', '0', // leaks found is a normal result, not a tool failure
    '--no-banner',
  ];
  if (!isGitRepo) args.push('--no-git');

  const result = run(BIN, args);

  if (result.spawnError) {
    return { tool: 'gitleaks', status: 'error', error: result.spawnError, timedOut: result.timedOut, durationMs: result.durationMs };
  }
  if (result.code !== 0) {
    return {
      tool: 'gitleaks',
      status: 'error',
      exitCode: result.code,
      stderr: result.stderr.slice(0, 2000),
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  }

  return {
    tool: 'gitleaks',
    status: 'ok',
    exitCode: result.code,
    scannedGitHistory: isGitRepo,
    outputFile: outFile,
    durationMs: result.durationMs,
  };
}

module.exports = { runGitleaks, BIN, INSTALL };
