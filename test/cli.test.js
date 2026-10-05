'use strict';

// Tests for src/cli.js: argument parsing (parseArgs) and the main() entry
// point's control flow (help/usage/error exit codes, and the happy path
// wiring runAll's output into synthesize's report.md). main() calls the
// real runAll/synthesize by requiring them itself, so this mocks both
// modules via the same require.cache-substitution approach scanners.test.js
// and runAll.test.js use, rather than running real scanners.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs, USAGE } = require('../src/cli');

const CLI_PATH = require.resolve('../src/cli');
const RUNALL_PATH = require.resolve('../src/runAll');
const SYNTHESIZE_PATH = require.resolve('../src/synthesize');

function fakeModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

// Runs `fn` with `./runAll` and `./synthesize` replaced by fakes, for a
// freshly-required src/cli.js. Restores the real modules afterwards.
function withMocks({ runAll, synthesize }, fn) {
  const allPaths = [CLI_PATH, RUNALL_PATH, SYNTHESIZE_PATH];
  const stashed = new Map();
  for (const p of allPaths) {
    stashed.set(p, require.cache[p]);
    delete require.cache[p];
  }
  require.cache[RUNALL_PATH] = fakeModule(RUNALL_PATH, { runAll });
  require.cache[SYNTHESIZE_PATH] = fakeModule(SYNTHESIZE_PATH, { synthesize, collect: () => ({}) });
  try {
    return fn();
  } finally {
    for (const p of allPaths) {
      const original = stashed.get(p);
      if (original) require.cache[p] = original;
      else delete require.cache[p];
    }
  }
}

// Captures console.log/console.error output and process.exitCode across a
// call to `fn`, restoring both afterwards — main() never calls
// process.exit() itself, but it does set process.exitCode, which would
// otherwise leak into this test file's own exit status.
function captureRun(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const log = [];
  const errorLog = [];
  console.log = (...args) => log.push(args.join(' '));
  console.error = (...args) => errorLog.push(args.join(' '));
  process.exitCode = undefined;
  try {
    fn();
    return { log, errorLog, exitCode: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repo-checkup-cli-test-'));
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs reads a bare target with no flags', () => {
  const args = parseArgs(['../some-repo']);
  assert.equal(args.target, '../some-repo');
  assert.equal(args.out, null);
  assert.equal(args.help, undefined);
  assert.deepEqual(args.extra, []);
});

test('parseArgs reads --out and its value regardless of position', () => {
  assert.equal(parseArgs(['repo', '--out', 'dest']).out, 'dest');
  assert.equal(parseArgs(['--out', 'dest', 'repo']).out, 'dest');
});

test('parseArgs recognizes -h and --help', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['repo', '--help']).help, true);
});

test('parseArgs treats the first non-flag argument as target and later ones as extra', () => {
  const args = parseArgs(['repo', 'other', 'third']);
  assert.equal(args.target, 'repo');
  assert.deepEqual(args.extra, ['other', 'third']);
});

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

test('main prints usage and exits 0 on --help, without running anything', () => {
  withMocks({
    runAll: () => { throw new Error('runAll should not be called'); },
    synthesize: () => { throw new Error('synthesize should not be called'); },
  }, () => {
    const { main } = require('../src/cli');
    const { log, exitCode } = captureRun(() => main(['--help']));
    assert.equal(exitCode, 0);
    assert.ok(log.join('\n').includes('Usage: repo-checkup'));
  });
});

test('main prints usage and exits 1 when no target is given', () => {
  withMocks({}, () => {
    const { main } = require('../src/cli');
    const { log, exitCode } = captureRun(() => main([]));
    assert.equal(exitCode, 1);
    assert.ok(log.join('\n').includes(USAGE));
  });
});

test('main exits 1 with an error when given unexpected extra arguments', () => {
  withMocks({
    runAll: () => { throw new Error('runAll should not be called'); },
  }, () => {
    const { main } = require('../src/cli');
    const dir = makeDir();
    const { errorLog, exitCode } = captureRun(() => main([dir, 'unexpected']));
    assert.equal(exitCode, 1);
    assert.ok(errorLog.some((line) => line.includes('unexpected extra argument')));
    assert.ok(errorLog.some((line) => line.includes('unexpected')));
  });
});

test('main exits 1 when the target does not exist', () => {
  withMocks({}, () => {
    const { main } = require('../src/cli');
    const missing = path.join(os.tmpdir(), 'repo-checkup-does-not-exist-xyz');
    const { errorLog, exitCode } = captureRun(() => main([missing]));
    assert.equal(exitCode, 1);
    assert.ok(errorLog.some((line) => line.includes('is not a directory')));
  });
});

test('main exits 1 when the target is a file, not a directory', () => {
  withMocks({}, () => {
    const { main } = require('../src/cli');
    const dir = makeDir();
    const file = path.join(dir, 'somefile.txt');
    fs.writeFileSync(file, 'hi');
    const { errorLog, exitCode } = captureRun(() => main([file]));
    assert.equal(exitCode, 1);
    assert.ok(errorLog.some((line) => line.includes('is not a directory')));
  });
});

test('main resolves the target and out dir, calls runAll then synthesize, and writes report.md', () => {
  const target = makeDir();
  const outParent = makeDir();
  const outDir = path.join(outParent, 'out');
  let runAllArgs;
  let synthesizeArg;
  withMocks({
    runAll: (targetRepo, outDirArg) => {
      runAllArgs = { targetRepo, outDirArg };
      fs.mkdirSync(outDirArg, { recursive: true }); // real runAll does this; report.md is written after
      return { results: [{ tool: 'gitleaks', status: 'ok' }] };
    },
    synthesize: (outDirArg) => {
      synthesizeArg = outDirArg;
      return '# fake report\n';
    },
  }, () => {
    const { main } = require('../src/cli');
    const { log, exitCode } = captureRun(() => main([target, '--out', outDir]));

    assert.equal(exitCode, undefined);
    assert.equal(runAllArgs.targetRepo, path.resolve(target));
    assert.equal(runAllArgs.outDirArg, path.resolve(outDir));
    assert.equal(synthesizeArg, path.resolve(outDir));

    const reportFile = path.join(path.resolve(outDir), 'report.md');
    assert.equal(fs.readFileSync(reportFile, 'utf8'), '# fake report\n');
    assert.ok(log.some((line) => line.includes('gitleaks')));
    assert.ok(log.some((line) => line.includes(reportFile)));
  });
});

test('main defaults --out to ./.repo-checkup/<timestamp> under the current working directory', () => {
  const target = makeDir();
  let capturedOutDir;
  withMocks({
    runAll: (targetRepo, outDirArg) => {
      capturedOutDir = outDirArg;
      fs.mkdirSync(outDirArg, { recursive: true });
      return { results: [] };
    },
    synthesize: () => '',
  }, () => {
    const { main } = require('../src/cli');
    captureRun(() => main([target]));
    const defaultParent = path.join(process.cwd(), '.repo-checkup');
    assert.ok(capturedOutDir.startsWith(defaultParent));
    // Clean up the directory main() actually created via fs.writeFileSync's report.md
    // (and its now-empty parent, so repeat `npm test` runs don't accumulate clutter
    // in the repo root — it's gitignored either way, but there's no reason to leave it).
    fs.rmSync(defaultParent, { recursive: true, force: true });
  });
});

test('main renders each scanner status line: ok, no-targets, missing, and a generic error', () => {
  const target = makeDir();
  const outDir = path.join(makeDir(), 'out');
  withMocks({
    runAll: (targetRepo, outDirArg) => {
      fs.mkdirSync(outDirArg, { recursive: true });
      return {
        results: [
          { tool: 'gitleaks', status: 'ok' },
          { tool: 'osv-scanner', status: 'no-targets', note: 'no manifest files found' },
          { tool: 'licensee', status: 'missing', install: 'brew install licensee' },
          { tool: 'scc', status: 'error', exitCode: 2 },
        ],
      };
    },
    synthesize: () => '',
  }, () => {
    const { main } = require('../src/cli');
    const { log } = captureRun(() => main([target, '--out', outDir]));
    const text = log.join('\n');
    assert.match(text, /gitleaks\s+ok/);
    assert.match(text, /osv-scanner\s+skipped — no manifest files found/);
    assert.match(text, /licensee\s+NOT INSTALLED — install with: brew install licensee/);
    assert.match(text, /scc\s+ERROR — exit 2/);
  });
});
