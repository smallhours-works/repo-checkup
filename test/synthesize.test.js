'use strict';

// Regression tests for src/synthesize.js. Most of these lock in bugs that
// were previously only caught by hand-running the CLI against real fixture
// repos each night — each `test()` below names the bug it
// guards against so a future regression fails loudly instead of shipping
// silently until the next manual re-check.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { synthesize, collect, severityBucket, redactSecret } = require('../src/synthesize');

function makeOutDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repo-checkup-test-'));
}

function writeJson(outDir, name, data) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

// Builds a complete index.json + raw per-tool output files in outDir, with
// every tool defaulting to a boring "ok, nothing found" result so each test
// only has to override the tool(s) it actually cares about.
function buildFixture(outDir, overrides = {}) {
  const targetRepo = overrides.targetRepo || '/home/buyer/some-repo';

  const defaults = {
    gitleaks: () => ({ tool: 'gitleaks', status: 'ok', scannedGitHistory: true, outputFile: writeJson(outDir, 'gitleaks.json', []) }),
    'osv-scanner': () => ({ tool: 'osv-scanner', status: 'ok', outputFile: writeJson(outDir, 'osv-scanner.json', { results: [] }) }),
    licensee: () => ({ tool: 'licensee', status: 'ok', outputFile: writeJson(outDir, 'licensee.json', { licenses: [], matched_files: [] }) }),
    scc: () => ({ tool: 'scc', status: 'ok', outputFile: writeJson(outDir, 'scc.json', { languageSummary: [] }) }),
    staleness: () => ({ tool: 'staleness', status: 'ok', outputFile: writeJson(outDir, 'staleness.json', { isGitRepo: false, ciConfigsFound: [] }) }),
    readme: () => ({ tool: 'readme', status: 'ok', outputFile: writeJson(outDir, 'readme.json', { found: true, filename: 'README.md', sectionsChecked: true, sections: { installation: true, usage: true, license: true } }) }),
  };

  const results = Object.keys(defaults).map((tool) => (overrides.results && overrides.results[tool]
    ? overrides.results[tool](outDir)
    : defaults[tool]()));

  writeJson(outDir, 'index.json', {
    targetRepo,
    generatedAt: '2026-09-29T00:00:00.000Z',
    results,
  });

  return outDir;
}

test('severityBucket buckets CVSS scores per NVD qualitative ranges', () => {
  assert.equal(severityBucket(9.8), 'critical');
  assert.equal(severityBucket(9), 'critical');
  assert.equal(severityBucket(8.9), 'high');
  assert.equal(severityBucket(7), 'high');
  assert.equal(severityBucket(6.9), 'medium');
  assert.equal(severityBucket(4), 'medium');
  assert.equal(severityBucket(3.9), 'low');
  assert.equal(severityBucket(0.1), 'low');
  assert.equal(severityBucket(0), 'unknown');
  assert.equal(severityBucket(null), 'unknown');
  assert.equal(severityBucket(NaN), 'unknown');
});

test('redactSecret fully hides short secrets and caps the reveal at 2 chars/side for long ones', () => {
  // <=16 chars: fully redacted, no partial reveal at all.
  assert.equal(redactSecret('short-secret-16c'.slice(0, 16)), '(redacted)');
  assert.equal(redactSecret(''), '(redacted)');
  assert.equal(redactSecret(null), '(redacted)');
  // >16 chars: reveal exactly 2 chars per side, never 4.
  const long = 'AKIAABCDEFGHIJKLMNOP'; // 20-char AWS-style key id
  assert.equal(redactSecret(long), `${long.slice(0, 2)}…${long.slice(-2)} (redacted)`);
  assert.equal(redactSecret(long), 'AK…OP (redacted)');
});

test('renderMarkdown escapes a pipe character in a table cell (gitleaks file path)', () => {
  const outDir = makeOutDir();
  buildFixture(outDir, {
    results: {
      gitleaks: () => ({
        tool: 'gitleaks',
        status: 'ok',
        scannedGitHistory: true,
        outputFile: writeJson(outDir, 'gitleaks.json', [
          { RuleID: 'generic-api-key', Description: 'Generic API Key', File: 'weird|dir/config.py', StartLine: 3, Commit: 'abc123', Secret: 'sekret' },
        ]),
      }),
    },
  });

  const report = synthesize(outDir);
  assert.match(report, /weird\\\|dir\/config\.py/);
  assert.doesNotMatch(report, /weird\|dir/);
});

test('renderMarkdown pads a longer backtick fence around a filename that itself contains a backtick', () => {
  const outDir = makeOutDir();
  const weirdName = 'LICENSE-MIT`weird';
  buildFixture(outDir, {
    results: {
      gitleaks: () => ({
        tool: 'gitleaks',
        status: 'ok',
        scannedGitHistory: true,
        outputFile: writeJson(outDir, 'gitleaks.json', [
          { RuleID: 'generic-api-key', Description: 'Generic API Key', File: weirdName, StartLine: 1, Commit: 'abc', Secret: 'sekret' },
        ]),
      }),
    },
  });

  const report = synthesize(outDir);
  // A single backtick pair would end early at the value's own backtick;
  // the fence must be at least one backtick longer than any run in the value.
  assert.match(report, /``LICENSE-MIT`weird``/);
});

test('renderMarkdown picks the highest fixed version across a grouped OSV vulnerability set', () => {
  const outDir = makeOutDir();
  buildFixture(outDir, {
    results: {
      'osv-scanner': () => ({
        tool: 'osv-scanner',
        status: 'ok',
        outputFile: writeJson(outDir, 'osv-scanner.json', {
          results: [{
            source: { path: 'package-lock.json' },
            packages: [{
              package: { name: 'lodash', version: '4.17.4', ecosystem: 'npm' },
              vulnerabilities: [
                {
                  id: 'CVE-2021-23337',
                  summary: 'Command injection in lodash',
                  affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ fixed: '4.17.21' }] }] }],
                },
                {
                  id: 'CVE-2026-4800',
                  summary: 'Prototype pollution in lodash',
                  affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ fixed: '4.18.0' }] }] }],
                },
              ],
              groups: [{ ids: ['CVE-2021-23337', 'CVE-2026-4800'], aliases: ['CVE-2021-23337', 'CVE-2026-4800'], max_severity: '7.5' }],
            }],
          }],
        }),
      }),
    },
  });

  const report = synthesize(outDir);
  const row = report.split('\n').find((l) => l.includes('lodash'));
  assert.ok(row, 'expected a lodash row in the dependency vulnerabilities table');
  assert.match(row, /4\.18\.0/);
  assert.doesNotMatch(row, /4\.17\.21/);
});

test('renderMarkdown treats licensee\'s "other" catch-all as not a confident license match', () => {
  const outDir = makeOutDir();
  buildFixture(outDir, {
    results: {
      licensee: () => ({
        tool: 'licensee',
        status: 'ok',
        outputFile: writeJson(outDir, 'licensee.json', {
          licenses: [{ key: 'other', spdx_id: 'NOASSERTION', meta: { title: null } }],
          matched_files: [{ filename: 'LICENSE' }],
        }),
      }),
    },
  });

  const report = synthesize(outDir);
  assert.match(report, /license-like file exists/);
  assert.doesNotMatch(report, /Detected: \*\*/);
});

test('renderMarkdown flags a future-dated last commit instead of printing a negative day count', () => {
  const outDir = makeOutDir();
  buildFixture(outDir, {
    results: {
      staleness: () => ({
        tool: 'staleness',
        status: 'ok',
        outputFile: writeJson(outDir, 'staleness.json', {
          isGitRepo: true,
          hasCommits: true,
          lastCommitDate: '2099-01-01T00:00:00+00:00',
          daysSinceLastCommit: -1192,
          commitsLast90Days: 3,
          commitsPrior90Days: 1,
          ciConfigsFound: [],
        }),
      }),
    },
  });

  const report = synthesize(outDir);
  assert.match(report, /dated in the future/);
  assert.doesNotMatch(report, /-1192 days ago/);
});

test('renderMarkdown reports unavailable commit-activity trend rather than "null commits" when git log --since fails', () => {
  const outDir = makeOutDir();
  buildFixture(outDir, {
    results: {
      staleness: () => ({
        tool: 'staleness',
        status: 'ok',
        outputFile: writeJson(outDir, 'staleness.json', {
          isGitRepo: true,
          hasCommits: true,
          lastCommitDate: '2026-09-01T00:00:00+00:00',
          daysSinceLastCommit: 28,
          commitsLast90Days: null,
          commitsPrior90Days: null,
          ciConfigsFound: [],
        }),
      }),
    },
  });

  const report = synthesize(outDir);
  assert.match(report, /Commit activity: unavailable/);
  assert.doesNotMatch(report, /null commits/);
});

test('renderMarkdown strips ANSI escape codes and the local target path from a tool\'s raw error text', () => {
  const outDir = makeOutDir();
  const targetRepo = '/home/buyer/secret-project';
  buildFixture(outDir, {
    targetRepo,
    results: {
      gitleaks: () => ({
        tool: 'gitleaks',
        status: 'error',
        exitCode: 1,
        stderr: `\x1b[31mfatal: could not open ${targetRepo}\x1b[0m`,
      }),
    },
  });

  const report = synthesize(outDir);
  const errorLine = report.split('\n').find((l) => l.startsWith('Not checked — Scan error'));
  assert.ok(errorLine, 'expected a "Scan error" line for the leaked-secrets section');
  assert.doesNotMatch(errorLine, /\x1b\[/);
  assert.doesNotMatch(errorLine, /secret-project/);
  assert.match(errorLine, /<target repo>/);
});

test('renderMarkdown explains a timed-out scan in plain language', () => {
  const outDir = makeOutDir();
  buildFixture(outDir, {
    results: {
      'osv-scanner': () => ({
        tool: 'osv-scanner',
        status: 'error',
        timedOut: true,
        durationMs: 300000,
      }),
    },
  });

  const report = synthesize(outDir);
  assert.match(report, /Scan timed out after 300s/);
});

test('renderMarkdown reports the highest-severity vulnerability count and no leaked secrets on an otherwise clean scan', () => {
  const outDir = makeOutDir();
  buildFixture(outDir);
  const report = synthesize(outDir);
  assert.match(report, /No leaked secrets found\./);
  assert.match(report, /No known dependency vulnerabilities found\./);
});

test('renderMarkdown reports a missing README and lists which sections are missing when one exists', () => {
  const outDir = makeOutDir();
  buildFixture(outDir, {
    results: {
      readme: () => ({
        tool: 'readme',
        status: 'ok',
        outputFile: writeJson(outDir, 'readme.json', { found: false }),
      }),
    },
  });

  const report = synthesize(outDir);
  assert.match(report, /No README found\. Worth adding one/);
  assert.match(report, /- No README found\./);
});

test('renderMarkdown lists missing README sections by name, and only the missing ones', () => {
  const outDir = makeOutDir();
  buildFixture(outDir, {
    results: {
      readme: () => ({
        tool: 'readme',
        status: 'ok',
        outputFile: writeJson(outDir, 'readme.json', {
          found: true,
          filename: 'README.md',
          sectionsChecked: true,
          sections: { installation: false, usage: true, license: false },
        }),
      }),
    },
  });

  const report = synthesize(outDir);
  assert.match(report, /README\.md.* but missing: Installation, License\./);
  assert.match(report, /- README missing: Installation, License\./);
  assert.doesNotMatch(report, /missing: .*Usage/);
});

test('renderMarkdown says section structure is unchecked (not "missing") for a README format it cannot parse, e.g. RST', () => {
  const outDir = makeOutDir();
  buildFixture(outDir, {
    results: {
      readme: () => ({
        tool: 'readme',
        status: 'ok',
        outputFile: writeJson(outDir, 'readme.json', {
          found: true,
          filename: 'README.rst',
          sectionsChecked: false,
        }),
      }),
    },
  });

  const report = synthesize(outDir);
  assert.match(report, /README\.rst.* isn't checked automatically for this README format/);
  assert.doesNotMatch(report, /README missing/);
});

test('collect() throws a clear error when index.json is missing rather than a raw ENOENT', () => {
  const outDir = makeOutDir();
  assert.throws(() => collect(outDir), /No index\.json found/);
});

test('collect()/synthesize() agree: renderMarkdown(collect(outDir)) equals synthesize(outDir)', () => {
  const outDir = makeOutDir();
  buildFixture(outDir);
  const data = collect(outDir);
  assert.equal(typeof data.gitleaks, 'object');
  assert.equal(data.targetRepo, '/home/buyer/some-repo');
  assert.equal(synthesize(outDir), require('../src/synthesize').synthesize(outDir));
});
