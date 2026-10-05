'use strict';

const fs = require('fs');
const path = require('path');

const { runGitleaks } = require('./scanners/gitleaks');
const { runOsvScanner } = require('./scanners/osvScanner');
const { runScc } = require('./scanners/scc');
const { runLicensee } = require('./scanners/licensee');
const { runStaleness } = require('./scanners/staleness');
const { runReadme } = require('./scanners/readme');

const CHECKS = [
  { tool: 'gitleaks', run: runGitleaks },
  { tool: 'osv-scanner', run: runOsvScanner },
  { tool: 'scc', run: runScc },
  { tool: 'licensee', run: runLicensee },
  { tool: 'staleness', run: runStaleness },
  { tool: 'readme', run: runReadme },
];

/**
 * Runs every check against targetRepo, writing each tool's raw output into
 * outDir and an index.json summarizing what ran. No synthesis here — that's
 * the next build step (PROJECT.md build step 3).
 */
function runAll(targetRepo, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  const results = CHECKS.map(({ tool, run }) => {
    try {
      return run({ targetRepo, outDir });
    } catch (err) {
      // The tool key here must match the one each scanner itself returns
      // (used by synthesize.js's findResult(index, tool) lookup) — falling
      // back to the check function's own JS name (e.g. "runGitleaks"
      // instead of "gitleaks") would silently orphan this error: it stays
      // in index.json under a key nothing looks up, and report.md — the
      // actual deliverable, unlike the CLI's own terminal output — renders
      // "Not checked — Check did not run" with no trace of what happened.
      // Confirmed hands-on this run: a forced synchronous throw inside a
      // scanner produced exactly that silent gap in report.md before this
      // fix, while the CLI's own stdout showed the real error line.
      return { tool, status: 'error', error: String(err && err.message || err) };
    }
  });

  const index = {
    targetRepo,
    generatedAt: new Date().toISOString(),
    results,
  };
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));

  return index;
}

module.exports = { runAll };
