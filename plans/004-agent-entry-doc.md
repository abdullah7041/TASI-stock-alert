# Plan 004: Add a CLAUDE.md so agents stop rediscovering this repo every session

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7bb9fdb..HEAD -- .github/workflows/ci.yml package.json requirements.txt README.md`
> If any of these changed, re-derive the commands in step 2 from the live files
> rather than copying this plan's values.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `7bb9fdb` (origin/main), 2026-08-30 — re-based from 143b740; excerpts re-verified byte-identical at 7bb9fdb

## Why this matters

This repo is worked on heavily by coding agents — `.agents/`, `.claude/`,
`.superpowers/`, `docs/superpowers/plans/`, and `docs/CODEX-INSTRUCTIONS.md` all
exist — and there is no `CLAUDE.md` or `AGENTS.md` at the root. Every session
re-derives the same facts: which of the four test suites to run, that
`test_core.py` shares a module-level cache, that state JSON files are written by
the scheduler and must not be hand-edited, and that this codebase has one
strongly-held design rule that is easy to violate without knowing it.

The cost is paid per session, silently, forever. A single file fixes it.

## Current state

**There is no `CLAUDE.md` or `AGENTS.md`.** Verify before starting:
`ls CLAUDE.md AGENTS.md` → both "No such file or directory".

The facts below were verified at commit `143b740`. Re-check any that the drift
check flagged.

### Verification commands (from `.github/workflows/ci.yml`)

Python job:
```
pip install -r requirements.txt
python -m compileall -q main.py movement.py session_gate.py runtime research
python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q
```

Web job:
```
npm ci
npm run lint
npm run typecheck
npm test          # runs `npm run build` first, then node --test tests/*.test.mjs, then vitest
git diff --check
```

`npm test` requires the build because `tests/action-cockpit.test.mjs` imports
`../dist/server/index.js`.

### Repo shape

- **Two stacks in one repo.** A Python producer at the root (`main.py`,
  `analyze.py`, `data.py`, `notify.py`, `llm.py`, `scanner.py`, …) that runs on
  a GitHub Actions schedule and posts to Discord; and a TypeScript/React
  cockpit (`app/`, `worker/`, `db/`) deployed on Cloudflare Workers with D1.
  They communicate over authenticated HTTP ingest routes.
- `main.py` is a mode dispatcher — `MODES` maps a `MODE` env var to a
  `mode_*` function. That is the entry point for every scheduled job.
- Committed JSON at the root (`dashboard.json`, `state.json`, `history.json`,
  `movement_state.json`, `levels.json`, `symbols.json`, `news_archive.jsonl`,
  `top10_draft.json`) is **written by the scheduled job and committed back by
  the workflow**. Roughly 98 of 323 commits are these `state update [skip ci]`
  commits. Do not hand-edit them as a way of changing behaviour.
- Test suites: `pytest` (root `test_*.py` plus `research/test_*.py`),
  `node --test` (`tests/*.test.mjs`), `vitest` (`tests/ui/*`).

### The design rule that matters most

This codebase enforces a three-way honesty rule everywhere: **a failed fetch, an
empty result, and real content must never render identically.** It is stated in
`notify.py` (`_fmt_news` / `_fmt_disclosures`) and in `llm.py`'s module
docstring, and it is why so many functions return a reason string rather than an
empty value. Read `llm.py`'s module docstring before changing any code that
renders or degrades a data source. Violating this rule is the most common way a
change here is wrong while looking right.

### Convention notes worth recording

- Comments explain *why*, and frequently cite the incident that motivated the
  code (see `main.py:407-411`). Match that style; do not strip these comments.
- Test names are full sentences describing the guarantee, usually with a
  docstring explaining what broke.
- `data.py` has a module-level `_HISTORY_CACHE` keyed by `(code, period)` that is
  **never reset between tests**. Data-layer tests pass a unique `period` string
  per test to avoid cross-test contamination.

## Commands you will need

| Purpose         | Command                             | Expected on success |
|-----------------|-------------------------------------|---------------------|
| Confirm absence | `ls CLAUDE.md AGENTS.md`            | both not found      |
| Python CI       | `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` | 0 failures |
| Lint            | `npm run lint`                      | exit 0              |

## Scope

**In scope**:
- `CLAUDE.md` (create, repo root) — the only file this plan creates.

**Out of scope** (do NOT touch):
- `README.md` — it is the human-facing doc and is already thorough. Do not
  duplicate it; `CLAUDE.md` links to it.
- `docs/CODEX-INSTRUCTIONS.md` — a task brief for a specific piece of work, not
  a repo guide. Leave it alone.
- Any source file. This plan adds documentation only.
- Do **not** invent conventions. Everything in `CLAUDE.md` must be verifiable
  from the repo today. If you cannot verify a claim, leave it out.

## Git workflow

- Branch: `advisor/004-agent-entry-doc`
- Suggested commit: `docs: add CLAUDE.md so agents get the repo's rules up front`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the file does not already exist

**Verify**: `ls CLAUDE.md AGENTS.md` → both report "No such file or directory".
If either exists, STOP — this plan assumed it did not.

### Step 2: Re-derive the commands from source

Do not trust this plan's copies. Read `.github/workflows/ci.yml` and
`package.json` and use what they actually say today.

**Verify**: run each command you intend to document. Every one must succeed on a
clean checkout (except `npm test`, which needs a working build toolchain — note
it if your environment cannot build).

### Step 3: Write `CLAUDE.md`

Use this outline. Keep it under ~120 lines — an entry doc nobody reads is worth
nothing. Prefer pointers over prose.

```markdown
# CLAUDE.md

Guidance for coding agents working in this repository.

## What this is
(2-3 sentences: a Saudi/Tadawul equity alert system. A Python producer runs on
a schedule, analyses delayed daily market data, and posts a pre-open digest to
Discord; a Cloudflare Workers cockpit renders the same artifact for the owner.
Point at README.md for the full picture.)

## Verify before you claim anything works
(The exact commands from ci.yml, in a table, split Python vs web. State that
`npm test` builds first and why.)

## Layout
(Short table: root *.py = producer; app/ = cockpit UI + API routes; worker/ =
Workers entry; db/ = D1 schema; tests/ = node+vitest; research/ = offline
analysis; docs/ = findings and runbooks.)

## Rules that are easy to break
1. Three-way honesty: a failed fetch, an empty result, and real content must
   never render identically. Cite llm.py's module docstring and notify.py's
   _fmt_news. This is the most important rule in the repo.
2. Root JSON state files are written by the scheduled job and committed back by
   the workflow. Do not hand-edit them to change behaviour.
3. Comments explain why, and cite the incident that motivated them. Don't strip
   them when refactoring.
4. data.py's _HISTORY_CACHE is module-level and never reset between tests; new
   data-layer tests must use a unique `period` string.

## Testing conventions
(Three suites and what each covers; test names are full sentences; docstrings
explain what would break.)

## Secrets
(Never commit credential values. List the env var NAMES the system reads —
names only, no values — and say they are set as GitHub Actions secrets or
Worker secrets. Point at .github/workflows/tasi.yml for the producer's set.)
```

Write the real content, not the outline comments.

**Verify**: `wc -l CLAUDE.md` → between 60 and 130 lines.

### Step 4: Check every command you documented actually runs

For each command in the "Verify" section of your `CLAUDE.md`, run it and confirm
it behaves as documented. A wrong command in an entry doc is worse than no doc.

**Verify**: `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` → 0 failures, and `npm run lint` → exit 0.

### Step 5: Confirm no secret values

**Verify**: `grep -nE "(sk-|ghp_|xox|-----BEGIN)" CLAUDE.md` → no matches.
Environment variable **names** are fine; values are never acceptable.

## Test plan

No automated tests — this is a documentation file. Verification is that every
command it documents was executed successfully in step 4.

## Done criteria

ALL must hold:

- [ ] `CLAUDE.md` exists at the repo root
- [ ] `wc -l CLAUDE.md` → 60–130 lines
- [ ] Every command in it was run in step 4 and behaved as documented
- [ ] `grep -nE "(sk-|ghp_|xox|-----BEGIN)" CLAUDE.md` → no matches
- [ ] `git status --porcelain` shows only `CLAUDE.md` added, nothing modified
- [ ] The three-way honesty rule appears, citing `llm.py` and `notify.py`
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report back if:

- `CLAUDE.md` or `AGENTS.md` already exists.
- A command from `ci.yml` fails on a clean checkout — that is a real finding
  (a broken documented build) and more important than this plan.
- You are about to write a convention you could not verify in the repo. Leave it
  out and note the gap in your report instead.

## Maintenance notes

- `CLAUDE.md` goes stale the moment `ci.yml` or `package.json` scripts change.
  A reviewer changing either should check whether this file still matches.
- Deliberately deferred: an `.env.example` (finding #7 in the audit index) and a
  documented env-var inventory. `CLAUDE.md` names the variables; a separate file
  with placeholder values is a follow-up, not part of this plan.
- If the pending `claude/stock-analysis-brainstorm-xov5iu` branch merges, it adds
  `TASI_LLM_PROVIDERS`, `TASI_LLM_MODEL_OPENROUTER`, and
  `TASI_LLM_MODEL_GEMINI`, and changes `llm.py` from a single provider to a
  provider chain. The secrets section and any llm.py references will need
  updating then.
