'use strict';

// Tests for src/runAll.js: the orchestration that calls all five scanners
// and writes index.json. Mocks the scanner modules themselves (not
// util/exec or util/which, which scanners.test.js already covers), using
// the same require.cache-substitution approach as scanners.test.js, so this
// runs with no real gitleaks/osv-scanner/licensee/scc/git binaries.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUNALL_PATH = require.resolve('../src/runAll');
const SCANNER_MODULE_PATHS = {
  gitleaks: require.resolve('../src/scanners/gitleaks'),
  osvScanner: require.resolve('../src/scanners/osvScanner'),
  scc: require.resolve('../src/scanners/scc'),
  licensee: require.resolve('../src/scanners/licensee'),
  staleness: require.resolve('../src/scanners/staleness'),
  readme: require.resolve('../src/scanners/readme'),
};
const EXPORT_NAMES = {
  gitleaks: 'runGitleaks',
  osvScanner: 'runOsvScanner',
  scc: 'runScc',
  licensee: 'runLicensee',
  staleness: 'runStaleness',
  readme: 'runReadme',
};

function fakeModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

// Runs `fn` with each scanner module replaced by a fake whose run function
// is `impls[key]` (keyed the same as SCANNER_MODULE_PATHS/EXPORT_NAMES).
// Any key left out of `impls` gets a default "ok, did nothing" fake so
// tests only need to specify the scanner(s) they care about. Restores the
// real modules afterwards no matter what, and re-requires runAll itself
// fresh each time so it picks up the fakes.
function withMockScanners(impls, fn) {
  const allPaths = [RUNALL_PATH, ...Object.values(SCANNER_MODULE_PATHS)];
  const stashed = new Map();
  for (const p of allPaths) {
    stashed.set(p, require.cache[p]);
    delete require.cache[p];
  }
  for (const [key, modPath] of Object.entries(SCANNER_MODULE_PATHS)) {
    const runFn = impls[key] || (() => ({ tool: fakeToolName(key), status: 'ok' }));
    require.cache[modPath] = fakeModule(modPath, { [EXPORT_NAMES[key]]: runFn });
  }
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

function fakeToolName(key) {
  return key === 'osvScanner' ? 'osv-scanner' : key;
}

function makeOutDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repo-checkup-runall-test-'));
}

test('runAll calls every scanner with {targetRepo, outDir} and writes their results to index.json in order', () => {
  const outDir = makeOutDir();
  const targetRepo = '/some/repo';
  const seenArgs = [];
  withMockScanners({
    gitleaks: (a) => { seenArgs.push(['gitleaks', a]); return { tool: 'gitleaks', status: 'ok' }; },
    osvScanner: (a) => { seenArgs.push(['osv-scanner', a]); return { tool: 'osv-scanner', status: 'ok' }; },
    scc: (a) => { seenArgs.push(['scc', a]); return { tool: 'scc', status: 'ok' }; },
    licensee: (a) => { seenArgs.push(['licensee', a]); return { tool: 'licensee', status: 'ok' }; },
    staleness: (a) => { seenArgs.push(['staleness', a]); return { tool: 'staleness', status: 'ok' }; },
    readme: (a) => { seenArgs.push(['readme', a]); return { tool: 'readme', status: 'ok' }; },
  }, () => {
    const { runAll } = require('../src/runAll');
    const index = runAll(targetRepo, outDir);

    assert.deepEqual(seenArgs.map(([tool]) => tool), ['gitleaks', 'osv-scanner', 'scc', 'licensee', 'staleness', 'readme']);
    for (const [, args] of seenArgs) {
      assert.deepEqual(args, { targetRepo, outDir });
    }
    assert.equal(index.targetRepo, targetRepo);
    assert.deepEqual(index.results.map((r) => r.tool), ['gitleaks', 'osv-scanner', 'scc', 'licensee', 'staleness', 'readme']);
  });
});

test('runAll creates outDir (including missing parent directories) before any scanner needs it', () => {
  const parent = makeOutDir();
  const outDir = path.join(parent, 'nested', 'out');
  withMockScanners({}, () => {
    const { runAll } = require('../src/runAll');
    assert.equal(fs.existsSync(outDir), false);
    runAll('/some/repo', outDir);
    assert.equal(fs.statSync(outDir).isDirectory(), true);
  });
});

test('runAll writes a generatedAt ISO timestamp and index.json matching the returned index', () => {
  const outDir = makeOutDir();
  withMockScanners({}, () => {
    const { runAll } = require('../src/runAll');
    const before = Date.now();
    const index = runAll('/some/repo', outDir);
    const after = Date.now();

    assert.match(index.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const parsed = Date.parse(index.generatedAt);
    assert.ok(parsed >= before && parsed <= after);

    const onDisk = JSON.parse(fs.readFileSync(path.join(outDir, 'index.json'), 'utf8'));
    assert.deepEqual(onDisk, index);
  });
});

test('runAll catches a scanner that throws synchronously and records status: error under that scanner\'s own tool key', () => {
  // Regression test for the bug documented in runAll.js's own comment: the
  // error must be keyed by the tool name each scanner *returns*
  // ("osv-scanner"), not the JS function name ("runOsvScanner") — otherwise
  // synthesize.js's findResult(index, tool) lookup silently orphans it.
  const outDir = makeOutDir();
  withMockScanners({
    osvScanner: () => { throw new Error('boom: scanner crashed'); },
  }, () => {
    const { runAll } = require('../src/runAll');
    const index = runAll('/some/repo', outDir);

    const osvResult = index.results.find((r) => r.tool === 'osv-scanner');
    assert.ok(osvResult, 'expected a result keyed "osv-scanner", not "runOsvScanner" or similar');
    assert.equal(osvResult.status, 'error');
    assert.equal(osvResult.error, 'boom: scanner crashed');

    // The other five still ran normally despite one throwing.
    assert.deepEqual(
      index.results.filter((r) => r.tool !== 'osv-scanner').map((r) => r.status),
      ['ok', 'ok', 'ok', 'ok', 'ok']
    );
  });
});

test('runAll stringifies a non-Error thrown value rather than crashing', () => {
  const outDir = makeOutDir();
  withMockScanners({
    licensee: () => { throw 'a plain string throw'; },
  }, () => {
    const { runAll } = require('../src/runAll');
    const index = runAll('/some/repo', outDir);
    const licenseeResult = index.results.find((r) => r.tool === 'licensee');
    assert.equal(licenseeResult.status, 'error');
    assert.equal(licenseeResult.error, 'a plain string throw');
  });
});
