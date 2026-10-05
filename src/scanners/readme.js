'use strict';

const fs = require('fs');
const path = require('path');

// Matches README, README.md, Readme.rst, readme.txt, etc. — case-insensitive,
// since the filename convention varies by project and OS.
const README_NAME_RE = /^readme(\.(md|markdown|rst|txt))?$/i;
const RST_EXT_RE = /\.rst$/i;

// ATX-style headings (`## Installation`) and setext-style headings
// (`Installation` underlined with `===` or `---`) are both valid Markdown —
// checking only ATX would false-negative on READMEs that happen to use the
// other style for a real section.
const ATX_PATTERNS = {
  installation: /^#{1,6}[ \t]*(installation|install|installing|getting started|setup)\b/im,
  usage: /^#{1,6}[ \t]*(usage|using|how to use|quick ?start)\b/im,
  license: /^#{1,6}[ \t]*(licen[sc]e|licensing)\b/im,
};
const SETEXT_PATTERNS = {
  installation: /^[ \t]*(installation|install|installing|getting started|setup)[ \t]*\r?\n[ \t]*(=+|-+)[ \t]*$/im,
  usage: /^[ \t]*(usage|using|how to use|quick ?start)[ \t]*\r?\n[ \t]*(=+|-+)[ \t]*$/im,
  license: /^[ \t]*(licen[sc]e|licensing)[ \t]*\r?\n[ \t]*(=+|-+)[ \t]*$/im,
};

function hasSection(content, key) {
  return ATX_PATTERNS[key].test(content) || SETEXT_PATTERNS[key].test(content);
}

function findReadme(targetRepo) {
  let entries;
  try {
    entries = fs.readdirSync(targetRepo);
  } catch (err) {
    return null;
  }
  const match = entries.find((name) => README_NAME_RE.test(name));
  return match ? path.join(targetRepo, match) : null;
}

/**
 * No third-party tool: whether a README exists at all, and — if it does —
 * whether it has recognizable Installation, Usage, and License sections
 * (matched as markdown headings, not just the bare word anywhere in the
 * text, so a stray mention doesn't count as a real section). All local, no
 * network, no subprocess.
 */
function runReadme({ targetRepo, outDir }) {
  const readmePath = findReadme(targetRepo);
  const outFile = path.join(outDir, 'readme.json');

  if (!readmePath) {
    fs.writeFileSync(outFile, JSON.stringify({ found: false }, null, 2));
    return { tool: 'readme', status: 'ok', outputFile: outFile };
  }

  let content;
  try {
    content = fs.readFileSync(readmePath, 'utf8');
  } catch (err) {
    return { tool: 'readme', status: 'error', error: String((err && err.message) || err) };
  }

  // reStructuredText headings aren't ATX or setext Markdown (they use an
  // arbitrary punctuation-character underline, e.g. `~~~~`), so the patterns
  // above can't reliably detect them. Rather than report a false "missing"
  // for a section that's actually there in RST's own style, skip per-section
  // detection for .rst READMEs and say so, instead of guessing.
  const isRst = RST_EXT_RE.test(readmePath);
  const data = {
    found: true,
    filename: path.basename(readmePath),
    sectionsChecked: !isRst,
  };
  if (!isRst) {
    data.sections = {
      installation: hasSection(content, 'installation'),
      usage: hasSection(content, 'usage'),
      license: hasSection(content, 'license'),
    };
  }

  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  return { tool: 'readme', status: 'ok', outputFile: outFile };
}

module.exports = { runReadme };
