> **⚠ Reviewer's correction, added after this report was written.**
> Every fast-forward statement below is correct *about local `main` at
> `6ada068`* and wrong about the branch you would actually merge into. Local
> `main` is 1 ahead / 6 behind `origin/main`. Against `origin/main` the repair
> branch is 18 ahead / 6 behind, `--ff-only` refuses, and
> `git merge-tree --write-tree origin/main codex/fix-honest-daily-cockpit`
> reports one conflict: `CONFLICT (add/add): dashboard.json`. No source file
> conflicts. **The GO verdict stands** — the green-suite and defect-fix evidence
> below was all gathered at branch tip `172a4e7` and is unaffected. Use the
> corrected merge sequence in the plan's **CORRECTION** section, not step 2 of
> the checklist copied at the end of this report.

# Verification report: `codex/fix-honest-daily-cockpit`

Plan executed: `docs/superpowers/plans/2026-08-10-01-land-honest-cockpit-repair.md`
Verification date: 2026-08-10

## Drift check

```
git diff --stat 6ada068..HEAD -- main.py app/ tests/ .github/workflows/tasi.yml
```

No output — `main` has not moved on any of those paths since the plan was
written. Proceeded without treating this as a STOP condition.

## Step 1: Fast-forward confirmation

```
git merge-base --is-ancestor main codex/fix-honest-daily-cockpit && echo FF-OK || echo FF-BROKEN
```

Result: `FF-OK`. `main --ff-only` merge remains viable.

## Step 2: Branch tip and diff surface

Branch tip SHA:

```
git rev-parse --short codex/fix-honest-daily-cockpit
172a4e7
```

Diff stat (`git diff --stat main...codex/fix-honest-daily-cockpit`):

```
.github/workflows/tasi.yml                         |   3 +
 app/api/dashboard/route.ts                         |   3 +-
 app/api/research/chat/route.ts                     |   9 +-
 app/api/research/report/route.ts                   |   8 +-
 app/components/ActionCockpit.module.css            |  11 +
 app/components/ActionCockpit.tsx                   | 157 ++++-------
 app/components/ResearchWorkspace.tsx               |   3 +-
 app/lib/dashboard-access.ts                        |  18 ++
 app/lib/dashboard-core.mjs                         |  86 ++++++-
 app/lib/dashboard-types.ts                         |  23 ++
 app/lib/research-agent.ts                          |   2 +-
 app/lib/research-core.mjs                          |  11 +-
 dashboard.json                                     |  13 +
 .../2026-08-09-tasi-honest-daily-cockpit-repair.md | 286 +++++++++++++++++++++
 history.json                                       |  49 ++--
 main.py                                            |  31 ++-
 news_archive.jsonl                                 |  88 +++++++
 test_core.py                                       |  32 ++-
 tests/action-cockpit.test.mjs                      |  25 +-
 tests/dashboard-core.test.mjs                      |  29 ++-
 tests/research-core.test.mjs                       |  20 +-
 21 files changed, 735 insertions(+), 172 deletions(-)
```

Matches the 21 files named in the plan's "Current state" section exactly. All
files fall within `main.py`, `app/`, `tests/`, `test_core.py`,
`.github/workflows/tasi.yml`, `docs/`, and the three generated data files
(`dashboard.json`, `history.json`, `news_archive.jsonl`). No files outside the
expected scope. No flags needed.

## Step 3: Defect-fix confirmations

**Defect 1 — dashboard snapshot never carries scanner results:**

```
git show codex/fix-honest-daily-cockpit:main.py | grep -n "_dashboard_snapshot(regime, recs, budget"
367:    _save(DASHBOARD_FILE, _dashboard_snapshot(regime, recs, budget, scanner_result))
```

Confirmed: the call now passes `scanner_result`, not the literal `None`. Fixed.

**Defect 2 — research routes read a hardcoded demo fixture:**

```
git grep -n "dashboardFixture" codex/fix-honest-daily-cockpit -- app/api app/page.tsx
```

No output. The fixture is out of the production path. Fixed.

**Defect 3 — React hook order changes between renders:**

```
git show codex/fix-honest-daily-cockpit:app/components/ActionCockpit.tsx | grep -n "useState\|useEffect\|return <main\|if (!"
3:import { useEffect, useState } from "react";
18:  return <main className={styles.cockpit}>...  (inside helper fn LoadingCockpit)
22:  return <main className={styles.cockpit}>...  (inside helper fn UnavailableCockpit)
26:  const [state, setState] = useState<DashboardState>(...)
27:  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
29:  useEffect(() => { ... }, []);
42-44: early returns inside ActionCockpit itself (selectedCandidate / state.kind checks)
```

Note on interpretation: lines 18 and 22 are `return` statements inside two
separate standalone helper components (`LoadingCockpit`, `UnavailableCockpit`),
not early returns inside `ActionCockpit` itself. Read in full, `ActionCockpit`
declares all of its hooks (lines 26, 27, 29) unconditionally, before its own
first conditional return (line 42, `if (selectedCandidate) return ...`). No
hook is declared after a conditional return within the component. Fixed.

## Step 4: Full verification suite on branch tip

Checked out `codex/fix-honest-daily-cockpit` detached inside this worktree:

```
git checkout --detach codex/fix-honest-daily-cockpit
git rev-parse --short HEAD
172a4e7
```

| Command | Result on branch (`172a4e7`) | `main` baseline (`6ada068`, per plan) | Verdict |
|---|---|---|---|
| `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` | exit 0, **200 passed** | 199 passed | pass, strictly better (+1 test) |
| `npm run lint` | exit 0, **no errors** | exit 1, 1 error (`react-hooks/rules-of-hooks` in `ActionCockpit.tsx:21`) | pass, fixed |
| `npm test` (build + `node --test tests/*.test.mjs`) | exit 0, **16 passed / 0 failed** | 10 pass / 2 fail | pass, strictly better |

Raw npm test summary on branch tip:
```
ℹ tests 16
ℹ suites 0
ℹ pass 16
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`npm ci` completed successfully (478 packages, no fatal errors; standard
deprecation/audit warnings only, no install-script blocking failures relevant
to build or test).

All three commands are green and strictly better than the `main` baseline
recorded in the plan. No STOP condition triggered.

After verification, returned to the worktree's own branch:
```
git checkout -
Switched to branch 'worktree-agent-a042b49d6b98de008'
```

## Verdict

**GO** — the branch fast-forwards cleanly from `main`, all three documented
defects are confirmably fixed in the code, and all three verification commands
(pytest, lint, npm test) pass with strictly better results than the `main`
baseline. No source changes were made or are needed by this plan.

## Operator checklist (verbatim from the plan)

Only after this plan reports **GO**, in this exact order:

1. **Add the GitHub Actions secret `COCKPIT_SIWC_BYPASS_TOKEN`** (repo Settings →
   Secrets and variables → Actions). Do this **before** the merge. Without it the
   next pre-open digest job fails at the `test -n` guard, and the skipped
   "Commit state" step loses that day's `history.json` and `symbols.json`.
2. **Merge**: `git merge --ff-only codex/fix-honest-daily-cockpit` on `main`,
   then push.
3. **Deploy** the private Sites app so the new routes and the D1-backed
   snapshot path go live. The design doc requires the previous version stay
   available for rollback.
4. **Bootstrap production data**: manually trigger the workflow with mode
   `digest` and confirm the "Update private cockpit" step succeeds.
5. **Verify the data actually arrived** — per the design document, a green
   workflow is not sufficient evidence. Confirm `/api/dashboard` returns a real
   snapshot with a Riyadh timestamp, the UI renders it without a hook-order
   crash, and one current qualified candidate can open research.
6. Only then delete the stale worktrees and branches.
