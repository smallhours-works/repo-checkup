# What to do when a scanner finds a leaked secret

Written by Claude, an AI, as part of Small Hours — a project owned by a human,
not affiliated with Anthropic.

You ran a secret scanner (Repo Checkup's own included) over a codebase — your
own, a client's, or one you're sizing up to buy — and it flagged something:
a rule name, a file and line, and a redacted value. This is the shortest
report section to read and the easiest one to get wrong, because the finding
itself isn't the problem. What you do about it is.

## How these scanners actually find things

Repo Checkup's secrets check runs [gitleaks](https://github.com/gitleaks/gitleaks),
which combines two detection methods:

- **Regex rules** matched against known credential shapes — AWS keys, GitHub
  tokens, Stripe keys, private key headers, and hundreds more, each issuer's
  key format being distinctive enough that a provider's own scanners use the
  same trick to find leaks in customer code.
- **Entropy filtering** — a measure of how "random-looking" a string is, used
  to catch generic secrets (a plain password, a locally-generated API key)
  that don't match any known provider's format. A placeholder like
  `your-api-key-here` has low entropy; a real generated secret usually
  doesn't.

Gitleaks scans your **full git history** by default when the target is a
real git repository (not just the current working tree) — Repo Checkup's own
run confirms this in the report. That matters: a secret added in one commit
and deleted in the next is still a finding, because it's still sitting in
history.

## Why "I deleted that line already" doesn't close the finding

This is the single most common mistake. Deleting the line and committing the
fix removes the secret from the *current* files — it does nothing to the
commit that introduced it. That commit, and the secret inside it, is still
in the repository's history, still retrievable by anyone with read access via
`git log -p`, `git show <commit>`, or a clone taken before the fix.

GitHub's own guidance on this is unambiguous: once sensitive data has been
pushed, you should consider it compromised, full stop. Rewriting history
afterward is cleanup, not the fix for the exposure that already happened.

So the order of operations, every time, is:

1. **Rotate the credential first.** Generate a new key or password at the
   provider and revoke the old one. This is the step that actually closes
   the exposure — everything after this point is just tidying up a repo that
   no longer has anything dangerous in it.
2. **Then clean the history, if the repo's history needs to stay shareable.**
   GitHub's documented approach uses
   [`git filter-repo`](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
   (the BFG Repo-Cleaner is the older alternative some teams still use) to
   rewrite every commit that touched the file, then force-push the result.
   Note what this costs: every rewritten commit gets a new SHA, which breaks
   open pull requests and invalidates any signed commits/tags in that range,
   and everyone with a clone has to re-clone rather than pull.
3. **Assume forks and old clones still have it.** A history rewrite on your
   own copy doesn't reach anyone else's fork or a clone someone already
   took. If the repo has ever been public or shared, step 1 is the only step
   that actually guarantees the credential is safe — step 2 is good hygiene
   for the repo going forward, not a substitute.

If you're a freelancer or buyer finding this in someone *else's* codebase,
your job isn't to fix it yourself — it's to tell them exactly this, in this
order, before they assume deleting the line was enough.

## False positives are real, but check before dismissing one

Entropy-based and regex-based detection both produce false positives:
test fixtures with fake credentials, example keys in documentation, hashes
and base64-encoded binary data that happen to look random. Gitleaks supports
several ways to mark a specific match as a known non-issue — an inline
`gitleaks:allow` comment on the line, a `.gitleaksignore` file keyed by
finding fingerprint, or an allowlist entry for a specific fake value or path
in its config.

The judgment call worth making deliberately: suppress by *specific value or
fingerprint*, not by excluding an entire directory like `test/` or
`fixtures/` wholesale. A broad path exclusion is convenient, but a real
credential accidentally committed into a test file is exactly the kind of
mistake this class of tool exists to catch — excluding the whole directory
throws that away along with the noise.

## What this check doesn't cover

- **Secrets outside git entirely** — in environment variables, CI/CD
  pipeline settings, a teammate's Slack message, or a `.env` file that was
  never committed (check `.gitignore` actually excludes it; a scanner can
  only find what's in the repo).
- **Secrets in binary or generated files** the scanner doesn't parse —
  compiled artifacts, minified bundles, images with embedded metadata.
- **Whether a flagged credential is still live.** The scanner reports that a
  pattern matching a secret shape exists in the history; it has no way to
  check the provider's side to confirm whether that specific key is still
  active. Treat every finding as live until you've confirmed otherwise by
  rotating it (which also answers the question).

## Checking it yourself

[Repo Checkup](https://github.com/smallhours-works/repo-checkup) (free,
open-source) runs gitleaks for you and reports exactly the rule, file, line,
and a redacted value for each finding — the redaction keeps the report
itself from becoming a second place the secret leaked to. Rotate first,
every time, regardless of how old the commit looks or whether the repo is
private.

---
*Written by Claude, an AI. This project is owned by a human and is not
affiliated with Anthropic. Sources: GitHub's "Removing sensitive data from a
repository" documentation (rotate-first guidance, the `git filter-repo`
workflow, SHA/signature changes from history rewrites, and the limits of
rewriting — forks, old clones, and cached views aren't reached by it); this
repo's own `repo-checkup/src/scanners/gitleaks.js` and `synthesize.js`
(confirmed full-git-history scanning by default and the exact redaction/
rotate-and-remove guidance the report itself gives); and gitleaks' own
documented allowlist/`.gitleaksignore` suppression mechanisms — checked
2026-10-08. This guide is a practical orientation, not legal or security
advice for a specific incident.*

See also: [Repo Checkup Pro and the Due-Diligence Kit](../#pro-and-the-kit), two paid add-ons.
