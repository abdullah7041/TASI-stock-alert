# Handoff — what is done, and what is left

Written 2026-08-12 at the end of an audit-and-execution session. Read this
first if you are picking the work up cold.

## State

`main` carries plans 01–09 from
[the plan index](README.md), all executed, reviewed, and merged. Verified on the
final tree:

| Check | Result |
|---|---|
| `python -m pytest test_core.py research/test_base_rate.py -q` | 203 passed |
| `npm run build` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | 16 pass / 0 fail |

Rollback point: branch `rollback-pre-merge-2026-08-10`.

## ⚠ Before this reaches the default branch

**Add the GitHub Actions secret `COCKPIT_SIWC_BYPASS_TOKEN` first.**

`.github/workflows/tasi.yml` now guards the cockpit upload with
`test -n "$COCKPIT_SIWC_BYPASS_TOKEN"`. If that secret is absent when the
scheduled pre-open digest next runs, the step fails, the **"Commit state" step
is skipped**, and that day's `history.json`, `symbols.json`, and
`news_archive.jsonl` updates are lost. Day-over-day deltas and trend streaks
break until a later run repairs the gap.

Pushing a *branch* is safe — `ci.yml` is read-only and carries no secrets, and
`tasi.yml` only fires on schedule and manual dispatch. The risk begins when this
lands on the default branch.

Then, in order: deploy the private Sites app (keep the prior version for
rollback), trigger one manual `digest` run, and **confirm the data actually
reached the cockpit**. The design doc is explicit that a green workflow is not
sufficient evidence — check that `/api/dashboard` returns a real snapshot with a
Riyadh timestamp, the UI renders without a hook-order crash, and one current
qualified candidate can open research.

## Remaining work, not yet planned

These are real, evidence-backed findings from the original audit that were
surfaced but deliberately left below the bar for that batch. Each needs a plan
written before execution — none is specified well enough to hand straight to an
executor.

### 1. `GET /api/dashboard` has no application-level auth

`app/api/dashboard/route.ts` checks only that `env.DB` exists. It relies
entirely on the hosting platform's private-site gate, unlike
`/api/dashboard/ingest`, which carries its own bearer token. Defence in depth on
the one route that exposes holdings and P/L.

Check first whether `app/lib/dashboard-access.ts` (added by the cockpit repair)
changes the picture before writing anything.

### 2. A Discord outage costs a day of history

`main.py`'s `mode_digest` returns `1` when `send_discord` fails. That fails the
workflow step, which skips "Commit state", which discards the run's
`history.json` and `symbols.json` writes. A notification-delivery failure should
not destroy computed state — the digest already succeeded by that point.

Consider decoupling: persist state, then report delivery failure via exit code
or a separate step.

### 3. `news_archive.jsonl` grows without bound, committed every run

~302 KB and rising, appended by `news.archive_headlines` and committed by the
workflow on every digest run — roughly 64 lines a day. The growth is
*intentional*: `news.py:158-180` documents that this archive is the only path to
ever validating news against price outcomes. The storage strategy is what needs
revisiting, not the archiving.

### 4. `dashboard.json` is tracked and churns

It is regenerated every digest run and committed, which produced the single
merge conflict in this session's work. The repair branch fixed the *test* that
was dirtying it (`test_core.py`'s digest test now monkeypatches `_save`), but the
file itself is still tracked. Consider `.gitignore`, weighed against the fact
that the workflow currently commits it deliberately.

### 5. `news._fetch_rss` parses remote XML with `xml.etree.ElementTree`

`news.py:70`. Entity-expansion exposure on two remote feeds (Google News,
Argaam). CI-only surface and low stakes, but non-zero. `defusedxml` is the
standard answer.

### 6. `disclosures.match_company` substring-matches short aliases

`disclosures.py:75-76` lowercases and substring-matches every alias against an
all-company feed. `config.py` lists `"EIC"` — a three-character substring
against every Tadawul filing title. `config.py:36-38` already records that real
coverage never uses the bare initialism, so the alias is both ineffective and
false-positive prone. Word-boundary matching for short ASCII aliases would fix
it; `news._contains` already implements exactly that pattern and is worth
reusing.

### 7. `TECH["rsi_overbought"]` and `TECH["rsi_oversold"]` are dead

Read by nothing in engine code; present only in five `test_core.py` fixture
dicts. Same class as the seven `RISK` keys plan 03 removed, but lower stakes —
the README never described them as live behaviour, so the honesty problem does
not apply. Straightforward cleanup.

## Direction options, not defects

From the original audit. These are choices for the maintainer, not problems.

- **An outcome ledger.** The README claims triggers are falsifiable — "check
  tomorrow whether the stated price did what was claimed" — but nothing records
  the claim or scores it. Same for scanner candidates, which have measured base
  rates and no follow-up. `history.py` already does per-code daily snapshots
  with a 90-day cap, so the storage exists; adding `triggers` to
  `main._snapshot_for` plus a scoring pass would give the repo its first
  self-accuracy number.
- **A news validation harness.** `backtest.py` hardcodes `news_score=0.0`
  "because no historical headlines existed". They exist now — dated, per-code,
  with matched lexicon terms. Build-now, read-in-six-months.
- **Holdings editing in the cockpit.** README says `config.py` is "the only file
  you edit"; editing holdings currently means a git commit. The cockpit already
  has owner auth, D1, and a write path. Trade-off: moving config into a database
  breaks the everything-in-git auditability the repo clearly values.

## Notes for whoever executes next

Two environment hazards cost several runs in this session. Both are recorded in
detail in [the plan index](README.md); the short version:

- **Agent worktrees start on a stale base.** Several landed ~20 commits behind
  `main`. Begin every dispatch by proving isolation
  (`git rev-parse --show-toplevel` contains `worktrees`), then checking
  `git merge-base --is-ancestor HEAD <target>` and explicitly authorising
  `git reset --hard <target>` when it is a clean fast-forward on an empty tree.
- **The Bash tool is unreliable here.** `head`, `tail`, `date`, `cat`, `timeout`,
  `wc`, `python`, and a wrapper called `rtk` all intermittently vanished from
  PATH mid-session, and `rtk` was observed silently garbling `git` output. Use
  PowerShell for `git`, `python`, and `node`.

And one process note worth internalising: **four criteria in this plan set were
wrong because the author asserted an expected outcome without running the command
first.** Every one was caught by an executor that measured, disagreed, and
stopped. When writing a plan, run the verification command before writing it
down as a done criterion.
