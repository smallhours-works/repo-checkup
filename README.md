# Repo Checkup

Runs a battery of established free scanners against a local repo and turns
their output into one prioritized, readable `report.md`: security first
(leaked secrets, vulnerable dependencies), then license, maintenance, and
documentation signals, then size/complexity.

Made by Claude, an AI. Owned by a human. Not affiliated with Anthropic.

## Open core

Everything in this repo, the scanner orchestration and the report
synthesis, is free and MIT-licensed (see `LICENSE`), and it will stay
free and complete. It runs entirely on your own machine: your code never
leaves it. Clone it, read it, run it, fork it.

An optional paid add-on may come later (for example, a client-ready
version of the report). If it does, it will be clearly labeled as a
separate extra, and nothing in this free tool will be removed or held
back to make room for it.

## What it runs

| Check | Tool | License | What it needs on PATH |
| --- | --- | --- | --- |
| Leaked secrets | [gitleaks](https://github.com/gitleaks/gitleaks) | MIT | `gitleaks` |
| Dependency vulnerabilities (npm/pip, more later) | [osv-scanner](https://github.com/google/osv-scanner) | Apache-2.0 | `osv-scanner` |
| Size / complexity | [scc](https://github.com/boyter/scc) | MIT | `scc` |
| License file check | [licensee](https://github.com/licensee/licensee) | MIT | `licensee` |
| Staleness (last commit, commit trend, CI config presence) | local `git log` | — | `git` |
| Documentation (README present, with Installation/Usage/License sections) | local check | — | — |

None of the four tools in that table are bundled or redistributed —
`repo-checkup` shells out to whatever is already on your PATH. Staleness
and the documentation check are plain local checks with no third-party
tool and nothing required on PATH beyond `git` itself. Nothing about the
target repo is uploaded anywhere; everything runs on your own machine.
`osv-scanner` runs with `--offline --download-offline-databases`: the first
scan of a given ecosystem (npm, PyPI, ...) on your machine downloads OSV's
public vulnerability database for it (tens to a couple hundred MB,
depending on the ecosystem) into `osv-scanner`'s own local cache; every
scan after that, of any repo, reuses the cache with no network call at
all — not even package name/version lookups.

## Install the scanners

Confirmed working this way during development (Go 1.24+, Ruby 3.3+):

```sh
go install github.com/zricethezav/gitleaks/v8@latest
go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest
go install github.com/boyter/scc/v3@latest
gem install licensee
```

Make sure `$(go env GOPATH)/bin` and your gem user-install bin dir are on
`PATH`. Prebuilt binaries are also available from each project's GitHub
releases page if you'd rather not use `go install`/`gem install`.

If a tool isn't found on PATH, `repo-checkup` skips just that check, prints
the install command above, and still runs everything else — it does not
fail the whole run.

## Usage

```sh
node bin/repo-checkup.js <path-to-repo> [--out <dir>]
```

Output lands in `<out>/` (default: `./.repo-checkup/<timestamp>/`):

- **`report.md`** — the actual product: a prioritized, plain-language
  summary followed by one section per check (leaked secrets, dependency
  vulnerabilities, license, maintenance signals, documentation,
  size/complexity). Secret values are redacted (anything 16 characters or
  shorter is fully hidden; longer secrets show at most 2 characters on
  each side), and any per-check "Scan error" text has escape codes
  stripped and the target repo's own local path swapped for a
  placeholder — the report is meant to be safe to hand to someone else.
- Raw per-tool output for anyone who wants it: `gitleaks.json`,
  `osv-scanner.json`, `scc.json`, `licensee.json`, `staleness.json`,
  `readme.json`, plus an `index.json` summarizing which checks ran, were
  skipped (tool missing), or errored.

A missing scanner tool doesn't fail the run — that section of `report.md`
just says which tool is missing and how to install it, and every other
check still runs.

## Status

Version 0.1.0. The command-line tool and the report work end to end.
Tested against clean repos, a test repo seeded with a known-vulnerable
dependency and fake leaked credentials, a repo with no license, and runs
where some or all scanners are missing (each missing scanner is reported
with install instructions; everything else still runs). Scanner error text
is cleaned before it reaches the report, and your local file paths are not
repeated in it.

This is an automated first pass, not a substitute for a manual security
audit.

## License

MIT. See `LICENSE`.
