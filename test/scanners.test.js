'use strict';

// Tests for the five scanner wrappers (src/scanners/*.js) against mocked
// `run`/`isOnPath`, so these run with no real gitleaks/osv-scanner/licensee/
// scc/git binaries installed and no network. Real behavior of `run`/
// `isOnPath` themselves is covered separately in util.test.js.
//
// node:test's built-in `mock` only stubs individual functions/methods, not
// whole `require()`d modules — and mocking child_process.spawnSync itself
// wouldn't reach these wrappers anyway, since util/exec.js and util/which.js
// destructure `spawnSync` at require time (module.spawnSync = fn doesn't
// change an already-bound local reference). Module mocking (`node:test`'s
// `mock.module`) exists but needs Node >=22.3 plus an experimental flag,
// which would break this package's stated `engines: >=18` and its
// zero-npm-install philosophy for anyone else running `npm test`. So this
// substitutes fake `../util/exec` and `../util/which` modules directly into
// `require.cache` before each scanner is required, then deletes every
// affected module from the cache afterwards so later tests (and any other
// test file) get the real modules back.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXEC_PATH = require.resolve('../src/util/exec');
const WHICH_PATH = require.resolve('../src/util/which');
const SCANNER_PATHS = [
  require.resolve('../src/scanners/gitleaks'),
  require.resolve('../src/scanners/osvScanner'),
  require.resolve('../src/scanners/licensee'),
  require.resolve('../src/scanners/scc'),
  require.resolve('../src/scanners/staleness'),
];

function fakeModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

// Runs `fn` with `../util/exec`'s `run` and `../util/which`'s `isOnPath`
// replaced by the given fakes, for whichever scanner module `fn` requires
// fresh inside itself. Restores the real modules afterwards no matter what.
function withMocks({ run, isOnPath }, fn) {
  const stashed = new Map();
  for (const p of [EXEC_PATH, WHICH_PATH, ...SCANNER_PATHS]) {
    stashed.set(p, require.cache[p]);
    delete require.cache[p];
  }
  require.cache[EXEC_PATH] = fakeModule(EXEC_PATH, { run, DEFAULT_TIMEOUT_MS: 5 * 60 * 1000 });
  require.cache[WHICH_PATH] = fakeModule(WHICH_PATH, { isOnPath });
  try {
    return fn();
  } finally {
    for (const p of [EXEC_PATH, WHICH_PATH, ...SCANNER_PATHS]) {
      const original = stashed.get(p);
      if (original) require.cache[p] = original;
      else delete require.cache[p];
    }
  }
}

function makeTargetRepo({ git = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-checkup-scanner-test-'));
  if (git) fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function makeOutDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repo-checkup-scanner-out-'));
}

const okRun = () => ({ code: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1, spawnError: null });

// ---------------------------------------------------------------------------
// gitleaks
// ---------------------------------------------------------------------------

test('runGitleaks reports "missing" when the binary is not on PATH, without invoking run', () => {
  withMocks({ isOnPath: () => false, run: () => { throw new Error('run should not be called'); } }, () => {
    const { runGitleaks } = require('../src/scanners/gitleaks');
    const result = runGitleaks({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'missing');
    assert.match(result.install, /gitleaks/);
  });
});

test('runGitleaks passes --no-git for a non-git target and reports scannedGitHistory: false', () => {
  let capturedArgs;
  withMocks({
    isOnPath: () => true,
    run: (bin, args) => { capturedArgs = args; return okRun(); },
  }, () => {
    const { runGitleaks } = require('../src/scanners/gitleaks');
    const result = runGitleaks({ targetRepo: makeTargetRepo({ git: false }), outDir: makeOutDir() });
    assert.equal(result.status, 'ok');
    assert.equal(result.scannedGitHistory, false);
    assert.ok(capturedArgs.includes('--no-git'));
  });
});

test('runGitleaks omits --no-git for a git target and reports scannedGitHistory: true', () => {
  let capturedArgs;
  withMocks({
    isOnPath: () => true,
    run: (bin, args) => { capturedArgs = args; return okRun(); },
  }, () => {
    const { runGitleaks } = require('../src/scanners/gitleaks');
    const result = runGitleaks({ targetRepo: makeTargetRepo({ git: true }), outDir: makeOutDir() });
    assert.equal(result.scannedGitHistory, true);
    assert.ok(!capturedArgs.includes('--no-git'));
  });
});

test('runGitleaks surfaces a spawnError as status: error', () => {
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: null, stdout: '', stderr: '', timedOut: false, durationMs: 1, spawnError: 'ENOENT' }),
  }, () => {
    const { runGitleaks } = require('../src/scanners/gitleaks');
    const result = runGitleaks({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'error');
    assert.equal(result.error, 'ENOENT');
  });
});

test('runGitleaks treats a nonzero exit code as status: error and caps stderr at 2000 chars', () => {
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 2, stdout: '', stderr: 'x'.repeat(3000), timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runGitleaks } = require('../src/scanners/gitleaks');
    const result = runGitleaks({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'error');
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.length, 2000);
  });
});

// ---------------------------------------------------------------------------
// osv-scanner
// ---------------------------------------------------------------------------

test('runOsvScanner reports "missing" when not on PATH', () => {
  withMocks({ isOnPath: () => false, run: () => { throw new Error('should not run'); } }, () => {
    const { runOsvScanner } = require('../src/scanners/osvScanner');
    const result = runOsvScanner({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'missing');
  });
});

test('runOsvScanner exit 128 ("no lockfiles found") is status: no-targets, not an error', () => {
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 128, stdout: '', stderr: '', timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runOsvScanner } = require('../src/scanners/osvScanner');
    const result = runOsvScanner({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'no-targets');
  });
});

test('runOsvScanner exit 127 (vuln db could not load) is a real error, not folded into no-targets', () => {
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 127, stdout: '', stderr: 'could not load database', timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runOsvScanner } = require('../src/scanners/osvScanner');
    const result = runOsvScanner({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'error');
    assert.equal(result.exitCode, 127);
  });
});

test('runOsvScanner exit 0 is ok with vulnerabilitiesFound: false', () => {
  withMocks({ isOnPath: () => true, run: () => okRun() }, () => {
    const { runOsvScanner } = require('../src/scanners/osvScanner');
    const result = runOsvScanner({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'ok');
    assert.equal(result.vulnerabilitiesFound, false);
  });
});

test('runOsvScanner exit 1 is ok with vulnerabilitiesFound: true and outputFile set only if the file actually exists', () => {
  const outDir = makeOutDir();
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 1, stdout: '', stderr: '', timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runOsvScanner } = require('../src/scanners/osvScanner');

    const withoutFile = runOsvScanner({ targetRepo: makeTargetRepo(), outDir });
    assert.equal(withoutFile.vulnerabilitiesFound, true);
    assert.equal(withoutFile.outputFile, null);

    fs.writeFileSync(path.join(outDir, 'osv-scanner.json'), '{}');
    const withFile = runOsvScanner({ targetRepo: makeTargetRepo(), outDir });
    assert.equal(withFile.outputFile, path.join(outDir, 'osv-scanner.json'));
  });
});

// ---------------------------------------------------------------------------
// licensee
// ---------------------------------------------------------------------------

test('runLicensee reports "missing" when not on PATH', () => {
  withMocks({ isOnPath: () => false, run: () => { throw new Error('should not run'); } }, () => {
    const { runLicensee } = require('../src/scanners/licensee');
    const result = runLicensee({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'missing');
  });
});

test('runLicensee exit 1 ("no license confidently detected") is ok, not an error, and still writes the output file', () => {
  const outDir = makeOutDir();
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 1, stdout: '{"licenses":[]}', stderr: '', timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runLicensee } = require('../src/scanners/licensee');
    const result = runLicensee({ targetRepo: makeTargetRepo(), outDir });
    assert.equal(result.status, 'ok');
    assert.equal(result.licenseDetected, false);
    assert.equal(fs.readFileSync(path.join(outDir, 'licensee.json'), 'utf8'), '{"licenses":[]}');
  });
});

test('runLicensee exit 0 is ok with licenseDetected: true', () => {
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 0, stdout: '{"licenses":["MIT"]}', stderr: '', timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runLicensee } = require('../src/scanners/licensee');
    const result = runLicensee({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.licenseDetected, true);
  });
});

test('runLicensee treats any other exit code as status: error', () => {
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 2, stdout: '', stderr: 'boom', timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runLicensee } = require('../src/scanners/licensee');
    const result = runLicensee({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'error');
    assert.equal(result.exitCode, 2);
  });
});

// ---------------------------------------------------------------------------
// scc
// ---------------------------------------------------------------------------

test('runScc reports "missing" when not on PATH', () => {
  withMocks({ isOnPath: () => false, run: () => { throw new Error('should not run'); } }, () => {
    const { runScc } = require('../src/scanners/scc');
    const result = runScc({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'missing');
  });
});

test('runScc writes stdout to scc.json on a zero exit', () => {
  const outDir = makeOutDir();
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 0, stdout: '{"languageSummary":[]}', stderr: '', timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runScc } = require('../src/scanners/scc');
    const result = runScc({ targetRepo: makeTargetRepo(), outDir });
    assert.equal(result.status, 'ok');
    assert.equal(fs.readFileSync(path.join(outDir, 'scc.json'), 'utf8'), '{"languageSummary":[]}');
  });
});

test('runScc treats a nonzero exit as status: error (scc has no "expected nonzero" case, unlike licensee/osv-scanner)', () => {
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 1, stdout: '', stderr: 'boom', timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runScc } = require('../src/scanners/scc');
    const result = runScc({ targetRepo: makeTargetRepo(), outDir: makeOutDir() });
    assert.equal(result.status, 'error');
  });
});

// ---------------------------------------------------------------------------
// staleness (no isOnPath/run at all for the non-git path; git-backed paths
// mock `run` for every `git log` invocation staleness.js makes)
// ---------------------------------------------------------------------------

test('runStaleness on a non-git target notes that and never calls run', () => {
  const outDir = makeOutDir();
  withMocks({ isOnPath: () => { throw new Error('should not be called'); }, run: () => { throw new Error('should not be called'); } }, () => {
    const { runStaleness } = require('../src/scanners/staleness');
    const result = runStaleness({ targetRepo: makeTargetRepo({ git: false }), outDir });
    assert.equal(result.status, 'ok');
    const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
    assert.equal(data.isGitRepo, false);
  });
});

test('runStaleness reports "missing" when the target is a git repo but git itself is not on PATH', () => {
  withMocks({ isOnPath: () => false, run: () => { throw new Error('should not be called'); } }, () => {
    const { runStaleness } = require('../src/scanners/staleness');
    const result = runStaleness({ targetRepo: makeTargetRepo({ git: true }), outDir: makeOutDir() });
    assert.equal(result.status, 'missing');
  });
});

test('runStaleness treats git\'s "does not have any commits yet" as a real empty-repo finding, not an error', () => {
  const outDir = makeOutDir();
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 128, stdout: '', stderr: "fatal: your current branch 'main' does not have any commits yet", timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runStaleness } = require('../src/scanners/staleness');
    const result = runStaleness({ targetRepo: makeTargetRepo({ git: true }), outDir });
    assert.equal(result.status, 'ok');
    const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
    assert.equal(data.hasCommits, false);
  });
});

test('runStaleness surfaces a git failure unrelated to an empty repo (e.g. dubious ownership) as status: error, not a false "no commits" finding', () => {
  withMocks({
    isOnPath: () => true,
    run: () => ({ code: 128, stdout: '', stderr: 'fatal: detected dubious ownership in repository', timedOut: false, durationMs: 1, spawnError: null }),
  }, () => {
    const { runStaleness } = require('../src/scanners/staleness');
    const result = runStaleness({ targetRepo: makeTargetRepo({ git: true }), outDir: makeOutDir() });
    assert.equal(result.status, 'error');
  });
});

test('runStaleness computes daysSinceLastCommit and separates the 90-day windows by their --since/--until args', () => {
  const outDir = makeOutDir();
  // `runStaleness` computes daysSinceLastCommit against the real Date.now()
  // (no clock injection), so the mocked commit timestamp must be relative
  // to the real current time too — a timestamp pinned to a hardcoded date
  // drifts by one day for every real day that passes since it was written.
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  withMocks({
    isOnPath: () => true,
    run: (bin, args) => {
      if (args.includes('-1')) {
        return { code: 0, stdout: `${tenDaysAgo}\n`, stderr: '', timedOut: false, durationMs: 1, spawnError: null };
      }
      const isRecentWindow = args.some((a) => a === '--since=90 days ago') && !args.some((a) => a.startsWith('--until'));
      const isPriorWindow = args.some((a) => a === '--since=180 days ago') && args.some((a) => a === '--until=90 days ago');
      if (isRecentWindow) {
        return { code: 0, stdout: 'aaa one\nbbb two\n', stderr: '', timedOut: false, durationMs: 1, spawnError: null };
      }
      if (isPriorWindow) {
        return { code: 0, stdout: 'ccc three\n', stderr: '', timedOut: false, durationMs: 1, spawnError: null };
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    },
  }, () => {
    const { runStaleness } = require('../src/scanners/staleness');
    const result = runStaleness({ targetRepo: makeTargetRepo({ git: true }), outDir });
    assert.equal(result.status, 'ok');
    const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
    assert.equal(data.hasCommits, true);
    assert.equal(data.daysSinceLastCommit, 10);
    assert.equal(data.commitsLast90Days, 2);
    assert.equal(data.commitsPrior90Days, 1);
  });
});

// ---------------------------------------------------------------------------
// readme (plain fs, no subprocess at all — no withMocks needed)
// ---------------------------------------------------------------------------

test('runReadme reports found: false when no README file exists', () => {
  const targetRepo = makeTargetRepo();
  const outDir = makeOutDir();
  const { runReadme } = require('../src/scanners/readme');
  const result = runReadme({ targetRepo, outDir });
  assert.equal(result.status, 'ok');
  const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(data.found, false);
});

test('runReadme finds README.md case-insensitively and reports which sections it has', () => {
  const targetRepo = makeTargetRepo();
  fs.writeFileSync(path.join(targetRepo, 'Readme.md'), [
    '# My Project',
    '',
    '## Installation',
    'npm install',
    '',
    '## Usage',
    'run it',
  ].join('\n'));
  const outDir = makeOutDir();
  const { runReadme } = require('../src/scanners/readme');
  const result = runReadme({ targetRepo, outDir });
  assert.equal(result.status, 'ok');
  const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(data.found, true);
  assert.equal(data.filename, 'Readme.md');
  assert.deepEqual(data.sections, { installation: true, usage: true, license: false });
});

test('runReadme only counts a section as present when it is a real markdown heading, not a bare mention', () => {
  const targetRepo = makeTargetRepo();
  fs.writeFileSync(path.join(targetRepo, 'README.md'), [
    '# My Project',
    '',
    'See the license file for license terms.',
  ].join('\n'));
  const outDir = makeOutDir();
  const { runReadme } = require('../src/scanners/readme');
  const result = runReadme({ targetRepo, outDir });
  const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(data.sections.license, false);
});

test('runReadme recognizes "Licensing" as a license heading, not just "License"', () => {
  const targetRepo = makeTargetRepo();
  fs.writeFileSync(path.join(targetRepo, 'README.md'), [
    '# My Project',
    '',
    '## Licensing',
    'MIT',
  ].join('\n'));
  const outDir = makeOutDir();
  const { runReadme } = require('../src/scanners/readme');
  const result = runReadme({ targetRepo, outDir });
  const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(data.sections.license, true);
});

test('runReadme recognizes "Installing" and "Using" as installation/usage headings, not just the noun forms', () => {
  const targetRepo = makeTargetRepo();
  fs.writeFileSync(path.join(targetRepo, 'README.md'), [
    '# My Project',
    '',
    '## Installing',
    'npm install',
    '',
    '## Using',
    'run it',
  ].join('\n'));
  const outDir = makeOutDir();
  const { runReadme } = require('../src/scanners/readme');
  const result = runReadme({ targetRepo, outDir });
  const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(data.sections.installation, true);
  assert.equal(data.sections.usage, true);
});

test('runReadme recognizes setext-style headings (underlined with === or ---), not just ATX #', () => {
  const targetRepo = makeTargetRepo();
  fs.writeFileSync(path.join(targetRepo, 'README.md'), [
    'My Project',
    '==========',
    '',
    'Installation',
    '------------',
    'npm install',
    '',
    'License',
    '-------',
    'MIT',
  ].join('\n'));
  const outDir = makeOutDir();
  const { runReadme } = require('../src/scanners/readme');
  const result = runReadme({ targetRepo, outDir });
  const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(data.sections.installation, true);
  assert.equal(data.sections.license, true);
  assert.equal(data.sections.usage, false);
});

test('runReadme skips section detection for .rst READMEs instead of false-flagging RST-style headings as missing', () => {
  const targetRepo = makeTargetRepo();
  // RST headings are underlined with an arbitrary punctuation character
  // (here `~`), which isn't Markdown ATX or setext — the scanner can't
  // reliably parse RST's own heading syntax.
  fs.writeFileSync(path.join(targetRepo, 'README.rst'), [
    'My Project',
    '==========',
    '',
    'Installation',
    '~~~~~~~~~~~~',
    'pip install',
  ].join('\n'));
  const outDir = makeOutDir();
  const { runReadme } = require('../src/scanners/readme');
  const result = runReadme({ targetRepo, outDir });
  const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(data.found, true);
  assert.equal(data.sectionsChecked, false);
  assert.equal(data.sections, undefined);
});

test('runReadme sets sectionsChecked: true for ordinary Markdown READMEs', () => {
  const targetRepo = makeTargetRepo();
  fs.writeFileSync(path.join(targetRepo, 'README.md'), '# My Project\n');
  const outDir = makeOutDir();
  const { runReadme } = require('../src/scanners/readme');
  const result = runReadme({ targetRepo, outDir });
  const data = JSON.parse(fs.readFileSync(result.outputFile, 'utf8'));
  assert.equal(data.sectionsChecked, true);
});

test('runStaleness only counts .github/workflows when it actually contains a *.yml/*.yaml file', () => {
  withMocks({ isOnPath: () => true, run: () => okRun() }, () => {
    const { runStaleness } = require('../src/scanners/staleness');

    const emptyWorkflowsDir = makeTargetRepo({ git: false });
    fs.mkdirSync(path.join(emptyWorkflowsDir, '.github', 'workflows'), { recursive: true });
    const emptyResult = runStaleness({ targetRepo: emptyWorkflowsDir, outDir: makeOutDir() });
    const emptyData = JSON.parse(fs.readFileSync(emptyResult.outputFile, 'utf8'));
    assert.ok(!emptyData.ciConfigsFound.includes('.github/workflows'));

    const realWorkflowsDir = makeTargetRepo({ git: false });
    fs.mkdirSync(path.join(realWorkflowsDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(realWorkflowsDir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
    const realResult = runStaleness({ targetRepo: realWorkflowsDir, outDir: makeOutDir() });
    const realData = JSON.parse(fs.readFileSync(realResult.outputFile, 'utf8'));
    assert.ok(realData.ciConfigsFound.includes('.github/workflows'));
  });
});
