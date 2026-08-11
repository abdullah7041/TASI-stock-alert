# Plan 01: Verify and stage the honest-cockpit repair branch for merge

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `docs/superpowers/plans/README.md`.
>
> **This plan does not merge, push, or deploy anything.** It produces a
> verified go/no-go report. The actual merge, the GitHub secret, and the Sites
> deployment are operator actions listed at the end — do not perform them.
>
> **Drift check (run first)**:
> `git diff --stat 6ada068..HEAD -- main.py app/ tests/ .github/workflows/tasi.yml`
> If any of those changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `6ada068`, 2026-08-10

## Why this matters

The private TASI Action Cockpit at `tasi-action-cockpit.busaud7041.chatgpt.site`
is running broken code right now. On `main` the daily digest sends the cockpit a
snapshot with **zero scanner candidates every single day**, the research routes
resolve symbols from a **hardcoded demo fixture** rather than the stored
snapshot (so real OpenAI spend is charged for researching a fixture symbol the
scanner never picked), and the React component **violates the rules of hooks**
so the page crashes the moment the fetched snapshot arrives.

All three are already fixed. A complete repair exists on the branch
`codex/fix-honest-daily-cockpit`, 15 commits ahead of `main`, matching the
design document at
`docs/superpowers/specs/2026-08-09-tasi-honest-daily-cockpit-repair-design.md`.
Nobody has verified it or merged it. This plan closes that gap: it proves the
branch is green and mergeable, and produces the exact operator checklist needed
to land it safely.

## Current state

### The three defects on `main`

**1. The dashboard snapshot never carries scanner results.** `main.py:342-353`:

```python
def mode_digest() -> int:
    regime, recs, budget = _collect_recs(include_news=True, record_history=True)
    msg = nt.build_message(recs, f"TASI pre-open digest ({_today()}) - regime: {regime}",
                           quote_note="Delayed/daily data. Long-term reads are the reliable ones.",
                           budget=budget)
    msg = msg + "\n\n" + _scanner_block()
    _save(DASHBOARD_FILE, _dashboard_snapshot(regime, recs, budget, None))
```

The fourth argument to `_dashboard_snapshot` is the literal `None`. Inside
(`main.py:154-167`) that makes `candidates = []`, so `qualified` is always `[]`
and `researchCount` is always `0`. `_scanner_block()` runs its own separate
scan purely for the Discord text and throws the result away.

**2. Research routes read a demo fixture, not stored data.**
`app/api/research/report/route.ts:1-9`:

```typescript
import { dashboardFixture } from "@/app/fixtures/dashboard";
import { createOrReuseReport, getPrivateResearchContext } from "@/app/lib/research-agent";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { symbol?: string };
    const candidate = dashboardFixture.qualified.find((item) => item.code === body.symbol);
```

`app/api/research/chat/route.ts:7` does the same. `app/fixtures/dashboard.ts:26-38`
hardcodes exactly one qualified candidate: code `1150`, "Alinma Bank".

**3. React hook order changes between renders.** `app/components/ActionCockpit.tsx:12-21`:

```tsx
export function ActionCockpit({ dashboard }: { dashboard: DashboardFixture | null }) {
  const [latestDashboard, setLatestDashboard] = useState<DashboardFixture | null>(dashboard);
  useEffect(() => { /* fetch("/api/dashboard") ... */ }, []);
  dashboard = latestDashboard;
  if (!dashboard) return <main className={styles.cockpit}><p className={styles.subtitle}>Loading the latest saved daily digest…</p></main>;
  const [selectedCandidate, setSelectedCandidate] = useState<DashboardFixture["qualified"][number] | null>(null);
```

The third hook (`useState` on line 21) sits **after** an early return. `app/page.tsx`
renders `<ActionCockpit dashboard={null} />`, so the first render takes the early
return with 2 hooks and the post-fetch render tries 3.

### Baseline: `main` is already red

Both of these were measured at commit `6ada068`. Do not assume a clean starting
point:

- `npm run lint` → **exit 1**, one error:
  `app/components/ActionCockpit.tsx:21  react-hooks/rules-of-hooks  React Hook "useState" is called conditionally.`
- `npm test` → **exit 1**, 10 pass / 2 fail. Both failures are in
  `tests/action-cockpit.test.mjs` ("limits Home scanner cards to qualified names
  and labels preview data", "offers research only from a qualified scanner
  card"). They assert on fixture strings that `app/page.tsx` no longer renders
  server-side.
- `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q`
  → **199 passed** (this one is green).

Neither the lint nor the JS test run happens in CI — `.github/workflows/tasi.yml:39`
runs only `pytest test_core.py research/test_base_rate.py`. That is why a red
tree shipped. Closing that CI gap is plan 02 and must land *after* this one.

### The repair branch

`codex/fix-honest-daily-cockpit`, checked out at
`.worktrees/fix-honest-daily-cockpit`. Confirmed facts:

- `git merge-base main codex/fix-honest-daily-cockpit` → `6ada068`, which **is**
  `main`'s HEAD. `git merge-base --is-ancestor main codex/fix-honest-daily-cockpit`
  succeeds, so **`git merge --ff-only` will work** — no merge commit, no conflicts.
- `git diff --stat main...codex/fix-honest-daily-cockpit` → 21 files, 735
  insertions, 172 deletions.
- Its repair commits, newest last:
  `1006872 fix: preserve real scanner data in cockpit snapshots`,
  `fcdd786 fix: validate and age daily cockpit snapshots`,
  `d3c637c fix: base cockpit research on current stored data`,
  `93d7309 fix: show honest daily cockpit states`,
  `8a8aa82 fix: authenticate daily cockpit ingestion`,
  `4c80c4a docs: plan honest daily cockpit repair`,
  `af01279 test: keep digest fixture isolated`.
- `git grep -n "dashboardFixture" codex/fix-honest-daily-cockpit -- app/api app/page.tsx`
  returns nothing — the fixture is out of the production path.
- `main.py` on the branch wires the scanner through properly (new `_scanner_result()`
  helper at line 313, used at lines 365-367) and emits a richer snapshot with
  `schemaVersion`, `tradeDate`, `warnings`, and `dataStatus: "delayed-daily"`.
- Two new files: `app/lib/dashboard-access.ts` (loads the stored snapshot and
  derives freshness for research routes) and `app/lib/dashboard-types.ts`.

### The one thing that will break production if missed

The branch changes `.github/workflows/tasi.yml` to require a **second** secret:

```yaml
          COCKPIT_SIWC_BYPASS_TOKEN: ${{ secrets.COCKPIT_SIWC_BYPASS_TOKEN }}
          COCKPIT_INGEST_TOKEN: ${{ secrets.COCKPIT_INGEST_TOKEN }}
        run: |
          test -n "$COCKPIT_SIWC_BYPASS_TOKEN"
          test -n "$COCKPIT_INGEST_TOKEN"
          curl --fail-with-body --retry 3 --retry-delay 2 \
            -X POST https://tasi-action-cockpit.busaud7041.chatgpt.site/api/dashboard/ingest \
            -H "OAI-Sites-Authorization: Bearer $COCKPIT_SIWC_BYPASS_TOKEN" \
            -H "Authorization: Bearer $COCKPIT_INGEST_TOKEN" \
```

`test -n "$COCKPIT_SIWC_BYPASS_TOKEN"` fails the step when the secret is absent.
That secret does **not** exist in the repo today (only `DISCORD_WEBHOOK_URL`,
`SAHMK_API_KEY`, and `COCKPIT_INGEST_TOKEN` are referenced on `main`). If the
merge lands before the secret is configured, the next pre-open digest job fails
at that step, which also skips the "Commit state" step, which loses that day's
`history.json` and `symbols.json` updates.

**Never write any secret value into this repository, into a plan, into a commit,
or into your report.** Reference secrets by name only.

### Repo conventions

- Commit messages are Conventional Commits, lowercase subject, no trailing
  period: `fix: preserve real scanner data in cockpit snapshots`,
  `feat: sync daily digest to cockpit`, `docs: design honest daily cockpit repair`.
- Python tests live in `test_core.py` (188 tests) and `test_cockpit.py`;
  JS tests live in `tests/*.test.mjs` and use `node:test` + `node:assert/strict`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Python tests | `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` | exit 0, all pass |
| Lint | `npm run lint` | exit 0, no errors |
| JS build + tests | `npm test` | exit 0, all pass |
| JS tests only (after a build) | `node --test tests/*.test.mjs` | exit 0, all pass |

`npm test` is `npm run build && node --test tests/*.test.mjs` — the build is
required because `tests/action-cockpit.test.mjs` imports `../dist/server/index.js`.
It takes roughly 30 seconds.

## Scope

**In scope** (the only files you may modify):

- `docs/superpowers/plans/README.md` — your status row only.
- A report file at `docs/superpowers/plans/2026-08-10-01-verification-report.md`
  (create).

**Out of scope** (do NOT touch):

- Every source file. This plan verifies; it does not change behavior. If you
  find a defect on the branch, record it in the report and STOP.
- `git merge`, `git push`, `git rebase`, `git branch -d`, and any `gh` command.
  Landing the branch is an operator decision.
- `.worktrees/tasi-research-agent`, `.worktrees/tasi-research-agent-lean`,
  `.worktrees/tasi-sites-source-sync` — unrelated branches, some already
  squash-merged into `main`.
- Any Cloudflare, Wrangler, or OpenAI Sites deployment command.

## Git workflow

- Do all verification on a **detached checkout** of the branch tip in a
  throwaway worktree of your own, or in the existing
  `.worktrees/fix-honest-daily-cockpit` if it is clean
  (`git -C .worktrees/fix-honest-daily-cockpit status --short` was empty at
  planning time). Do not switch `main`'s working tree.
- Commit only the report file and the index row, message:
  `docs: verify honest cockpit repair branch`.
- Do NOT push.

## Steps

### Step 1: Confirm the branch still fast-forwards

```bash
git merge-base --is-ancestor main codex/fix-honest-daily-cockpit && echo FF-OK || echo FF-BROKEN
```

**Verify**: prints `FF-OK`. If it prints `FF-BROKEN`, `main` has moved since
this plan was written — STOP and report.

### Step 2: Record the exact branch tip and diff surface

```bash
git rev-parse --short codex/fix-honest-daily-cockpit
git diff --stat main...codex/fix-honest-daily-cockpit
```

**Verify**: the file list matches the 21 files named in "Current state". Write
both outputs into the report file. If files outside `main.py`, `app/`, `tests/`,
`test_core.py`, `.github/workflows/tasi.yml`, `docs/`, and the generated data
files (`dashboard.json`, `history.json`, `news_archive.jsonl`) appear, record
them and continue — but flag them in the report.

### Step 3: Confirm the three defects are actually fixed on the branch

Run each of these against the branch and confirm the stated expectation:

```bash
git grep -n "dashboardFixture" codex/fix-honest-daily-cockpit -- app/api app/page.tsx
```
**Verify**: no output. (The demo fixture is out of the production path.)

```bash
git show codex/fix-honest-daily-cockpit:main.py | grep -n "_dashboard_snapshot(regime, recs, budget"
```
**Verify**: the call passes `scanner_result`, not `None`.

```bash
git show codex/fix-honest-daily-cockpit:app/components/ActionCockpit.tsx | grep -n "useState\|useEffect\|return <main\|if (!"
```
**Verify**: every `useState`/`useEffect` line number is smaller than every
early-`return` line number — no hook is declared after a conditional return.

Record all three results in the report.

### Step 4: Run the full verification suite on the branch tip

In your worktree checkout of the branch (a `node_modules` install may be
required there — if `npm test` fails because `node_modules` is missing, that is
an expected environment gap; run `npm ci` **inside the throwaway worktree only**,
never in the main working tree):

```bash
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q
npm run lint
npm test
```

**Verify**: all three exit 0. Record the exact pass/fail counts.

Compare against the `main` baseline recorded in "Current state" (lint: 1 error;
`npm test`: 10 pass / 2 fail; pytest: 199 passed). The branch must be **strictly
better** — green on all three.

If any command is red on the branch, STOP and report exactly which assertions
fail, with their file and line. Do not attempt to fix them.

### Step 5: Write the verification report

Create `docs/superpowers/plans/2026-08-10-01-verification-report.md` containing:

1. The branch tip SHA and the fast-forward confirmation from step 1.
2. The `git diff --stat` from step 2.
3. The three defect-fix confirmations from step 3.
4. The three command results from step 4, with counts, next to the `main`
   baseline for each.
5. A one-line verdict: `GO` or `NO-GO`, with the reason.
6. Verbatim copy of the "Operator checklist" section below.

**Verify**: `test -f docs/superpowers/plans/2026-08-10-01-verification-report.md`
exits 0 and the file contains the string `GO` or `NO-GO`.

## Test plan

No new tests. This plan verifies an existing branch's existing suite. The
branch already updates `tests/action-cockpit.test.mjs` (+25 lines),
`tests/dashboard-core.test.mjs` (+29), `tests/research-core.test.mjs` (+20), and
`test_core.py` (+32) — confirming those pass **is** the test plan.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git merge-base --is-ancestor main codex/fix-honest-daily-cockpit` exits 0
- [ ] On the branch tip: `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` exits 0
- [ ] On the branch tip: `npm run lint` exits 0
- [ ] On the branch tip: `npm test` exits 0
- [ ] `git grep -n "dashboardFixture" codex/fix-honest-daily-cockpit -- app/api app/page.tsx` returns no output
- [ ] `docs/superpowers/plans/2026-08-10-01-verification-report.md` exists and states GO or NO-GO
- [ ] `git status --porcelain` shows no modified file outside `docs/superpowers/plans/`
- [ ] `docs/superpowers/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 prints `FF-BROKEN` — `main` moved and the merge is no longer trivial.
- Any command in step 4 is red on the branch tip. Report the failing assertions
  verbatim; do not fix them.
- A defect check in step 3 fails — the branch does not actually fix what this
  plan claims it fixes.
- The `.worktrees/fix-honest-daily-cockpit` working tree is dirty
  (`git -C .worktrees/fix-honest-daily-cockpit status --short` is non-empty).
  Uncommitted work there means someone is mid-edit.
- You conclude a source change is needed. That is a different plan.
- You find yourself about to run `git merge`, `git push`, or a deploy command.

## CORRECTION (2026-08-10, after execution) — the merge is NOT a fast-forward

Everything this plan says about fast-forwarding was measured against **local**
`main` at `6ada068`. Local `main` is stale. Verified afterwards:

```
$ git rev-list --left-right --count main...origin/main
1       6
$ git merge-base --is-ancestor origin/main codex/fix-honest-daily-cockpit
(fails — FF-BROKEN from origin/main)
```

- Local `main` holds **1 unpushed commit**: `6ada068 docs: design honest daily
  cockpit repair`.
- `origin/main` holds **6 commits local does not**, all `state update [skip ci]`
  from the bot, touching only `dashboard.json` and `state.json`.
- Against `origin/main` the repair branch is 18 ahead / 6 behind.

A merge dry-run gives exactly one conflict, in a generated file:

```
$ git merge-tree --write-tree --name-only origin/main codex/fix-honest-daily-cockpit
CONFLICT (add/add): Merge conflict in dashboard.json
```

**What still holds**: the branch is green (verified — pytest 200, lint 0,
`npm test` 16/0), all three defects are fixed, and no source file conflicts. The
verdict stays **GO**. Only the *merge mechanics* below changed.

## Operator checklist (human actions — the executor must NOT perform these)

Only after this plan reports **GO**, in this exact order:

1. **Add the GitHub Actions secret `COCKPIT_SIWC_BYPASS_TOKEN`** (repo Settings →
   Secrets and variables → Actions). Do this **before** the merge. Without it the
   next pre-open digest job fails at the `test -n` guard, and the skipped
   "Commit state" step loses that day's `history.json` and `symbols.json`.
2. **Sync local `main` first, then merge.** `--ff-only` will refuse — see the
   correction above.

   ```bash
   git checkout main && git pull --rebase origin main
   git merge codex/fix-honest-daily-cockpit
   ```

   Expect one conflict: `dashboard.json`. It is a generated snapshot that the
   very next digest run overwrites, so resolving it is a formality — take the
   branch's version:

   ```bash
   git checkout --theirs dashboard.json && git add dashboard.json && git commit
   ```

   If any conflict appears in a file that is **not** `dashboard.json`, stop —
   that is not what was measured here and needs re-review.

   Then push.
3. **Deploy** the private Sites app so the new routes and the D1-backed
   snapshot path go live. The design doc requires the previous version stay
   available for rollback.
4. **Bootstrap production data**: manually trigger the workflow with mode
   `digest` and confirm the "Update private cockpit" step succeeds.
5. **Verify the data actually arrived** — per the design document, a green
   workflow is not sufficient evidence. Confirm `/api/dashboard` returns a real
   snapshot with a Riyadh timestamp, the UI renders it without a hook-order
   crash, and one current qualified candidate can open research.
6. Only then delete the stale worktrees and branches (see plan 08's maintenance
   notes).

## Maintenance notes

- **Merge order matters.** Because the merge is a fast-forward, any commit
  landing on `main` first destroys that property. Plans 02, 03, 04, 07, and 08
  all touch files the branch modifies (`.github/workflows/tasi.yml`, `main.py`,
  `test_core.py`) and must wait. Plans 05 and 06 touch only `analyze.py`,
  `config.py`, `package.json`, and `package-lock.json` — none of which the
  branch changes — so they can proceed in parallel.
- The branch does **not** fix three things this audit found; they stay open
  after the merge and have their own plans: the `pnlPct` null hazard at
  `main.py:158` (plan 04), the unused `cockpit/` serializer (plan 08), and the
  CI gap (plan 02).
- A reviewer should scrutinize `app/lib/dashboard-core.mjs` (+86 lines of new
  validation and freshness logic) and `app/lib/dashboard-access.ts` most
  closely — they decide what the research routes are allowed to spend money on.
