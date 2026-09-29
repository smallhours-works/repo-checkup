'use strict';

const fs = require('fs');
const path = require('path');
const { isOnPath } = require('../util/which');
const { run } = require('../util/exec');

const CI_CONFIG_PATHS = [
  '.github/workflows',
  '.gitlab-ci.yml',
  '.circleci/config.yml',
  'Jenkinsfile',
  '.travis.yml',
  'azure-pipelines.yml',
  '.drone.yml',
  'bitbucket-pipelines.yml',
  'appveyor.yml',
  '.buildkite/pipeline.yml',
];

// `.github/workflows` is a directory, not a file — existsSync alone is true
// for an empty leftover directory (e.g. from a template, or workflows moved
// elsewhere) with no actual CI defined. Confirmed hands-on this run: an
// empty `.github/workflows/` renders "CI config found: .github/workflows"
// in the report, a false positive. Require at least one *.yml/*.yaml file
// inside before counting it; every other entry in the list is a plain file
// path, where existsSync already means what it claims.
function hasWorkflowFile(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    return false;
  }
  return entries.some((name) => /\.ya?ml$/i.test(name));
}

function findCiConfigs(targetRepo) {
  return CI_CONFIG_PATHS.filter((p) => {
    const fullPath = path.join(targetRepo, p);
    if (p === '.github/workflows') return hasWorkflowFile(fullPath);
    return fs.existsSync(fullPath);
  });
}

function countCommitsSince(targetRepo, sinceArg, untilArg) {
  const args = ['-C', targetRepo, 'log', '--oneline', `--since=${sinceArg}`];
  if (untilArg) args.push(`--until=${untilArg}`);
  const result = run('git', args);
  if (result.code !== 0) return null;
  const trimmed = result.stdout.trim();
  return trimmed === '' ? 0 : trimmed.split('\n').length;
}

/**
 * No third-party tool: days since last commit, a rough commit-frequency
 * trend (last 90 days vs. the 90 days before that), and whether a
 * recognized CI config file is present. All local, no network.
 */
function runStaleness({ targetRepo, outDir }) {
  const isGitRepo = fs.existsSync(path.join(targetRepo, '.git'));
  const ciConfigsFound = findCiConfigs(targetRepo);

  if (!isGitRepo) {
    const data = {
      isGitRepo: false,
      note: 'Not a git repository (or .git not found at the target path) — commit-based staleness signals unavailable.',
      ciConfigsFound,
    };
    const outFile = path.join(outDir, 'staleness.json');
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
    return { tool: 'staleness', status: 'ok', outputFile: outFile };
  }

  if (!isOnPath('git')) {
    return { tool: 'staleness', status: 'missing', install: 'git (https://git-scm.com/downloads)' };
  }

  const lastCommitResult = run('git', ['-C', targetRepo, 'log', '-1', '--format=%cI']);
  const hasCommits = lastCommitResult.code === 0 && lastCommitResult.stdout.trim() !== '';

  if (!hasCommits) {
    // `git log` also exits non-zero for reasons that have nothing to do
    // with the repo being empty — confirmed hands-on: git's "dubious
    // ownership" safety check trips (exit 128) whenever the target repo
    // is owned by a different user than the one running repo-checkup, an
    // ordinary case (a repo checked out by another account, a shared or
    // mounted volume, a CI box). Folding every non-zero exit into "no
    // commits yet" silently discarded that real error and reported a
    // false maintenance signal for a repo that may have full history.
    // Only the specific "no commits yet" failure gets that note; any
    // other failure is surfaced as an error instead of guessed at.
    const emptyRepo = lastCommitResult.code !== 0 &&
      /does not have any commits yet/i.test(lastCommitResult.stderr || '');

    if (!emptyRepo) {
      return {
        tool: 'staleness',
        status: 'error',
        error: lastCommitResult.spawnError || lastCommitResult.stderr,
        exitCode: lastCommitResult.code,
        timedOut: lastCommitResult.timedOut,
        durationMs: lastCommitResult.durationMs,
      };
    }

    const data = {
      isGitRepo: true,
      hasCommits: false,
      note: 'Git repository with no commits yet — commit-based staleness signals unavailable.',
      ciConfigsFound,
    };
    const outFile = path.join(outDir, 'staleness.json');
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
    return { tool: 'staleness', status: 'ok', outputFile: outFile };
  }

  const lastCommitDate = lastCommitResult.stdout.trim();
  const diffMs = Date.now() - new Date(lastCommitDate).getTime();
  const daysSinceLastCommit = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const commitsLast90Days = countCommitsSince(targetRepo, '90 days ago');
  const commitsPrior90Days = countCommitsSince(targetRepo, '180 days ago', '90 days ago');

  const data = {
    isGitRepo: true,
    hasCommits: true,
    lastCommitDate,
    daysSinceLastCommit,
    commitsLast90Days,
    commitsPrior90Days,
    ciConfigsFound,
  };

  const outFile = path.join(outDir, 'staleness.json');
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));

  return { tool: 'staleness', status: 'ok', outputFile: outFile };
}

module.exports = { runStaleness };
