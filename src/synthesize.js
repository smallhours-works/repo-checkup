'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function findResult(index, tool) {
  return index.results.find((r) => r.tool === tool) || null;
}

// Standard NVD-style qualitative bucketing of a CVSS base score.
function severityBucket(score) {
  if (score === null || Number.isNaN(score)) return 'unknown';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'unknown';
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'unknown'];

// First4…last4 (the original scheme) reveals more than half of any
// realistic secret gitleaks actually flags — confirmed hands-on this run:
// an AWS-style access key ID (20 chars) keeps 60% hidden, but an 11-13
// char secret (a short API key or password — well within what gitleaks'
// generic-api-key rule matches) reveals 62-73% of the real value while
// this text still calls it "(redacted)". A report meant to be handed to
// someone outside the buyer's machine ("Secret values are redacted
// below") shouldn't make that claim false for the shorter end of what
// this product's own scanner reports. Fully redact anything short enough
// that 2+2 characters would be a large fraction of it, and cap the
// reveal at 2 characters per side (not 4) so even a long secret never
// shows more than a small, recognition-only sliver.
function redactSecret(secret) {
  if (!secret || secret.length <= 16) return '(redacted)';
  return `${secret.slice(0, 2)}…${secret.slice(-2)} (redacted)`;
}

// Tool error text (spawn errors and non-zero-exit stderr) is not ours to
// control — a third-party binary can print anything, including raw ANSI
// escape codes (confirmed hands-on: gitleaks does, on a bad --source path)
// and absolute local filesystem paths (confirmed hands-on: gitleaks' error
// text echoes back the exact --source path we passed it). This report is
// meant to be handed to someone outside the buyer's own machine, so strip
// escape codes and swap the target repo's own absolute path — already
// shown once, deliberately, in the report's "Target" line — for a
// placeholder before any tool's raw error text is quoted.
function sanitizeToolText(text, targetRepo) {
  if (!text) return text;
  // eslint-disable-next-line no-control-regex
  let clean = String(text).replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (targetRepo) clean = clean.split(targetRepo).join('<target repo>');
  return clean;
}

// A timeout (result.timedOut, set by src/util/exec.js's DEFAULT_TIMEOUT_MS)
// otherwise renders as a bare, unexplained "ETIMEDOUT" — confirmed hands-on
// this run by forcing a real spawnSync timeout and tracing it through. Give
// it a plain-language note instead, since a repo this product is run
// against (due-diligence targets, not ones we control the size of) can
// realistically be large enough to hit the default timeout.
function scanErrorNote(result, targetRepo) {
  if (result.timedOut) {
    const seconds = Math.round((result.durationMs || 0) / 1000);
    return `Scan timed out after ${seconds}s — the target may be too large for repo-checkup's default timeout.`;
  }
  return `Scan error: ${sanitizeToolText(result.error || result.stderr, targetRepo) || `exit ${result.exitCode}`}`;
}

// A markdown table row is split on unescaped `|` characters before any
// inline parsing happens, so a `|` inside a cell — even inside a backtick
// code span — is read as an extra column boundary, not literal text.
// Confirmed hands-on this run: gitleaks legitimately reports `File` paths
// exactly as they exist on disk, and `|` is a perfectly legal Unix
// filename character (only illegal on Windows); a real gitleaks scan of a
// fixture repo with a `weird|dir/config.py` path produced a report row
// that a real GFM-table renderer (`marked`) split into the wrong number of
// columns, pushing the redacted secret value off the end of the row
// entirely — the exact value this report exists to surface. A raw newline
// in a cell would end the row early the same way. Escaping `\|` is itself
// read correctly inside a code span by table-row splitting (verified with
// the same renderer), so this is safe to apply even to values already
// wrapped in backticks.
function tableCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// Wrapping a value in a single backtick pair to render it as inline code
// (e.g. a filename) only works if the value itself has no backtick in it.
// Confirmed hands-on this run: `licensee` and `gitleaks` both report
// filenames/paths exactly as they exist on disk, and a backtick is a
// perfectly legal Unix filename character — a fixture file named
// `LICENSE-MIT`weird` (matches licensee's own LICENSE-MIT-style filename
// pattern) or a directory named `` weird`dir `` (a real gitleaks match)
// each broke the surrounding backtick pair: the closing/reopening backtick
// inside the value ended the code span early, leaving the rest of the
// filename as plain text plus a stray dangling backtick, verified with a
// real GFM renderer (`marked`). CommonMark's own fix for this is a fence
// longer than any backtick run already in the content, padded with a
// single space if the content starts or ends with a backtick — verified
// with the same renderer to render correctly for a leading, trailing, and
// mid-value backtick (including a run of two).
function codeSpan(value) {
  const s = String(value);
  const runs = s.match(/`+/g) || [];
  const fenceLen = runs.reduce((max, run) => Math.max(max, run.length), 0) + 1;
  const fence = '`'.repeat(fenceLen);
  const pad = /^`|`$/.test(s) ? ' ' : '';
  return `${fence}${pad}${s}${pad}${fence}`;
}

function findFixedVersion(vuln, pkgName, ecosystem) {
  if (!vuln || !Array.isArray(vuln.affected)) return null;
  for (const affected of vuln.affected) {
    if (!affected.package) continue;
    if (affected.package.name !== pkgName || affected.package.ecosystem !== ecosystem) continue;
    for (const range of affected.ranges || []) {
      for (const event of range.events || []) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}

// Compares two dotted-numeric version strings (e.g. "4.17.21" vs "4.18.0").
// Returns >0 if a is newer, <0 if older, 0 if equal or not both parseable as
// plain numeric-dotted versions (the common case for OSV's SEMVER events).
function compareVersions(a, b) {
  const partsA = String(a).split('.').map(Number);
  const partsB = String(b).split('.').map(Number);
  if (partsA.some(Number.isNaN) || partsB.some(Number.isNaN)) return 0;
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function summarizeGitleaks(result, outDir, targetRepo) {
  if (!result) return { available: false, note: 'Check did not run.' };
  if (result.status === 'missing') {
    return { available: false, note: `Not installed. Install with: ${result.install}` };
  }
  if (result.status !== 'ok') {
    return { available: false, note: scanErrorNote(result, targetRepo) };
  }

  const leaks = readJson(result.outputFile) || [];
  return {
    available: true,
    scannedGitHistory: result.scannedGitHistory,
    findings: leaks.map((leak) => ({
      rule: leak.RuleID,
      description: leak.Description,
      file: leak.File,
      line: leak.StartLine,
      commit: leak.Commit,
      secret: redactSecret(leak.Secret),
    })),
  };
}

function summarizeOsv(result, targetRepo) {
  if (!result) return { available: false, note: 'Check did not run.' };
  if (result.status === 'missing') {
    return { available: false, note: `Not installed. Install with: ${result.install}` };
  }
  if (result.status === 'no-targets') {
    return { available: true, findings: [], note: result.note };
  }
  if (result.status !== 'ok') {
    return { available: false, note: scanErrorNote(result, targetRepo) };
  }

  const data = result.outputFile ? readJson(result.outputFile) : null;
  const findings = [];

  for (const src of (data && data.results) || []) {
    for (const pkgEntry of src.packages || []) {
      const pkg = pkgEntry.package;
      const vulnById = new Map((pkgEntry.vulnerabilities || []).map((v) => [v.id, v]));

      for (const group of pkgEntry.groups || []) {
        const score = parseFloat(group.max_severity);
        const vulnsInGroup = group.ids.map((id) => vulnById.get(id)).filter(Boolean);
        const primaryVuln = vulnsInGroup[0] || null;
        const cves = (group.aliases || []).filter((a) => a.startsWith('CVE-'));
        // A group can bundle multiple distinct advisories with different fixed
        // versions (osv-scanner groups overlapping-range vulnerabilities for
        // the same package together) — confirmed hands-on this run: a real
        // lodash@4.17.4 scan grouped CVE-2021-23337 (fixed 4.17.21) with
        // CVE-2026-4800 (fixed 4.18.0) under one row. Taking only the first
        // group member's fixed version, as this used to, is order-dependent:
        // it happened to give the right answer for one group in the same
        // scan and the wrong one for another, since group.ids isn't ordered
        // by version. Take the highest fixed version across every member so
        // the single "Fixed in" the report shows actually clears the whole
        // row's CVEs, not just whichever one appeared first.
        const fixedVersions = vulnsInGroup
          .map((v) => findFixedVersion(v, pkg.name, pkg.ecosystem))
          .filter(Boolean);
        const fixedVersion = fixedVersions.length > 0
          ? fixedVersions.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max))
          : null;

        findings.push({
          package: pkg.name,
          version: pkg.version,
          ecosystem: pkg.ecosystem,
          source: src.source && src.source.path,
          ids: group.ids,
          cves,
          severity: severityBucket(Number.isNaN(score) ? null : score),
          cvssScore: Number.isNaN(score) ? null : score,
          summary: primaryVuln ? primaryVuln.summary : null,
          fixedVersion,
        });
      }
    }
  }

  findings.sort((a, b) => {
    const bucketDiff = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (bucketDiff !== 0) return bucketDiff;
    return (b.cvssScore || 0) - (a.cvssScore || 0);
  });

  return { available: true, findings };
}

function summarizeLicensee(result, targetRepo) {
  if (!result) return { available: false, note: 'Check did not run.' };
  if (result.status === 'missing') {
    return { available: false, note: `Not installed. Install with: ${result.install}` };
  }
  if (result.status !== 'ok') {
    return { available: false, note: scanErrorNote(result, targetRepo) };
  }

  const data = readJson(result.outputFile) || {};
  const licenses = data.licenses || [];
  // licensee's own catch-all "other" entry (spdx_id NOASSERTION, meta.title
  // null) means a license-like file exists but licensee isn't confident
  // enough to name it -- not a real match, so it must not be reported as
  // one (see run write-up: a plain custom/proprietary LICENSE file, an
  // ordinary due-diligence finding, triggers exactly this).
  const confident = licenses.filter((l) => l.key !== 'other');
  if (confident.length > 0) {
    const top = confident[0];
    return { available: true, detected: true, name: top.meta ? top.meta.title : top.spdx_id, spdxId: top.spdx_id };
  }

  const matchedFiles = (data.matched_files || []).map((f) => f.filename).filter(Boolean);
  return { available: true, detected: false, matchedFiles };
}

function summarizeScc(result, targetRepo) {
  if (!result) return { available: false, note: 'Check did not run.' };
  if (result.status === 'missing') {
    return { available: false, note: `Not installed. Install with: ${result.install}` };
  }
  if (result.status !== 'ok') {
    return { available: false, note: scanErrorNote(result, targetRepo) };
  }

  const data = readJson(result.outputFile) || {};
  const languages = (data.languageSummary || [])
    .slice()
    .sort((a, b) => b.Code - a.Code);

  const totalCodeLines = languages.reduce((sum, l) => sum + l.Code, 0);
  const totalFiles = languages.reduce((sum, l) => sum + l.Count, 0);
  const totalComplexity = languages.reduce((sum, l) => sum + l.Complexity, 0);

  return {
    available: true,
    totalCodeLines,
    totalFiles,
    totalComplexity,
    topLanguages: languages.slice(0, 5).map((l) => ({ name: l.Name, codeLines: l.Code, files: l.Count })),
    estimatedCost: data.estimatedCost,
    estimatedScheduleMonths: data.estimatedScheduleMonths,
    estimatedPeople: data.estimatedPeople,
  };
}

function summarizeStaleness(result, targetRepo) {
  if (!result) return { available: false, note: 'Check did not run.' };
  if (result.status === 'missing') {
    return { available: false, note: `Not installed. Install with: ${result.install}` };
  }
  if (result.status !== 'ok') {
    return { available: false, note: scanErrorNote(result, targetRepo) };
  }

  const data = readJson(result.outputFile) || {};
  return { available: true, ...data };
}

// A commit dated after the moment repo-checkup runs makes daysSinceLastCommit
// negative — confirmed hands-on this run with a real commit made via
// GIT_COMMITTER_DATE set to a future date (git allows this; so does an
// ordinary clock-skewed machine). Rendered via the ordinary path this used
// to render "Last commit -1192 days ago", which reads as broken math and
// buries a signal a due-diligence reader would actually want (a future-dated
// commit is itself worth flagging, not hiding behind a nonsense number).
function lastCommitAge(staleness) {
  const days = staleness.daysSinceLastCommit;
  if (days < 0) return "dated in the future — check the repo's commit timestamps/clock";
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatMoney(n) {
  if (typeof n !== 'number') return 'unknown';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function renderMarkdown({ targetRepo, generatedAt, gitleaks, osv, licensee, scc, staleness }) {
  const lines = [];
  const push = (s = '') => lines.push(s);

  const secretCount = gitleaks.available ? gitleaks.findings.length : 0;
  const vulnCounts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  if (osv.available) {
    for (const f of osv.findings) vulnCounts[f.severity] += 1;
  }
  const seriousVulns = vulnCounts.critical + vulnCounts.high;

  push('# Repo Checkup report');
  push();
  push(`- **Target:** \`${targetRepo}\``);
  push(`- **Generated:** ${generatedAt}`);
  push();
  push('This is an automated first-pass, not a substitute for a manual security audit or professional due diligence.');
  push();

  // --- Summary -----------------------------------------------------------
  push('## Summary');
  push();
  const summaryBits = [];
  if (secretCount > 0) {
    summaryBits.push(`**${secretCount} likely leaked secret${secretCount === 1 ? '' : 's'}** found — fix these first.`);
  } else if (gitleaks.available) {
    summaryBits.push('No leaked secrets found.');
  }
  if (seriousVulns > 0) {
    summaryBits.push(`**${seriousVulns} high/critical-severity dependency vulnerabilit${seriousVulns === 1 ? 'y' : 'ies'}** found.`);
  } else if (osv.available && osv.findings.length > 0) {
    summaryBits.push(`${osv.findings.length} lower-severity dependency vulnerabilities found.`);
  } else if (osv.available) {
    summaryBits.push('No known dependency vulnerabilities found.');
  }
  if (licensee.available) {
    if (licensee.detected) {
      summaryBits.push(`License: ${licensee.name}.`);
    } else if (licensee.matchedFiles && licensee.matchedFiles.length > 0) {
      summaryBits.push('License file present but not confidently identified.');
    } else {
      summaryBits.push('No license file detected.');
    }
  }
  if (staleness.available && staleness.isGitRepo && staleness.hasCommits) {
    summaryBits.push(`Last commit ${lastCommitAge(staleness)}.`);
  } else if (staleness.available && staleness.isGitRepo) {
    summaryBits.push('Git repository with no commits yet.');
  }
  for (const bit of summaryBits) push(`- ${bit}`);
  push();

  // --- Secrets -------------------------------------------------------------
  push('## 1. Leaked secrets');
  push();
  if (!gitleaks.available) {
    push(`Not checked — ${gitleaks.note}`);
  } else if (gitleaks.findings.length === 0) {
    push('None found.' + (gitleaks.scannedGitHistory ? ' (Full git history scanned.)' : ' (Working tree only — not a git repo.)'));
  } else {
    push('Secret values are redacted below. Treat every one of these as compromised: rotate the credential, then remove it from history.');
    push();
    push('| Rule | File | Line | Value |');
    push('| --- | --- | --- | --- |');
    for (const f of gitleaks.findings) {
      push(`| ${tableCell(f.rule)} | ${codeSpan(tableCell(f.file))} | ${f.line} | ${tableCell(f.secret)} |`);
    }
  }
  push();

  // --- Dependency vulnerabilities -------------------------------------------
  push('## 2. Dependency vulnerabilities');
  push();
  if (!osv.available) {
    push(`Not checked — ${osv.note}`);
  } else if (osv.findings.length === 0) {
    push('None found.' + (osv.note ? ` (${osv.note})` : ''));
  } else {
    push('| Severity | Package | Version | CVE | Fixed in | Summary |');
    push('| --- | --- | --- | --- | --- | --- |');
    for (const f of osv.findings) {
      const cve = f.cves.length > 0 ? f.cves.join(', ') : f.ids.join(', ');
      push(`| ${f.severity}${f.cvssScore !== null ? ` (${f.cvssScore})` : ''} | ${tableCell(f.package)} | ${tableCell(f.version)} | ${tableCell(cve)} | ${f.fixedVersion ? tableCell(f.fixedVersion) : '—'} | ${f.summary ? tableCell(f.summary) : '—'} |`);
    }
  }
  push();

  // --- License ---------------------------------------------------------------
  push('## 3. License');
  push();
  if (!licensee.available) {
    push(`Not checked — ${licensee.note}`);
  } else if (licensee.detected) {
    push(`Detected: **${licensee.name}**${licensee.spdxId ? ` (SPDX: \`${licensee.spdxId}\`)` : ''}.`);
  } else if (licensee.matchedFiles && licensee.matchedFiles.length > 0) {
    push(`A license-like file exists (${licensee.matchedFiles.map(codeSpan).join(', ')}) but its license could not be confidently identified. Worth a manual look.`);
  } else {
    push('No license file found. Matters for due diligence, hiring, and legal clarity around reuse — worth adding one.');
  }
  push();

  // --- Staleness / maintenance -------------------------------------------------
  push('## 4. Maintenance signals');
  push();
  if (!staleness.available) {
    push(`Not checked — ${staleness.note}`);
  } else if (!staleness.isGitRepo) {
    push(staleness.note || 'Not a git repository — commit-based signals unavailable.');
    push(`CI config found: ${staleness.ciConfigsFound && staleness.ciConfigsFound.length > 0 ? staleness.ciConfigsFound.join(', ') : 'none'}.`);
  } else if (!staleness.hasCommits) {
    push(staleness.note || 'Git repository with no commits yet — commit-based signals unavailable.');
    push(`CI config found: ${staleness.ciConfigsFound && staleness.ciConfigsFound.length > 0 ? staleness.ciConfigsFound.join(', ') : 'none'}.`);
  } else {
    push(`- Last commit: ${staleness.lastCommitDate} (${lastCommitAge(staleness)}).`);
    if (staleness.commitsLast90Days === null || staleness.commitsPrior90Days === null) {
      // `git log --since=...` (unlike the `git log -1` above) can fail on its
      // own — confirmed hands-on this run by making it fail while `log -1`
      // still succeeds — most plausibly a timeout walking a very large
      // history. countCommitsSince() already returns null (not 0) for that
      // case, but rendering it as a number produced the literal text "null
      // commits ... (steady)" here: a false "unchanged" trend claim plus a
      // raw null neither reader wants to see.
      push('- Commit activity: unavailable (a git error while counting commits by date; last-commit date above is still accurate).');
    } else {
      const trend = staleness.commitsLast90Days > staleness.commitsPrior90Days ? 'picking up'
        : staleness.commitsLast90Days < staleness.commitsPrior90Days ? 'slowing down'
          : 'steady';
      push(`- Commit activity: ${staleness.commitsLast90Days} commits in the last 90 days vs. ${staleness.commitsPrior90Days} in the 90 days before that (${trend}).`);
    }
    push(`- CI config found: ${staleness.ciConfigsFound && staleness.ciConfigsFound.length > 0 ? staleness.ciConfigsFound.join(', ') : 'none'}.`);
  }
  push();

  // --- Size / complexity ----------------------------------------------------
  push('## 5. Size & complexity');
  push();
  if (!scc.available) {
    push(`Not checked — ${scc.note}`);
  } else {
    push(`- ${scc.totalCodeLines.toLocaleString('en-US')} lines of code across ${scc.totalFiles.toLocaleString('en-US')} files.`);
    if (scc.topLanguages.length > 0) {
      push(`- Top languages: ${scc.topLanguages.map((l) => `${l.name} (${l.codeLines.toLocaleString('en-US')} lines)`).join(', ')}.`);
    }
    if (typeof scc.estimatedCost === 'number') {
      push(`- Rough COCOMO effort estimate to rebuild from scratch: ${formatMoney(scc.estimatedCost)}, ~${scc.estimatedScheduleMonths.toFixed(1)} months, ~${scc.estimatedPeople.toFixed(1)} people. (A rough-order-of-magnitude estimate from source size, not a quote.)`);
    }
  }
  push();

  push('---');
  push('_Made by Claude, an AI. Owned by a human. Not affiliated with Anthropic._');

  return lines.join('\n');
}

/**
 * Reads a completed repo-checkup run's index.json + per-tool raw files from
 * outDir and returns the prioritized data a report is built from: targetRepo,
 * generatedAt, and one summarized result per tool (gitleaks, osv, licensee,
 * scc, staleness). Does not render or write anything itself.
 */
function collect(outDir) {
  const index = readJson(path.join(outDir, 'index.json'));
  if (!index) {
    throw new Error(`No index.json found in ${outDir} — run the scan first.`);
  }

  const gitleaks = summarizeGitleaks(findResult(index, 'gitleaks'), outDir, index.targetRepo);
  const osv = summarizeOsv(findResult(index, 'osv-scanner'), index.targetRepo);
  const licensee = summarizeLicensee(findResult(index, 'licensee'), index.targetRepo);
  const scc = summarizeScc(findResult(index, 'scc'), index.targetRepo);
  const staleness = summarizeStaleness(findResult(index, 'staleness'), index.targetRepo);

  return {
    targetRepo: index.targetRepo,
    generatedAt: index.generatedAt,
    gitleaks,
    osv,
    licensee,
    scc,
    staleness,
  };
}

/**
 * Reads a completed repo-checkup run's index.json + per-tool raw files from
 * outDir and returns a prioritized, readable markdown report as a string.
 * Does not write anything itself — callers decide where the report goes.
 */
function synthesize(outDir) {
  return renderMarkdown(collect(outDir));
}

module.exports = {
  synthesize, collect, severityBucket, redactSecret,
};
