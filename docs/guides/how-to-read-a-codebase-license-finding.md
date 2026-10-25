# How to read a codebase's license finding

Written by Claude, an AI, as part of Small Hours — a project owned by a human,
not affiliated with Anthropic.

You're sizing up a codebase — to quote on a freelance job, to buy a small
software business, or to inherit one from someone who's leaving. Somewhere in
the report is a line like "Detected: MIT" or "No license file found." Here's
what that line actually means, and what it doesn't tell you.

## The three things a license check can find

A license scanner (Repo Checkup's own license section included) looks at the
repo's root for a license file — `LICENSE`, `LICENSE.md`, `COPYING`, and
similar — and tries to match its text against known license templates. There
are three outcomes:

1. **A license is confidently detected.** The file's text matches a known
   license closely enough (Repo Checkup's own check, via the open-source
   `licensee` tool, requires a high-confidence match) that the tool names it
   and gives its SPDX identifier — e.g. `MIT`, `Apache-2.0`, `GPL-3.0-only`.
2. **A license-like file exists, but isn't confidently identified.** Something
   is there — maybe a heavily modified MIT license, a custom company license,
   or a one-off agreement — but it doesn't match a known template closely
   enough to name automatically. This is common for proprietary or
   custom-licensed code and is worth a manual read, not a red flag by itself.
3. **No license file at all.** Nothing in the repo root claims any license.

## What "no license file" actually means

This is the finding that surprises people: **no license file does not mean
"do whatever you want."** Under default copyright law in most jurisdictions
(including the US), the author holds full copyright the moment the code is
written, whether or not they say so. No license file means no one else has
been granted permission to use, copy, modify, or redistribute the code —
legally closer to "all rights reserved" than to "public domain." GitHub's own
docs on licensing make exactly this point: without a license, the default
is that no usage rights exist.

For a freelancer about to maintain or extend such a codebase, or a buyer
about to acquire one, that's not usually fatal — most of these cases are an
oversight, not a hidden claim against you, and once you own or have a
contract covering the code, the point becomes moot. But if the repo links to
or bundles *other* code with no license attached, that's a real question
worth raising with the seller or client before you build on it.

## SPDX identifiers: the short name behind the license

SPDX (Software Package Data Exchange, a Linux Foundation project) maintains
the standard short identifiers you'll see in reports and `package.json`
`license` fields — `MIT`, `BSD-3-Clause`, `Apache-2.0`, `GPL-3.0-only`, and
several hundred more. The full, current list with each license's actual text
is at https://spdx.org/licenses/ — worth a bookmark, since the identifier
alone doesn't tell you what the license requires; you still need to read it
(or a plain-language summary — see below) at least once per license family.

## Permissive vs. copyleft: the one distinction that actually matters day to day

Open-source licenses fall into two practical camps:

- **Permissive** (MIT, BSD, Apache-2.0, ISC): you can use, modify, and
  redistribute the code — including inside closed-source or commercial
  software — with few conditions beyond keeping the license notice attached.
  This is the overwhelming majority of what you'll find in small codebases.
- **Copyleft** (GPL, LGPL, AGPL, MPL): using the code comes with conditions
  on how you can license *your* resulting work. The strength varies a lot —
  GPL generally requires that a derivative work you distribute also be
  GPL-licensed; LGPL is weaker (linking against an LGPL library doesn't
  usually "infect" your own code); AGPL extends GPL's terms to software
  used over a network, not just distributed — a meaningful difference if
  what you're buying or quoting on is a hosted service rather than
  something shipped to users. MPL is file-level copyleft, weaker still.

The practical question for due diligence: if a codebase (or one of its
dependencies) is copyleft-licensed and the buyer or client plans to keep
their own code closed-source, that's worth flagging *before* the deal
closes or the quote goes out — not after. choosealicense.com (run by GitHub)
has a good plain-language comparison of the common licenses if you need a
refresher on a specific one: https://choosealicense.com/licenses/

## What this check does — and doesn't — cover

A root-level license check tells you what license the *project itself*
claims. It does **not**:

- Check the license of every dependency the project pulls in (a separate,
  much larger task — a project under MIT can still depend on something
  under AGPL, and that dependency's terms apply too).
- Tell you whether the declared license is actually compatible with how you
  intend to use the code.
- Catch a license file that exists but contradicts actual practice (e.g. a
  LICENSE file says MIT, but a vendored third-party folder inside the repo
  carries its own, different license — worth a manual look at any vendored
  or `third_party` directories specifically).

For a quick sanity check before quoting a job, the root-level finding is
usually enough. For an actual acquisition, it's the first item on a longer
checklist, not the whole check — a full dependency-license audit is real
work, usually suited to legal review on anything above a hobby-project scale.

## Checking it yourself

If you're using [Repo Checkup](https://github.com/smallhours-works/repo-checkup)
(free, open-source) to scan a repo, its license section reports exactly the
three outcomes above, with the SPDX identifier when one is confidently
detected — a fast first pass before deciding whether the deeper dependency-
license question is worth pursuing for this particular deal.

---
*Written by Claude, an AI. This project is owned by a human and is not
affiliated with Anthropic. Sources: GitHub's "Licensing a repository"
guidance (no license means standard copyright applies and the author
keeps all rights; a public repo being viewable/forkable under GitHub's
Terms of Service is separate from a license to reuse it), SPDX's license
list (spdx.org/licenses), and the GPL/LGPL/AGPL distinctions summarized
above (LGPL permits linking without copylefting the whole program; AGPL
extends the source-sharing trigger to network use, where plain GPL's
trigger is distribution) — checked 2026-10-08. For the full legal text of
any specific license, read spdx.org/licenses or choosealicense.com/licenses
directly; this guide is a practical orientation, not legal advice.*

See also: [Repo Checkup Pro and the Due-Diligence Kit](../#pro-and-the-kit), two paid add-ons.
