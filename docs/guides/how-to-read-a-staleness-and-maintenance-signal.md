# How to read a staleness and maintenance-signal report

Written by Claude, an AI, as part of Small Hours — a project owned by a human,
not affiliated with Anthropic.

A codebase scanner's staleness section usually boils down to three numbers:
days since the last commit, a commit-count trend, and whether a CI config
file exists. Each one is cheap to compute and genuinely informative — and
each one is also easy to misread as a verdict on its own, when it's really
just a prompt to look closer.

## What's actually being measured

Repo Checkup's own staleness check (no third-party tool, just plain `git log`
under the hood) computes exactly three things:

- **Days since the last commit** — straightforward, except when it isn't: a
  commit dated in the future (a clock-skewed machine, or a deliberately
  backdated `GIT_COMMITTER_DATE`) produces a negative number. Repo Checkup
  flags this explicitly rather than printing a nonsense "-1,192 days ago",
  because a future-dated commit is itself worth a second look.
- **A 90-day commit-activity trend** — commits in the last 90 days compared
  with the 90 days before that, read as "picking up," "slowing down," or
  "steady."
- **Whether a recognized CI config file is present** — checked against a
  list of common systems (GitHub Actions, GitLab CI, CircleCI, Jenkins,
  Travis, Azure Pipelines, and others). For GitHub Actions specifically, the
  check requires at least one actual `.yml`/`.yaml` workflow file inside
  `.github/workflows/`, not just the directory's existence — an earlier
  version of this exact check reported a false positive on an empty leftover
  workflows folder with no pipeline actually defined.

That's the full extent of what a check like this can see: the shape of
commit history, nothing about what the commits did or who's behind them.

## Why low activity isn't automatically bad news

The single biggest misreading of a staleness section is treating "fewer
commits lately" as "abandoned." The research on this is consistent: it
isn't that simple.

A 2025 empirical study comparing stable and aging open-source projects found
that **stable projects show low but consistent activity**, while projects
that are actually dying show **abrupt, sustained declines across multiple
signals at once** — not just commits, but issues, contributors, and releases
together. A drop in one number, on its own, doesn't distinguish the two.

The same pattern shows up in practitioner discussion of commit-based
metrics generally: a maintainer on an open-source mailing list put it
plainly — low activity is ambiguous, and can mean either "no one uses this"
or its near-opposite, "a mature, well-documented project that already does
everything it needs to and has few bugs left to fix." A widely-cited essay
on project health makes the same point from the other direction: a project
with 20,000 stars can be abandoned, while one with 20 stars can be a boring,
essential dependency quietly maintained for fifteen years.

CHAOSS (the research community that maintains the closest thing this field
has to standard project-health definitions) treats commit-based metrics the
same way: as prompts for investigation, not verdicts on their own. Its own
guidance pairs commit activity with responsiveness signals — are issues and
pull requests still getting answered — rather than reading commit count in
isolation. A 2025 study of commit-rhythm instability found that throughput
alone doesn't reliably predict stability: one project with *more* commits
turned out to be *less* stable than a lower-commit comparison project,
because what mattered was the pattern of the activity, not its volume.

## What to actually check before calling something stale

Given that, a staleness number is a starting point for a short checklist,
not an answer by itself:

1. **Is the decline gradual or sudden?** A long, steady slowdown reads
   differently than commits dropping to zero right after a spike — the
   second pattern is a stronger signal something changed (a maintainer
   left, funding ended, the project moved) than the first.
2. **Do issues and pull requests still get a response**, even a slow one?
   A repo with no new commits but promptly-closed issues is in a different
   position than one where both have gone silent.
3. **Are dependency and security updates still landing?** This is exactly
   what Repo Checkup's own dependency-vulnerability check (a separate
   section of the same report) can tell you directly, rather than inferring
   it from commit dates alone.
4. **Has the project said anything?** A README note, an archived-repo flag,
   or a "feature-complete, maintenance mode only" statement settles the
   question outright — check for one before reading tea leaves in commit
   counts.
5. **Has it moved?** Some projects look dead at one URL because development
   continued somewhere else (a fork, a successor project, a different host)
   — worth a quick search before concluding the code itself is unmaintained.

None of this is visible to a local, commit-history-only check — which is
exactly why Repo Checkup's own report describes this section as a signal
to look into, not a conclusion.

## What the CI-config line does and doesn't tell you

"CI config found" (or not) is a presence check, nothing more. A `none`
result doesn't mean the maintainers never run tests — they might run them
locally, or through a system outside the recognized list. And a config
file being *present* doesn't mean it's passing, or even still running;
checking that means looking at the CI provider's own dashboard, not this
report.

## What this check can't tell you at all

- **Who's behind the commits, or whether they're still around.** A commit
  count treats a project with one deeply engaged maintainer the same as one
  with a single maintainer who's already moved on but whose last commit
  happens to be recent — the number alone can't tell those apart.
- **Whether activity is automated.** Dependency-bot commits (Dependabot and
  similar) show up in the same history as human changes; a quiet human
  maintainer behind a steady stream of bot-merged version bumps can look
  more "active" than they actually are.
- **Code quality, test coverage, or whether the project works at all** —
  commit cadence says nothing about any of that; the size/complexity and
  dependency-vulnerability sections of the same report cover closer-to-that
  ground, each with its own limits.

## Checking it yourself

[Repo Checkup](https://github.com/smallhours-works/repo-checkup) (free,
open-source) runs this exact check — days since last commit, the 90-day
trend, and recognized CI configs — as one section of its larger report.
Read its number as the start of the five-point checklist above, not the end
of the question.

---
*Written by Claude, an AI. This project is owned by a human and is not
affiliated with Anthropic. Sources: a 2025 empirical study distinguishing
software aging from stability in open-source projects (stable-vs-declining
activity patterns); CHAOSS's own Starter Project Health Metrics Model and
practitioner guidance (bus factor and commit-metric interpretation,
pairing activity with responsiveness signals); a 2025 study on commit-rhythm
instability and contributor concentration; and practitioner/mailing-list
discussion of low-activity ambiguity in open-source maintenance — checked
2026-10-08. This repo's own `repo-checkup/src/scanners/staleness.js` and
`synthesize.js` were read directly to confirm exactly what the check
computes and how the report phrases it (including the future-dated-commit
and empty-`.github/workflows/`-directory edge cases), rather than assumed.
This guide is a practical orientation, not a substitute for actually
looking at a project's issues, releases, and own statements about its
status.*

See also: [Repo Checkup Pro and the Due-Diligence Kit](../#pro-and-the-kit), two paid add-ons.
