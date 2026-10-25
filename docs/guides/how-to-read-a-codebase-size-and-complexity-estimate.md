# How to read a codebase's size & complexity estimate

Written by Claude, an AI, as part of Small Hours — a project owned by a human,
not affiliated with Anthropic.

You're sizing up a codebase, and the report hands you a dollar figure: "Rough
effort estimate to rebuild from scratch: $340,000, ~8.2 months, ~4.1 people."
It looks precise. It isn't. Here's what that number is actually built from,
and what it's safe (and not safe) to do with it.

## Where the number comes from

A size/complexity check (Repo Checkup's own section included, backed by the
open-source `scc` tool) counts lines of code per language, then runs that
total through **COCOMO** (the Constructive Cost Model), a formula Barry Boehm
published in 1981. In its default "basic" form, COCOMO takes exactly one
input — thousands of lines of code (KLOC) — and estimates:

- **Effort** (person-months) = a × (KLOC)^b
- **Schedule** (months) = c × (Effort)^d
- **Cost** ≈ effort × an assumed average wage

`scc` (and Repo Checkup's own report through it) uses COCOMO's default
"organic" project profile — Boehm's term for small teams solving a
well-understood problem, the easiest of his three categories — and a default
average-wage assumption (`scc`'s own default is $56,286/year) unless someone
reconfigures it. Nothing about the codebase's actual language, architecture,
test coverage, or team is in that formula. It's lines of code, in, dollars
out.

## What it's actually useful for

Despite the above, the number isn't worthless. It's a **rough order-of-magnitude
sanity check**: a 400-line script and a 400,000-line monolith obviously need
different conversations, and COCOMO will tell the two apart loudly even
though it gets the details wrong. For a freelancer deciding whether a "quick
job" is actually a quick job, or a buyer sanity-checking a seller's claim
that the codebase is "small," this is enough to catch a gross mismatch
between the pitch and the reality — before you've spent real time reading
code.

## What it can't tell you — and why that matters more as the stakes go up

The basic COCOMO form behind this estimate has exactly one input — lines of
code — so its accuracy ceiling is set by that one number. Lines of code
doesn't capture:

- **Code quality.** A clean, well-tested 10,000-line codebase and a tangled,
  untested 10,000-line one get the *same* COCOMO estimate. The number has no
  opinion on whether the code is good.
- **How much of it the team actually wrote.** Vendored dependencies,
  generated code (ORM models, API clients, protobuf output), and boilerplate
  from a scaffolding tool all count as "lines of code" to a counter like
  `scc`, inflating the estimate for effort nobody actually spent.
- **Verbosity differences between languages.** COCOMO's original assumption
  — that a line of code costs roughly the same to produce regardless of
  language — has been a standing objection since it was proposed (see the
  Python-list critique in sources): ten lines of dense Python might do what
  forty lines of boilerplate-heavy code in a more verbose language does, so
  comparing raw COCOMO estimates *across* languages is comparing noise.
- **What it would actually take to replace this specific system**, as
  opposed to building something of the same size from a blank page with a
  well-understood spec. Rebuilding a legacy system usually means
  reverse-engineering undocumented business rules, migrating live data, and
  matching quirky behavior nobody wrote down — none of which shows up in a
  line count. A course-level summary of COCOMO's track record (see sources)
  puts its estimates within a factor of 2 only around 60% of the time even
  on the kind of greenfield projects it was built for; a legacy-rebuild
  scenario is a worse fit than that, not a better one.
- A commenter on one long-running COCOMO discussion thread (see sources)
  makes a sharper point: the model was built to estimate effort for a new
  project of a given size, not to put a dollar value on an *existing*
  system — using it as if it were a valuation figure is already outside
  what it was designed to answer.

**The practical rule:** treat the dollar figure as "how big is this, roughly"
— not "what is this worth," "what would it cost to replace," or "how long
will my actual task take." For due diligence or pricing a quote, it's a
starting conversation, never the only number you act on.

## If you look at the raw scan data: complexity is a separate number, and it isn't in the cost estimate

The underlying `scc` tool (and Repo Checkup's raw scan output, if you open it
directly rather than just reading the synthesized report) also computes a
per-language complexity count alongside the lines-of-code totals — easy to
assume that number is what's driving the "harder codebase = bigger estimate"
intuition. It isn't: COCOMO's basic form, the one behind the cost/schedule/
people figures, takes lines of code as its only input. The complexity count
(a rough per-file structural-complexity tally, not a monetary factor) is a
separate, informational number — useful on its own as a pointer to where the
gnarliest code lives, but it doesn't feed into the dollar estimate at all.
Don't read a high complexity count as the reason a cost number went up; check
the line count for that.

## What a reasonable use of this section looks like

1. Use the line count and top-language breakdown to get oriented: is this a
   small script, a mid-size app, or a genuine multi-hundred-thousand-line
   system? That framing alone is worth having before you read a line of
   actual code.
2. Use the COCOMO dollar figure as a rough scale check against what you were
   told going in — a seller or client claiming "small codebase" for
   something that comes back at 200,000 lines is worth a direct question,
   regardless of what the exact dollar number says.
3. Don't quote a price, make an offer, or size a project timeline off this
   number alone. Read representative files, check the other sections of the
   report (tests, staleness, dependencies), and talk to whoever has actually
   worked in the code.
4. If you dig into the raw scan output and find a complexity figure there,
   treat it as a pointer to *where* to look closer (which files or modules
   are the densest), not as part of the cost math.

## Checking it yourself

If you're using [Repo Checkup](https://github.com/smallhours-works/repo-checkup)
(free, open-source) to scan a repo, its "Size & complexity" section reports
the line count, top languages, and the same COCOMO-style rebuild estimate
described above, labeled explicitly as "a rough-order-of-magnitude estimate
from source size, not a quote" — worth reading that label literally, for
exactly the reasons above.

---
*Written by Claude, an AI. This project is owned by a human and is not
affiliated with Anthropic. Sources: `scc`'s own documentation (github.com/
boyter/scc) for its default COCOMO parameters (organic project type, default
assumed wage) and that complexity is reported separately from the cost
estimate; Boehm's original COCOMO model and its "organic/semi-detached/
embedded" project categories; a course-level summary of COCOMO's estimation
accuracy bounds (within a factor of 2 roughly 60% of the time); a long-
standing critique that COCOMO's constant-cost-per-line-of-code assumption
doesn't hold evenly across languages; and a public discussion thread arguing
COCOMO is intended to estimate new-project effort, not to value an existing
codebase — checked 2026-10-08. This guide explains what the estimate means,
not how to price a specific deal; for anything beyond a rough gut check,
read the actual code.*

See also: [Repo Checkup Pro and the Due-Diligence Kit](../#pro-and-the-kit), two paid add-ons.
