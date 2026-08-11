# Plan 08: Delete the parallel dashboard serializer nothing calls, and the dead `_regime` helper

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `docs/superpowers/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 6ada068..HEAD -- cockpit/ test_cockpit.py main.py .github/workflows/`
> `main.py` and the workflows **are expected to have changed** (plans 01, 02,
> and 04). `cockpit/` and `test_cockpit.py` should be unchanged. If `cockpit/`
> has changed, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `2026-08-10-01-land-honest-cockpit-repair.md` and
  `2026-08-10-02-ci-verification-baseline.md` — **both hard dependencies**, see
  "Ordering" below
- **Category**: tech-debt
- **Planned at**: commit `6ada068`, 2026-08-10

## Why this matters

There are two dashboard serializers in this repository. One runs. The other has
tests.

`cockpit/` — a three-file package with typed frozen dataclasses and a clean
`build_dashboard_snapshot` function, covered by `test_cockpit.py` — is imported
by **nothing except its own test**. The snapshot that actually reaches the
cockpit is hand-rolled in `main.py`'s `_dashboard_snapshot`.

That arrangement is worse than plain dead code, for two reasons.

**It looks authoritative.** A typed, tested, documented module named
`cockpit.contracts` reads like the source of truth for the snapshot contract. It
is not. Anyone who edits it to change the cockpit's behavior will watch nothing
happen, and anyone who reads it to learn the contract will learn the wrong one.

**It has already silently drifted out of validity.** After plan 01, the wire
contract in `app/lib/dashboard-core.mjs` requires `schemaVersion`, `tradeDate`,
`regime`, `warnings`, and `monthlyBudgetSar`, with `dataStatus` of
`"delayed-daily"`. `cockpit.contracts.DashboardSnapshot.to_dict()` emits none of
the first five and hardcodes `dataStatus = "preview-delayed"`. So if someone
"consolidated onto the tested implementation," the ingest endpoint would reject
every payload with HTTP 400 and take down the digest workflow — the exact
failure mode plan 04 exists to prevent. The tests would stay green throughout,
because they assert against the dead module's own shape.

The same file carries a smaller instance of the same problem: `main.py` defines
a `_regime()` helper that nothing calls. `_collect_recs` calls
`az.market_regime` directly.

## Ordering

**This plan must run after plans 01 and 02.**

- After **01**, because `main.py` is rewritten by that branch and this plan
  edits `main.py`. Landing this first destroys the fast-forward merge.
- After **02**, because plan 02 adds `test_cockpit.py` to CI. This plan deletes
  that file, so it must remove the reference in the same change. If you delete
  the file while a workflow still names it, `pytest` exits non-zero on a missing
  path and **both** the CI job and the scheduled trading job fail.

Pre-flight check:

```bash
git grep -n "test_cockpit.py" -- .github/workflows/
```

**Verify**: returns **two** lines (one in `tasi.yml`, one in `ci.yml`). If it
returns one line, plan 02 has not landed — you may still proceed, but you will
edit only `tasi.yml` in step 3. If it returns zero lines, plan 02 landed
differently than planned — STOP and report.

## Current state

### The dead package

Three files, 142 lines, one importer.

`cockpit/__init__.py`:

```python
"""Stable, UI-facing decision snapshots built from the existing TASI engine."""

from .dashboard import build_dashboard_snapshot

__all__ = ["build_dashboard_snapshot"]
```

`cockpit/contracts.py:44-61` — the drift, in full:

```python
@dataclass(frozen=True)
class DashboardSnapshot:
    as_of: str
    urgent: tuple[ActionCard, ...]
    changed: tuple[dict[str, str], ...]
    qualified: tuple[ScannerCard, ...]
    research_count: int
    data_status: str = "preview-delayed"

    def to_dict(self) -> dict[str, object]:
        return {
            "asOf": self.as_of,
            "dataStatus": self.data_status,
            "urgent": [card.to_dict() for card in self.urgent],
            "changed": list(self.changed),
            "qualified": [card.to_dict() for card in self.qualified],
            "researchCount": self.research_count,
        }
```

No `schemaVersion`, no `tradeDate`, no `regime`, no `warnings`, no
`monthlyBudgetSar`. `dataStatus` is the retired `"preview-delayed"` value.

`cockpit/dashboard.py:31-76` — `build_dashboard_snapshot(recs, candidates, as_of)`.
Read it before deleting so you can confirm for yourself that no behavior is
lost: everything it does, `main.py`'s `_dashboard_snapshot` also does, plus the
five fields above.

### The only importer

`test_cockpit.py:1`:

```python
from cockpit.dashboard import build_dashboard_snapshot
```

Two tests, 37 lines. Confirmed sole importer on `main` **and** on the repair
branch:

```
$ git grep -n "from cockpit\|import cockpit" -- '*.py'
test_cockpit.py:1:from cockpit.dashboard import build_dashboard_snapshot
```

(The other `git grep -n cockpit` hits are the word "cockpit" in prose:
`main.py:155` in a docstring, `test_core.py:1440` in a docstring.)

### What already covers the live path

Plan 01 added `test_dashboard_snapshot_keeps_only_actionable_holdings_and_two_condition_candidates`
to `test_core.py`, which calls `m._dashboard_snapshot(...)` directly and asserts
on `schemaVersion`, `tradeDate`, `dataStatus`, `warnings`, `regime`, `urgent`,
and `qualified`. Plan 04 added three more tests against the same function. So
the two behaviors `test_cockpit.py` checks — actionable-only holdings, and
two-condition-only candidates — are already covered against the implementation
that actually runs. **Confirm this before deleting** (step 2); do not take it on
trust.

### The dead helper

`main.py:70-72`:

```python
def _regime() -> str:
    idx = dat.get_index_history(cfg.REGIME["index_code"])
    return az.market_regime(idx, cfg.REGIME["index_ma"])
```

Nothing calls it. `_collect_recs` computes the regime inline at `main.py:223-226`
using the batched history it already fetched — which is the point: `_regime()`
would issue a second, redundant network call. Deleting it removes a trap, not
just a few lines.

### Repo conventions

- Removals get a reason recorded near where the thing used to be, or in the
  commit body. Exemplars: `config.py:68-71` records two watchlist names removed
  and why; `analyze.py:194-199` records conviction's removal and points at the
  backtest.
- Conventional Commits, lowercase subject, no trailing period.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Python tests (after deletion) | `python -m pytest test_core.py research/test_base_rate.py -q` | exit 0 |
| Coverage check | `python -m pytest test_core.py -q -k dashboard_snapshot` | exit 0, ≥4 passed |
| Import smoke test | `python -c "import main; print('ok')"` | prints `ok` |
| Digest smoke test | see step 4 | prints a valid snapshot |
| Lint | `npm run lint` | exit 0 |
| JS tests | `npm test` | exit 0 |

Note the pytest command **drops `test_cockpit.py`** — that file is gone after
this plan. Update every place that names it.

## Scope

**In scope** (the only files you may modify or delete):

- `cockpit/__init__.py` (delete)
- `cockpit/contracts.py` (delete)
- `cockpit/dashboard.py` (delete)
- `test_cockpit.py` (delete)
- `main.py` — remove `_regime()` only
- `.github/workflows/tasi.yml` — remove `test_cockpit.py` from the pytest args
- `.github/workflows/ci.yml` — same (only if plan 02 has landed)
- `docs/superpowers/plans/README.md` (your status row)

**Out of scope** (do NOT touch, even though they look related):

- `main.py`'s `_dashboard_snapshot` — this is the live serializer and it stays
  exactly as plans 01 and 04 left it. Do **not** "consolidate" it onto the
  deleted module's shape.
- `az.market_regime`, `cfg.REGIME`, and the inline regime computation at
  `main.py:223-226`. Only the unused `_regime()` wrapper goes.
- `main.py`'s other private helpers — `_load_history` (called at `main.py:182`
  and `:200`), `_levels_for`, `_snapshot_for`, `_budget_record`,
  `_budget_remaining`, `_month_key`, `_verify_symbols`. All are live. Verify
  before assuming.
- `app/lib/dashboard-core.mjs` and everything under `app/`.
- `docs/superpowers/specs/2026-08-03-tasi-action-cockpit-design.md` — a
  historical design record; do not rewrite history.

## Git workflow

- Branch: `advisor/08-remove-dead-cockpit-serializer`
- Two commits:
  1. `refactor: delete the unused cockpit snapshot package`
     Body: state that `main._dashboard_snapshot` is the live serializer, that
     `cockpit.contracts` had drifted out of the wire contract (missing
     `schemaVersion`, `tradeDate`, `regime`, `warnings`, `monthlyBudgetSar`;
     stale `dataStatus`), and that `test_core.py` covers the live path.
  2. `refactor: drop the unused _regime helper`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm both things are genuinely dead

```bash
git grep -n "from cockpit\|import cockpit" -- '*.py'
```
**Verify**: exactly one line, `test_cockpit.py:1`. Any other importer means the
package is live — STOP.

```bash
git grep -n "_regime()" -- '*.py'
```
**Verify**: only the definition at `main.py:70`. No call site. (`az.market_regime(...)`
calls are a different symbol and are fine.)

### Step 2: Confirm the live path is already covered — before deleting anything

**Corrected 2026-08-12.** This gate originally demanded "at least 4" passing
tests. That number was wrong: it assumed plan 04's three tests all matched
`-k dashboard_snapshot`, but plan 04's third is
`test_evaluate_holding_still_reports_unknown_pnl_as_none` — deliberately named
for a different function, so it does not match the filter. The correct
expectation is **3**. An executor correctly stopped on the bad threshold; do not
"fix" that by lowering a number without reading the rest of this step.

Counting tests was the wrong gate anyway. What matters is whether the two
behaviors `test_cockpit.py` verifies are covered against the **live**
serializer. Check by name and by behavior:

```bash
python -m pytest test_core.py -q -k dashboard_snapshot -v
```

**Verify**: exactly these 3 pass —

- `test_dashboard_snapshot_keeps_only_actionable_holdings_and_two_condition_candidates`
- `test_dashboard_snapshot_sends_zero_and_a_warning_when_avg_cost_is_missing`
- `test_dashboard_snapshot_adds_no_warning_when_every_holding_has_a_cost`

If any is missing, **STOP** — plans 01 and 04 have not both landed.

Now the substantive comparison. `test_cockpit.py` asserts three things:

| `test_cockpit.py` assertion | Covered on the live path? |
|---|---|
| non-HOLD/WATCH holdings only reach `urgent` | yes — the first test above passes a `HOLD` holding and asserts `urgent` contains only the `SELL (STOP)` |
| only 2-condition candidates reach `qualified` | yes — same test passes a 1-condition candidate and asserts `qualified` contains only the 2-condition one |
| `researchCount` counts the 1-condition candidates | **no** — nothing on the live path asserts this |

So one genuine gap exists. Close it **before** deleting anything, so the
deletion is lossless rather than nearly so.

In `test_core.py`, add one assertion to
`test_dashboard_snapshot_keeps_only_actionable_holdings_and_two_condition_candidates`.
Its fixture already supplies exactly one 1-condition candidate (`4015`), so:

```python
    assert snapshot["researchCount"] == 1
```

Put it immediately after the existing `assert snapshot["qualified"] == [...]`
block.

**Verify**:

```bash
python -m pytest test_core.py -q -k dashboard_snapshot
```
→ still 3 passed. The test count does not change; the assertion count does.

This adds `test_core.py` to your in-scope list for this step only.

### Step 3: Remove `test_cockpit.py` from the workflows first

Do this **before** deleting the file, so the tree is never in a state where a
workflow names a missing path.

In `.github/workflows/tasi.yml`, the `Run tests` step:

```yaml
        run: python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -v
```
→
```yaml
        run: python -m pytest test_core.py research/test_base_rate.py -v
```

In `.github/workflows/ci.yml`, the `python` job's `Tests` step (only if plan 02
has landed), make the same removal.

**Verify**:

```bash
git grep -n "test_cockpit.py" -- .github/workflows/
```
→ no output.

### Step 4: Delete the dead package and its test

```bash
git rm -r cockpit test_cockpit.py
```

**Verify**:

```bash
test ! -d cockpit && test ! -f test_cockpit.py && echo "removed"
python -c "import main; print('ok')"
python -m pytest test_core.py research/test_base_rate.py -q
```
→ prints `removed`, then `ok`, then pytest exits 0.

The pytest count will drop by exactly 2 (the two tests in `test_cockpit.py`).
Record the before and after numbers.

Now smoke-test the live serializer end to end, so you have proof the *real*
snapshot path is untouched:

```bash
python -c "
import json, main as m
snap = m._dashboard_snapshot(
    'ok',
    [{'kind':'holding','code':'2320','name':'Al-Babtain','action':'SELL (STOP)',
      'price':55.85,'reason':['stop breached'],'unrealized_pct':-13.1}],
    {'monthly_cap':500.0},
    {'candidates':[{'code':'1150','conditions_met':2,'rel_strength':10.44,'squeeze_met':True}],
     'names':{'1150':'Alinma Bank'}},
    as_of='2026-08-10T06:45:00Z')
print(json.dumps(snap, indent=2))
"
```

**Verify**: the printed snapshot contains `schemaVersion`, `tradeDate`, `asOf`,
`regime`, `dataStatus`, `warnings`, `urgent`, `changed`, `qualified`,
`researchCount`, and `monthlyBudgetSar`, with one entry each in `urgent` and
`qualified`.

### Step 4b: Wire typecheck into CI (handoff from plan 09)

**Added 2026-08-12.** Plan 09 landed `npm run typecheck` and made `tsc --noEmit`
exit 0, but deliberately did not touch `.github/`. It left an explicit handoff
note asking for the CI step to be added by whichever plan next edits `ci.yml` —
which is this one.

In `.github/workflows/ci.yml`, in the `web` job, insert a step **between**
`Lint` and `Build and test`:

```yaml
      - name: Typecheck
        run: npm run typecheck
```

Two-space indentation, matching the surrounding steps.

**Verify**:

```bash
npm run typecheck; echo "typecheck exit=$?"
python -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml',encoding='utf-8')); names=[s.get('name') for s in d['jobs']['web']['steps']]; print(names)"
```

→ `typecheck exit=0`, and the printed step names show `Typecheck` sitting
between `Lint` and `Build and test`.

If `pyyaml` is unavailable, read the file and confirm the ordering by eye, and
say so in your report.

This step adds `.github/workflows/ci.yml` to your in-scope list. It does not
change anything else about the plan.

### Step 5: Delete the dead `_regime` helper

In `main.py`, delete lines 70-72 (the whole `_regime` function) and the blank
lines that separated it from its neighbours, leaving the surrounding two-blank-line
spacing intact.

Check whether its imports are still needed before touching them:

```bash
grep -n "dat\.\|az\." main.py | head -20
```

**Verify**: `dat.` and `az.` still appear elsewhere (they do — `dat.get_histories`,
`az.evaluate_holding`, and others). Do **not** remove the `import data as dat` or
`import analyze as az` lines.

```bash
git grep -c "def _regime" -- main.py
```
→ `0`.

```bash
python -c "import main; print('ok')"
python -m pytest test_core.py research/test_base_rate.py -q
```
→ `ok`, then exit 0 with the same count as after step 4.

### Step 6: Full verification

```bash
python -m pytest test_core.py research/test_base_rate.py -q
npm run lint
npm test
git status --porcelain
```

**Verify**: all exit 0. `git status --porcelain` lists only the deletions
(`cockpit/__init__.py`, `cockpit/contracts.py`, `cockpit/dashboard.py`,
`test_cockpit.py`), the two workflow files, `main.py`, and
`docs/superpowers/plans/README.md`.

Finally, confirm no stale reference survives anywhere:

```bash
git grep -n "cockpit\.dashboard\|cockpit\.contracts\|build_dashboard_snapshot\|test_cockpit" -- '*.py' '*.yml' '*.md' ':!docs/superpowers/specs' ':!docs/superpowers/plans'
```
→ no output.

(The `:!` exclusions keep historical design docs and this plan set out of the
check — they legitimately mention the removed names.)

## Test plan

**No new tests.** This plan removes code and the tests that covered only that
code. The verification is that the live path's coverage — added by plans 01 and
04 — already exists and stays green, which step 2 proves *before* any deletion
and step 6 confirms after.

Net test count: **−2** (the two in `test_cockpit.py`). Coverage of the shipping
serializer is unchanged, because it was never what `test_cockpit.py` tested.
State both numbers in your report so the drop is visibly intentional.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `test ! -d cockpit` succeeds
- [ ] `test ! -f test_cockpit.py` succeeds
- [ ] `git grep -c "def _regime" -- main.py` returns `0`
- [ ] `git grep -n "test_cockpit.py" -- .github/workflows/` returns no output
- [ ] `git grep -n "cockpit\.dashboard\|cockpit\.contracts\|build_dashboard_snapshot" -- '*.py' '*.yml'` returns no output
- [ ] `python -c "import main; print('ok')"` prints `ok`
- [ ] `python -m pytest test_core.py research/test_base_rate.py -q` exits 0
- [ ] `python -m pytest test_core.py -q -k dashboard_snapshot` exits 0 with 3 passed, and one of them now asserts `researchCount`
- [ ] The step 4 smoke test prints a snapshot containing all eleven fields
- [ ] `npm run lint` exits 0 and `npm test` exits 0
- [ ] `git status --porcelain` lists no file outside the in-scope list
- [ ] `docs/superpowers/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 finds any importer of `cockpit` other than `test_cockpit.py`, or any
  caller of `_regime()`.
- Step 2 does not find all three named `dashboard_snapshot` tests — plans 01 and
  04 have not both landed, and deleting now loses coverage. (The count is 3, not
  4; see the correction in step 2.)
- The pre-flight `git grep -n "test_cockpit.py" -- .github/workflows/` returns
  zero lines.
- Step 4's smoke test prints a snapshot missing any of the eleven fields — that
  means `main.py` is not in its post-plan-01/04 state.
- You conclude the right move is to **keep** `cockpit/` and migrate `main.py`
  onto it. That is a defensible position, but it is a rewrite (the module is
  missing five required fields and has a stale `dataStatus`), it must not be
  done under this plan, and it would need its own plan with the wire contract in
  `app/lib/dashboard-core.mjs` as the spec. Report the position; do not start.
- Removing `_regime()` breaks an import.

## Maintenance notes

- **The rule this encodes**: one serializer for the cockpit snapshot, and it is
  the one `mode_digest` calls. The wire contract lives in
  `app/lib/dashboard-core.mjs` — that file is the spec, and `main.py`'s
  `_dashboard_snapshot` is the only producer that has to satisfy it. If a typed
  Python contract is wanted later, it must be the thing `main.py` imports on day
  one, not a parallel module that tests can drift away from unnoticed.
- **Why the tests did not catch the drift**: `test_cockpit.py` asserted against
  `cockpit`'s own output shape, never against
  `app/lib/dashboard-core.mjs`. Any future Python-side contract test should
  round-trip through the real JavaScript validator — plan 04's step 3 shows the
  technique.
- **What a reviewer should scrutinize**: the `main.py` diff. It should be a pure
  deletion of `_regime` and nothing else — no incidental change to
  `_dashboard_snapshot`, which plans 01 and 04 just settled.
- **Related cleanup left open**: `TECH["rsi_overbought"]` and
  `TECH["rsi_oversold"]` in `config.py` are read by nothing in engine code
  (only by five `test_core.py` fixture dicts). Plan 03 left them deliberately
  out of scope. Same class of problem, smaller stakes.
- **Stale branches also worth retiring**, once plan 01 has landed and been
  verified in production: `codex/tasi-research-agent` (8 ahead / 4 behind) and
  `codex/tasi-research-agent-lean` (8 ahead / 5 behind). `main` already carries
  that work as the squashed commit `a835020 feat: add private TASI research
  workspace`. Deleting branches is an operator action, not part of this plan.
