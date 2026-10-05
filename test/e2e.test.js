'use strict';

// End-to-end tests: run the actual `bin/repo-checkup.js` entry point as a
// real child process against a real fixture repo on disk, with no
// `require.cache` mocking anywhere in the chain. Every other suite in this
// directory substitutes fakes for at least one layer (`run`/`isOnPath` in
// scanners.test.js, the scanner modules in runAll.test.js, `./runAll`/
// `./synthesize` in cli.test.js) — none of them exercise the real process
// spawn in bin/repo-checkup.js, real argument parsing through a real argv,
// or real filesystem writes end to end. None of gitleaks/osv-scanner/scc/
// licensee are installed in this environment (or Repo Checkup's own CI),
// so those four scanners take their real "missing" path — only `staleness`
// (which shells out to the real `git` binary, always present) exercises a
// real spawned subprocess underneath repo-checkup's own subprocess.
// `readme` is local-only (plain fs, no subprocess) so it always takes its
// real "ok" path too, same as `staleness`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'repo-checkup.js');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A minimal real git repo: a couple of commits, a CI config, so `staleness`
// has real signals to report instead of "not a git repository".
function makeFixtureRepo() {
  const dir = makeTmpDir('repo-checkup-e2e-fixture-');
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

  git('init', '--quiet', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');

  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'initial commit');

  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\njobs: {}\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'add CI config');

  return dir;
}

function runCli(args, options = {}) {
  try {
    const stdout = execFileSync('node', [BIN, ...args], { encoding: 'utf8', ...options });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    // execFileSync throws on non-zero exit; the real stdout/stderr/status
    // are still on the error object.
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('e2e: full run against a real fixture repo writes a real index.json and report.md', () => {
  const targetRepo = makeFixtureRepo();
  const outDir = makeTmpDir('repo-checkup-e2e-out-');

  const { status, stdout } = runCli([targetRepo, '--out', outDir]);

  assert.equal(status, 0);
  assert.match(stdout, /repo-checkup: scanning/);

  // The four missing third-party tools and the one real, always-available
  // check (`staleness`, via the real `git` binary) each render distinctly
  // in the CLI's own status lines, exactly as a buyer running this for
  // real would see.
  for (const tool of ['gitleaks', 'osv-scanner', 'scc', 'licensee']) {
    assert.match(stdout, new RegExp(`${tool}\\s+NOT INSTALLED`));
  }
  assert.match(stdout, /staleness\s+ok/);
  assert.match(stdout, /readme\s+ok/);

  const indexPath = path.join(outDir, 'index.json');
  const reportPath = path.join(outDir, 'report.md');
  assert.ok(fs.existsSync(indexPath), 'index.json should exist');
  assert.ok(fs.existsSync(reportPath), 'report.md should exist');

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index.targetRepo, targetRepo);
  assert.ok(!Number.isNaN(Date.parse(index.generatedAt)));
  assert.equal(index.results.length, 6);

  const byTool = Object.fromEntries(index.results.map((r) => [r.tool, r]));
  for (const tool of ['gitleaks', 'osv-scanner', 'scc', 'licensee']) {
    assert.equal(byTool[tool].status, 'missing');
    assert.ok(byTool[tool].install, `${tool} should carry install instructions`);
  }
  assert.equal(byTool.staleness.status, 'ok');
  assert.equal(byTool.readme.status, 'ok');

  const staleness = JSON.parse(fs.readFileSync(byTool.staleness.outputFile, 'utf8'));
  assert.equal(staleness.isGitRepo, true);
  assert.equal(staleness.hasCommits, true);
  assert.deepEqual(staleness.ciConfigsFound, ['.github/workflows']);

  // The fixture's README.md is just "# fixture\n" — found, but missing all
  // three recognized sections.
  const readme = JSON.parse(fs.readFileSync(byTool.readme.outputFile, 'utf8'));
  assert.equal(readme.found, true);
  assert.equal(readme.filename, 'README.md');
  assert.deepEqual(readme.sections, { installation: false, usage: false, license: false });

  const report = fs.readFileSync(reportPath, 'utf8');
  assert.match(report, /Not installed\. Install with:/);
  // Confirms report.md is built from the real synthesize(outDir) reading
  // real files back off disk, not from data still held in memory.
  assert.equal(report, require('../src/synthesize').synthesize(outDir));
});

test('e2e: --help exits 0 and prints usage without scanning anything', () => {
  const { status, stdout } = runCli(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /^Usage: repo-checkup/);
  assert.doesNotMatch(stdout, /scanning/);
});

test('e2e: no target exits 1 and prints usage', () => {
  const { status, stdout } = runCli([]);
  assert.equal(status, 1);
  assert.match(stdout, /^Usage: repo-checkup/);
});

test('e2e: a target that is not a directory exits 1 with a clear error', () => {
  const filePath = path.join(makeTmpDir('repo-checkup-e2e-file-'), 'not-a-dir.txt');
  fs.writeFileSync(filePath, 'hi');

  const { status, stderr } = runCli([filePath]);
  assert.equal(status, 1);
  assert.match(stderr, /is not a directory/);
});

test('e2e: --out defaults to ./.repo-checkup/<timestamp> under the CLI\'s cwd', () => {
  const targetRepo = makeFixtureRepo();
  const cwd = makeTmpDir('repo-checkup-e2e-cwd-');

  const before = Date.now();
  const { status, stdout } = runCli([targetRepo], { cwd });
  assert.equal(status, 0);

  const defaultParent = path.join(cwd, '.repo-checkup');
  assert.ok(fs.existsSync(defaultParent), '.repo-checkup should be created under cwd');

  const runDirs = fs.readdirSync(defaultParent);
  assert.equal(runDirs.length, 1);
  const timestamp = Number(runDirs[0]);
  assert.ok(Number.isInteger(timestamp) && timestamp >= before, 'run dir should be named by a fresh Date.now() timestamp');

  const actualOutDir = path.join(defaultParent, runDirs[0]);
  assert.match(stdout, new RegExp(actualOutDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(fs.existsSync(path.join(actualOutDir, 'index.json')));
  assert.ok(fs.existsSync(path.join(actualOutDir, 'report.md')));

  fs.rmSync(defaultParent, { recursive: true, force: true });
});
