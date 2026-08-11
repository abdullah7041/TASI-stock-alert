# Plan 04: Stop a holding with no `avg_cost` from failing the whole digest workflow

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `docs/superpowers/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 6ada068..HEAD -- main.py analyze.py app/lib/dashboard-core.mjs test_core.py`
> These files **are expected to have changed** — plan 01 rewrites `main.py`'s
> snapshot builder and `app/lib/dashboard-core.mjs`. The "Current state"
> excerpts below are given for the **post-plan-01** tree. Confirm you are
> looking at that version before proceeding; if `main.py` still matches the
> pre-plan-01 shape, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `2026-08-10-01-land-honest-cockpit-repair.md` — **hard
  dependency**
- **Category**: bug
- **Planned at**: commit `6ada068`, 2026-08-10

## Why this matters

Adding a holding to `config.py` without an `avg_cost` — or with `avg_cost: 0` —
takes down the entire daily digest workflow, including the parts that have
nothing to do with the cockpit.

The chain, each link verified:

1. `analyze.py:167-168` computes `pnl_pct` only when `avg_cost` is truthy, and
   otherwise leaves it as `None`.
2. `main.py`'s `_dashboard_snapshot` writes `"pnlPct": r.get("unrealized_pct", 0.0)`.
   The `0.0` default **never fires**: the key exists, holding the value `None`,
   and `dict.get` returns the stored `None` rather than the default.
3. `app/lib/dashboard-core.mjs` validates `pnlPct` with a strict number check
   and throws on `null`.
4. `app/api/dashboard/ingest/route.ts` turns that throw into HTTP 400.
5. `.github/workflows/tasi.yml` posts with `curl --fail-with-body`, so a 400
   fails the step.
6. The **"Commit state"** step is the next step in the job and is therefore
   skipped. That is the expensive part: `history.json`, `symbols.json`,
   `levels.json`, and `news_archive.jsonl` are never committed back. Day-over-day
   deltas and trend streaks — the digest's "what changed today" feature — break
   for that name until a later run repairs the gap.

So a one-line config typo silently costs the day's history. This is **latent
today**: all three current holdings (`config.py:21-27`) have an `avg_cost`. It
fires the first time someone adds a holding and does not know that field is
load-bearing. Nothing in `config.py`, the README, or any error message says so.

There is a second, quieter problem in the same place, and this repo cares about
it: emitting `0.0` for an unknown P/L would be a **false claim**. A holding with
no cost basis has an *unknown* return, not a flat one. The repo already draws
exactly this distinction elsewhere — `notify._fmt_news` renders "fetch failed"
separately from "no headlines found" precisely so a failure never reads like a
result. The fix must keep that distinction.

## Current state (post plan 01)

### The producer

`main.py`, in `_dashboard_snapshot` — after plan 01 lands, this function reads:

```python
def _dashboard_snapshot(regime: str, recs: list, budget: dict, scanner_result: dict | None, *, as_of: str | None = None) -> dict:
    """Serialize one delayed daily digest for the private cockpit."""
    generated_at = as_of or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    urgent = [
        {"code": r["code"], "name": r["name"], "action": r["action"], "price": r["price"],
         "reason": (r.get("reason") or ["No reason recorded."])[0], "pnlPct": r.get("unrealized_pct", 0.0)}
        for r in recs if r.get("kind") == "holding" and r.get("action") not in ("HOLD", "WATCH")
    ]
    candidates = (scanner_result or {}).get("candidates", [])
    names = (scanner_result or {}).get("names", {})
    qualified = [...]
    warning = (scanner_result or {}).get("warning")
    return {"schemaVersion": 1, "tradeDate": generated_at[:10], "asOf": generated_at,
            "regime": regime, "dataStatus": "delayed-daily", "warnings": [warning] if warning else [],
            "urgent": urgent, "changed": [], "qualified": qualified,
            "researchCount": len([c for c in candidates if c.get("conditions_met") == 1]),
            "monthlyBudgetSar": budget.get("monthly_cap")}
```

Note the `warnings` list. Plan 01 introduced it precisely as the channel for
data-quality problems that must not be silently dropped. This plan uses it.

### Where the `None` comes from

`analyze.py:167-168`, inside `evaluate_holding`:

```python
    pnl_pct = round((price - holding["avg_cost"]) / holding["avg_cost"] * 100, 1) \
        if holding.get("avg_cost") else None
```

`if holding.get("avg_cost")` is a **truthiness** test, so it is `None` for a
missing key, for `avg_cost: 0`, and for `avg_cost: 0.0`.

`analyze.py:174` then puts it in the rec under the key `unrealized_pct`:

```python
        "unrealized_pct": pnl_pct,
```

The key is always present. That is what defeats the `0.0` default in `.get`.

### The validator that rejects it

`app/lib/dashboard-core.mjs`:

```javascript
  const number = (item, field) => { if (typeof item[field] !== "number" || !Number.isFinite(item[field])) throw new Error(`${field} must be a number.`); return item[field]; };
```

and `urgent` items are built with `pnlPct: number(item, "pnlPct")`. `null` is
not a number, so it throws. Plan 01 extends this file; the `number` helper and
the `pnlPct` requirement survive that change — confirm both before editing.

### The current holdings

`config.py:21-27` — all three have `avg_cost`, which is why this has not fired:

```python
HOLDINGS = [
    {"code": "1303", "name": "EIC",          "shares": 104, "avg_cost": 12.41,
     "match_names": ["EIC", "Electrical Industries"]},
    {"code": "2320", "name": "Al-Babtain",   "shares": 12,  "avg_cost": 64.26,
     "match_names": ["Al-Babtain", "Al Babtain"]},
    {"code": "8313", "name": "Rasan",        "shares": 11,  "avg_cost": 107.45},
]
```

### Repo conventions

- The distinction to preserve is stated in `notify._fmt_news`'s docstring:
  "Three distinct renders: a failed fetch, a fetch that found nothing, and a
  fetch with real headlines. Collapsing the first two into one 'neutral 0.0'
  line is exactly what made news look hardcoded." Apply the same reasoning to a
  missing cost basis.
- `test_core.py` uses plain `def test_*` + `assert`. The structural pattern to
  copy for this plan is
  `test_dashboard_snapshot_keeps_only_actionable_holdings_and_two_condition_candidates`
  (added by plan 01), which calls `m._dashboard_snapshot(...)` directly with a
  literal `as_of` and asserts on the returned dict.
- Conventional Commits, lowercase subject, no trailing period.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Python tests | `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` | exit 0, all pass |
| Focused | `python -m pytest test_core.py -q -k "dashboard_snapshot"` | exit 0, all pass |
| JS tests | `npm test` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you may modify):

- `main.py` — `_dashboard_snapshot` only
- `test_core.py` — new tests appended
- `config.py` — one comment line
- `docs/superpowers/plans/README.md` (your status row)

**Out of scope** (do NOT touch, even though they look related):

- `analyze.py` — `evaluate_holding` returning `None` for an unknown P/L is
  **correct** and must stay. `None` is the honest value. The bug is downstream,
  in what the serializer does with it. Do not "fix" it to `0.0` here; that
  would put a false number into the Discord digest too
  (`notify.format_recommendation` at `notify.py:148` and `:154` already handles
  `None` correctly by omitting the P/L line).
- `app/lib/dashboard-core.mjs` — do **not** relax the validator to accept
  `null`. Strict validation is what surfaced this. The producer is what must
  send a valid payload.
- `app/components/ActionCockpit.tsx` and any UI file.
- `.github/workflows/tasi.yml`.
- The `changed`, `qualified`, or `researchCount` parts of the snapshot.

## Git workflow

- Branch: `advisor/04-pnlpct-null-ingest`
- One commit: `fix: keep an unknown cost basis from failing cockpit ingest`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm plan 01 has landed and reproduce the failure

```bash
git grep -n "schemaVersion" -- main.py
```

**Verify**: returns a line. If it returns nothing, plan 01 has not landed —
STOP.

Now reproduce, so you know the fix works on a real failure and not on an
imagined one:

```bash
python -c "
import main as m
snap = m._dashboard_snapshot('ok', [{'kind':'holding','code':'9999','name':'No Cost','action':'SELL (STOP)','price':10.0,'reason':['stop breached'],'unrealized_pct':None}], {'monthly_cap':500.0}, None, as_of='2026-08-10T06:45:00Z')
print('pnlPct =', repr(snap['urgent'][0]['pnlPct']))
"
```

**Verify**: prints `pnlPct = None`. That is the bug: the `0.0` default in
`.get` did not apply.

### Step 2: Fix the serializer, honestly

In `main.py`, replace the `urgent` list comprehension inside
`_dashboard_snapshot` with an explicit loop that coerces the number **and**
records the fact in `warnings`. Target shape:

```python
    urgent = []
    unknown_cost = []
    for r in recs:
        if r.get("kind") != "holding" or r.get("action") in ("HOLD", "WATCH"):
            continue
        # `unrealized_pct` is None whenever config.py gives this holding no
        # usable avg_cost (missing, 0, or 0.0). The snapshot contract requires a
        # finite number, so send 0.0 -- but never let that read as "flat": an
        # unknown cost basis is a data-quality problem, not a 0% return, and it
        # goes in warnings the same way a failed scanner run does.
        pnl = r.get("unrealized_pct")
        if pnl is None:
            unknown_cost.append(str(r.get("code", "?")))
            pnl = 0.0
        urgent.append({
            "code": r["code"], "name": r["name"], "action": r["action"], "price": r["price"],
            "reason": (r.get("reason") or ["No reason recorded."])[0],
            "pnlPct": float(pnl),
        })
```

Then extend the `warnings` value in the returned dict. It currently reads:

```python
            "warnings": [warning] if warning else [],
```

Change it so the scanner warning and the cost-basis warning compose. Build the
list before the `return`:

```python
    warnings = [warning] if warning else []
    if unknown_cost:
        warnings.append(
            f"No avg_cost in config.py for {', '.join(sorted(unknown_cost))} — "
            f"P/L shown as 0.0% is unknown, not flat."
        )
```

and use `"warnings": warnings,` in the returned dict.

**Verify**: re-run the step 1 reproduction command.

```bash
python -c "
import main as m
snap = m._dashboard_snapshot('ok', [{'kind':'holding','code':'9999','name':'No Cost','action':'SELL (STOP)','price':10.0,'reason':['stop breached'],'unrealized_pct':None}], {'monthly_cap':500.0}, None, as_of='2026-08-10T06:45:00Z')
print('pnlPct =', repr(snap['urgent'][0]['pnlPct']))
print('warnings =', snap['warnings'])
"
```
→ prints `pnlPct = 0.0` and a `warnings` list containing one string that
mentions `9999`.

### Step 3: Prove the payload now passes the real validator

The Python side and the JavaScript validator must agree. Check it directly
rather than assuming:

```bash
python -c "
import json, main as m
snap = m._dashboard_snapshot('ok', [{'kind':'holding','code':'9999','name':'No Cost','action':'SELL (STOP)','price':10.0,'reason':['stop breached'],'unrealized_pct':None}], {'monthly_cap':500.0}, None, as_of='2026-08-10T06:45:00Z')
open('.tmp-snapshot.json','w',encoding='utf-8').write(json.dumps(snap))
print('written')
"
node -e "
const fs = require('node:fs');
import('./app/lib/dashboard-core.mjs').then(m => {
  const parsed = m.parseDashboardSnapshot(JSON.parse(fs.readFileSync('.tmp-snapshot.json','utf8')));
  console.log('validator accepted, pnlPct =', parsed.urgent[0].pnlPct);
});
"
rm -f .tmp-snapshot.json
```

**Verify**: prints `validator accepted, pnlPct = 0`. If it throws, read the
error — the message names the offending field.

Make sure `.tmp-snapshot.json` is deleted afterwards; `git status --porcelain`
must not list it.

### Step 4: Document the requirement where someone will see it

In `config.py`, in the comment block above `HOLDINGS` (currently lines 10-20),
add one line to the field list, matching the existing style:

```
# avg_cost: your average cost per share (SAR). Required: without it the digest
#           cannot compute P/L and the cockpit snapshot flags it as unknown.
```

Replace the existing `# avg_cost: your average cost per share (SAR)` line
rather than adding a second one.

**Verify**: `git diff --stat config.py` → `1 file changed, 2 insertions(+), 1 deletion(-)`
(or similar single-hunk change).

### Step 5: Add regression tests

Append to `test_core.py`, modeled structurally on
`test_dashboard_snapshot_keeps_only_actionable_holdings_and_two_condition_candidates`:

```python
def test_dashboard_snapshot_sends_zero_and_a_warning_when_avg_cost_is_missing():
    """A holding with no usable avg_cost must not send null pnlPct: the snapshot
    validator rejects it, which 400s the ingest, which skips the workflow's
    commit step and loses that day's history. 0.0 keeps the payload valid; the
    warning keeps it honest."""
    import main as m

    snapshot = m._dashboard_snapshot(
        "ok",
        [{"kind": "holding", "code": "9999", "name": "No Cost", "action": "SELL (STOP)",
          "price": 10.0, "reason": ["stop breached"], "unrealized_pct": None}],
        {"monthly_cap": 500.0},
        None,
        as_of="2026-08-10T06:45:00Z",
    )

    assert snapshot["urgent"][0]["pnlPct"] == 0.0
    assert isinstance(snapshot["urgent"][0]["pnlPct"], float)
    assert any("9999" in w for w in snapshot["warnings"])


def test_dashboard_snapshot_adds_no_warning_when_every_holding_has_a_cost():
    import main as m

    snapshot = m._dashboard_snapshot(
        "ok",
        [{"kind": "holding", "code": "2320", "name": "Al-Babtain", "action": "SELL (STOP)",
          "price": 55.85, "reason": ["stop breached"], "unrealized_pct": -13.1}],
        {"monthly_cap": 500.0},
        None,
        as_of="2026-08-10T06:45:00Z",
    )

    assert snapshot["urgent"][0]["pnlPct"] == -13.1
    assert snapshot["warnings"] == []


def test_evaluate_holding_still_reports_unknown_pnl_as_none():
    """The engine must keep saying None. Only the cockpit serializer coerces —
    the Discord digest omits the P/L line entirely, which stays correct."""
    import pandas as pd
    df = pd.DataFrame({"Open": [10.0] * 60, "High": [11.0] * 60,
                       "Low": [9.0] * 60, "Close": [10.0] * 60})
    rec = az.evaluate_holding({"code": "9999", "name": "No Cost", "shares": 1},
                              price=10.0, df=df, levels={},
                              horizon_cfg=cfg.HORIZON, tech=cfg.TECH)
    assert rec["unrealized_pct"] is None
```

If the module aliases `az` / `cfg` are not already imported at the top of
`test_core.py`, use whatever names that file already uses — check its import
block rather than guessing.

**Verify**:

```bash
python -m pytest test_core.py -q -k "avg_cost or unknown_pnl or every_holding"
```
→ exit 0, 3 passed.

### Step 6: Full suite

```bash
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q
npm run lint
npm test
git status --porcelain
```

**Verify**: all exit 0. `git status --porcelain` lists only `main.py`,
`config.py`, `test_core.py`, and `docs/superpowers/plans/README.md`.

## Test plan

- **New tests** (3, all in `test_core.py`):
  1. `test_dashboard_snapshot_sends_zero_and_a_warning_when_avg_cost_is_missing`
     — the regression this plan exists for.
  2. `test_dashboard_snapshot_adds_no_warning_when_every_holding_has_a_cost` —
     the negative case, so the warning does not fire on every run and become
     noise.
  3. `test_evaluate_holding_still_reports_unknown_pnl_as_none` — a guard on the
     out-of-scope boundary: it fails if someone later "fixes" `analyze.py` to
     return `0.0`, which would put a false number in the Discord digest.
- **Structural pattern**: `test_dashboard_snapshot_keeps_only_actionable_holdings_and_two_condition_candidates`
  in `test_core.py`.
- **Cross-language check**: step 3 is the real integration proof — it runs the
  actual JavaScript validator over the actual Python output. Do not skip it in
  favour of the Python assertions alone; the two implementations are the thing
  that disagreed.
- **Verification**: `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q`
  → 3 more tests than the pre-plan baseline.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] The step 1 reproduction command now prints `pnlPct = 0.0`, not `None`
- [ ] The step 3 node command prints `validator accepted, pnlPct = 0`
- [ ] `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run lint` exits 0
- [ ] `git grep -n 'r.get("unrealized_pct", 0.0)' -- main.py` returns no output
- [ ] `git status --porcelain` lists no file outside the in-scope list, and no
      `.tmp-snapshot.json`
- [ ] `docs/superpowers/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's `git grep -n "schemaVersion" -- main.py` returns nothing — plan 01
  has not landed and the `warnings` field this plan writes into does not exist.
- Step 1's reproduction does **not** print `None` — the code has drifted from
  what this plan describes.
- Step 3's validator rejects the payload for a field other than `pnlPct`. That
  is a different producer/validator disagreement and deserves its own report.
- You find yourself editing `app/lib/dashboard-core.mjs` to accept `null`, or
  editing `analyze.py` to return `0.0`. Both are out of scope and both make the
  system less honest.
- A test outside the three you added starts failing.

## Maintenance notes

- **The invariant to hold on to**: `analyze.py` reports unknowns as `None`;
  only the cockpit serializer coerces, and only because the wire contract
  demands a finite number. Every coercion must leave a trace in `warnings`. If a
  future field needs the same treatment, follow this shape rather than adding a
  silent default.
- **What a reviewer should scrutinize**: that `warnings` composes rather than
  overwrites. The scanner warning from plan 01 and the cost-basis warning must
  both be able to appear in the same snapshot; a reviewer should look for a
  `warnings.append` and not a reassignment.
- **Follow-up deliberately deferred**: the truly honest fix is a nullable
  `pnlPct` in the snapshot contract with the UI rendering "P/L unknown". That
  touches `app/lib/dashboard-core.mjs`, `app/lib/dashboard-types.ts`, and
  `app/components/ActionCockpit.tsx`, and it changes a wire contract that plan
  01 just stabilised. Worth doing once the cockpit has been running on real
  data for a while.
- The same `.get(key, default)`-does-not-catch-`None` trap exists anywhere a rec
  field is optional. `reason` is already guarded correctly with
  `(r.get("reason") or [...])`. Prefer `or` over a `get` default for any field
  the engine may legitimately set to `None`.
