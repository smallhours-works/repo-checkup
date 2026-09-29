'use strict';

const path = require('path');
const fs = require('fs');
const { isOnPath } = require('../util/which');
const { run } = require('../util/exec');

const BIN = 'osv-scanner';

const INSTALL = 'go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest ' +
  '(or download a prebuilt binary from https://github.com/google/osv-scanner/releases)';

// osv-scanner's own exit codes (confirmed by hands-on testing this run):
//   0   — scanned, no known vulnerabilities
//   1   — scanned, vulnerabilities found (report written)
//   127 — could not load a vulnerability database (e.g. no network on a
//         machine with no cached db yet for that ecosystem) — a real error
//   128 — no package manifests/lockfiles found to scan (not a failure)
const NO_TARGETS_EXIT_CODE = 128;

/**
 * Dependency vulnerability scan (JS/Node + Python, or anything else OSV
 * covers via lockfiles it finds). Runs with --offline so the target repo's
 * package names/versions never go out over the network on scan itself;
 * --download-offline-databases fetches/refreshes only the OSV vulnerability
 * data (per ecosystem actually found, e.g. npm or PyPI, not everything) into
 * osv-scanner's own local cache (~/.cache/osv-scalibr by default) and is a
 * no-op once that cache is already fresh. So only the very first scan of a
 * given ecosystem on a machine needs network; every scan after that,
 * including of a different repo, is fully offline. Confirmed hands-on this
 * run: first run downloaded and cached (~200MB for npm, ~34MB for PyPI,
 * both only fetched because a fixture using that ecosystem was scanned),
 * a second run against a fresh fixture reused the cache with no download,
 * and a run with no network available and no cache yet for that ecosystem
 * fails clearly (exit 127) rather than hanging or silently skipping.
 */
function runOsvScanner({ targetRepo, outDir }) {
  if (!isOnPath(BIN)) {
    return { tool: 'osv-scanner', status: 'missing', install: INSTALL };
  }

  const outFile = path.join(outDir, 'osv-scanner.json');
  const args = [
    'scan', 'source',
    '--recursive',
    '-r', targetRepo,
    '--format', 'json',
    '--output-file', outFile,
    '--offline',
    '--download-offline-databases',
  ];

  const result = run(BIN, args);

  if (result.spawnError) {
    return { tool: 'osv-scanner', status: 'error', error: result.spawnError, timedOut: result.timedOut, durationMs: result.durationMs };
  }
  if (result.code === NO_TARGETS_EXIT_CODE) {
    return {
      tool: 'osv-scanner',
      status: 'no-targets',
      note: 'No dependency manifests/lockfiles found under the target path.',
      durationMs: result.durationMs,
    };
  }
  if (result.code !== 0 && result.code !== 1) {
    return {
      tool: 'osv-scanner',
      status: 'error',
      exitCode: result.code,
      stderr: result.stderr.slice(0, 2000),
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  }

  return {
    tool: 'osv-scanner',
    status: 'ok',
    exitCode: result.code,
    vulnerabilitiesFound: result.code === 1,
    outputFile: fs.existsSync(outFile) ? outFile : null,
    durationMs: result.durationMs,
  };
}

module.exports = { runOsvScanner, BIN, INSTALL };
