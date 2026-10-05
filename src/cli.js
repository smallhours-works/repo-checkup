'use strict';

const fs = require('fs');
const path = require('path');

const { runAll } = require('./runAll');
const { synthesize } = require('./synthesize');

const USAGE = `Usage: repo-checkup <path-to-repo> [--out <dir>]

Runs gitleaks, osv-scanner, scc, and licensee against the target repo
(plus a local git-log staleness check and a README-completeness check),
writes each tool's raw output to --out (default: ./.repo-checkup/<timestamp>/),
and synthesizes a single prioritized report.md in the same directory.`;

function parseArgs(argv) {
  const args = { target: null, out: null, extra: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      args.out = argv[i + 1];
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (!args.target) {
      args.target = arg;
    } else {
      args.extra.push(arg);
    }
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);

  if (args.help || !args.target) {
    console.log(USAGE);
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  if (args.extra.length > 0) {
    console.error(`repo-checkup: unexpected extra argument${args.extra.length > 1 ? 's' : ''}: ${args.extra.join(' ')}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const targetRepo = path.resolve(args.target);
  if (!fs.existsSync(targetRepo) || !fs.statSync(targetRepo).isDirectory()) {
    console.error(`repo-checkup: ${targetRepo} is not a directory`);
    process.exitCode = 1;
    return;
  }

  const outDir = path.resolve(
    args.out || path.join(process.cwd(), '.repo-checkup', String(Date.now()))
  );

  console.log(`repo-checkup: scanning ${targetRepo}`);
  console.log(`repo-checkup: raw output -> ${outDir}\n`);

  const index = runAll(targetRepo, outDir);

  for (const result of index.results) {
    const label = (result.tool || 'unknown').padEnd(12);
    if (result.status === 'ok') {
      console.log(`  ${label} ok`);
    } else if (result.status === 'no-targets') {
      console.log(`  ${label} skipped — ${result.note}`);
    } else if (result.status === 'missing') {
      console.log(`  ${label} NOT INSTALLED — install with: ${result.install}`);
    } else {
      console.log(`  ${label} ERROR — ${result.error || result.stderr || `exit ${result.exitCode}`}`);
    }
  }

  const reportFile = path.join(outDir, 'report.md');
  fs.writeFileSync(reportFile, synthesize(outDir));

  console.log(`\nIndex:  ${path.join(outDir, 'index.json')}`);
  console.log(`Report: ${reportFile}`);
}

module.exports = { main, parseArgs, USAGE };
