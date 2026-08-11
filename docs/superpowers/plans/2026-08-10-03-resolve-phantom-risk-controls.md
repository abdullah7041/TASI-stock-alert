# Plan 03: Delete the seven risk controls that do not exist, and correct the README that promises them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `docs/superpowers/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 6ada068..HEAD -- config.py analyze.py main.py README.md test_core.py`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `2026-08-10-01-land-honest-cockpit-repair.md` (that branch
  edits `test_core.py`; landing it first avoids a conflict)
- **Category**: bug
- **Planned at**: commit `6ada068`, 2026-08-10

## Why this matters

`config.py` defines nine `RISK` keys. Two of them do something. Seven are read
by nothing.

The README does not say that. `README.md:50` instructs the user, as step 3 of
first-time setup:

> 3. In `config.py`, set `RISK["deployable_cash"]` to your real cash. It ships at a 3000 placeholder.

and `README.md:232` describes all of them as live behavior:

> Defaults are tuned for a small account: max 5 positions, 25% of deployable cash per buy, 9% stop, 35% cap on any single name, 12% cash buffer, and a commission floor that skips lots too small to be worth the fees. Change any number. The engine reads your values.

"The engine reads your values" is false for seven of the nine. A user who
follows step 3 and enters their real cash balance gets a number that is stored
and never consulted. A user who reads "35% cap on any single name" believes a
concentration limit is protecting them. There is no such limit anywhere in the
codebase.

On a tool whose entire stated value is honesty about what it does and does not
know — a repo that **deleted** its conviction score rather than tune it, and
that refuses to let unvalidated news gate anything — documented-but-nonexistent
risk controls are the worst possible defect. They are strictly more dangerous
than having no risk controls, because the user stops looking.

**The chosen resolution is to delete them and correct the README**, not to
implement them. Reasoning, in the repo's own idiom: `analyze.buy_decision`'s
docstring records that conviction was removed because "two unvalidated inputs
were deciding real money", and `docs/backtest-findings-2026-07-23.md` is cited
throughout as the standard any money rule must meet. Position sizing rules that
have never been measured would not clear that bar either. Deleting restores the
invariant that every number in `config.py` is a number the engine actually
reads. Implementing them later, with a backtest behind them, remains open.

## Current state

### The nine keys

`config.py:113-125`:

```python
# --- Risk rules (small account, balanced) ----------------------------------
# Every number here is yours to change. The engine reads these, no magic constants.
RISK = {
    "deployable_cash":   3000.0,   # SET THIS to your real deployable cash (SAR).
    "max_positions":     5,        # max concurrent open names.
    "position_pct":      0.25,     # target size per new buy, fraction of deployable cash.
    "stop_loss_pct":     0.09,     # stop distance below entry (technical invalidation cap).
    "max_single_pct":    0.35,     # no single name above this fraction of portfolio.
    "cash_buffer_pct":   0.12,     # keep this fraction uninvested (dry powder).
    "commission_rate":   0.00155,  # Tadawul round-trip ~0.155% (buy+sell). Adjust to your broker.
    "min_commission":    0.0,      # some brokers have a floor; set if yours does.
    "commission_floor_pct": 0.01,  # skip a buy if round-trip commission > 1% of trade value.
}
```

### Which two are real

`git grep -n 'cfg\.RISK\|config\.RISK\|RISK\[' -- '*.py'` over tracked files
returns exactly six lines, and only four of them read a value:

- `main.py:204` → `cfg.RISK["stop_loss_pct"]`, passed to `az.derive_levels`
- `main.py:300` → `cfg.RISK["max_positions"]`, passed to `az.allocate_budget`
- `backtest.py:207` → `cfg.RISK["stop_loss_pct"]`
- `backtest.py:347` → `cfg.RISK["stop_loss_pct"]`
- `analyze.py:246` → a mention inside a docstring, not a read
- `main.py:273` → passes the **whole `cfg.RISK` dict** into `evaluate_watchlist`

**KEEP**: `max_positions`, `stop_loss_pct`.
**DELETE**: `deployable_cash`, `position_pct`, `max_single_pct`,
`cash_buffer_pct`, `commission_rate`, `min_commission`, `commission_floor_pct`.

### The dead parameter that carried them

`analyze.py:316-331` — the signature takes `risk`, and the function body never
mentions it again:

```python
def evaluate_watchlist(item: dict, price: float, df: pd.DataFrame, levels: dict,
                       risk: dict, horizon_cfg: dict, tech: dict,
                       news=None, buy_criteria: dict | None = None, disclosures=None) -> dict:
```

Read the whole function (`analyze.py:316-372`) and confirm this for yourself
before deleting the parameter. The docstring already explains that a different
parameter, `regime`, was removed for the same reason — "it only ever fed the
conviction cutoff, which is gone." That is the pattern to follow, and the
comment style to match.

### Every call site of `evaluate_watchlist`

Six, from `git grep -n "az.evaluate_watchlist\|def evaluate_watchlist" -- '*.py'`:

| File | Line | How `risk` is passed |
|---|---|---|
| `analyze.py` | 316 | definition |
| `main.py` | 272-274 | positional: `_levels_for(...), cfg.RISK, cfg.HORIZON, cfg.TECH,` |
| `test_core.py` | 435 | keyword |
| `test_core.py` | 686 | keyword |
| `test_core.py` | 757 | keyword |
| `test_core.py` | 772 | keyword |
| `test_core.py` | 1344 | keyword `risk=BASE_RISK` |

`main.py:272-274` is the only **positional** call — deleting the parameter
shifts `cfg.HORIZON` and `cfg.TECH` into the wrong slots if you only remove
`cfg.RISK` without checking. Read those three lines carefully.

### Repo conventions

- When something is removed, `config.py` and the relevant docstring say **why**,
  with a pointer to the evidence. See `config.py:86-91` and
  `analyze.py:194-199`. Match that voice: plain, specific, no hedging.
- Conventional Commits, lowercase subject, no trailing period.
- `test_core.py` uses plain `def test_*` functions with `assert`, no classes, no
  fixtures beyond module-level dicts like `BASE_RISK`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Python tests + count | `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q 2>&1 \| tail -1` | exit 0, `N passed`; after this plan, baseline + 1 |
| Focused | `python -m pytest test_core.py -q -k "watchlist or budget or risk"` | exit 0, all pass |
| Dead-key check | `git grep -n "deployable_cash\|position_pct\|max_single_pct\|cash_buffer_pct\|commission_rate\|min_commission\|commission_floor_pct" -- '*.py' '*.md'` | no output |
| Import smoke test | `python -c "import config, analyze, main; print('ok')"` | prints `ok` |

## Scope

**In scope** (the only files you may modify):

- `config.py`
- `analyze.py`
- `main.py`
- `test_core.py`
- `README.md`
- `docs/superpowers/plans/README.md` (your status row)

**Out of scope** (do NOT touch, even though they look related):

- `backtest.py` — reads `stop_loss_pct`, which survives. No change needed. Do
  not "tidy" it.
- `RISK["max_positions"]` and `RISK["stop_loss_pct"]` — these are live. Deleting
  them breaks `main.py:204`, `main.py:300`, `backtest.py:207`, and
  `backtest.py:347`.
- `TECH["rsi_overbought"]` and `TECH["rsi_oversold"]` — also unread by engine
  code, but they are not documented in the README as active risk controls and
  they are woven through five `test_core.py` fixture dicts. Out of scope here;
  noted in maintenance notes.
- `BUDGET`, `LEVELS`, `HORIZON`, `SCANNER`, `REGIME` — untouched.
- Any behavior change. After this plan, every digest must produce byte-identical
  output. You are removing dead configuration, not changing decisions.

## Git workflow

- Branch: `advisor/03-phantom-risk-controls`
- Two commits:
  1. `refactor: drop the unread risk parameter from evaluate_watchlist`
  2. `fix: remove risk config keys the engine never reads`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Record the baseline test count

```bash
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q 2>&1 | tail -1
```

**Verify**: exits 0 and prints a passed count. Write it down. This plan adds
exactly one test, so the final count must be **baseline + 1**. It was 199 when
this plan was written, but plan 01 adds tests to `test_core.py` and lands first
— do not assert on 199 or 200.

Do **not** use `pytest --collect-only`. This environment wraps `pytest` in a
proxy that replaces its output with a summary line, and `--collect-only` comes
back as `No tests collected` even when the suite is fine.

### Step 1: Confirm the keys really are dead

```bash
git grep -n "deployable_cash\|position_pct\|max_single_pct\|cash_buffer_pct\|commission_rate\|min_commission\|commission_floor_pct" -- '*.py'
```

**Verify**: every hit is in `config.py` or in `test_core.py` around lines
534-536 (a fixture dict named `BASE_RISK` or similar). If any hit is a real read
in engine code — an actual `RISK["..."]` lookup or a use of the value — STOP and
report which key and where. That key is not dead and must not be deleted.

### Step 2: Remove the unread `risk` parameter from `evaluate_watchlist`

In `analyze.py`, delete `risk: dict,` from the signature at line 316-318, and
add a docstring line in the same voice as the existing `regime` note. The
existing note (`analyze.py:328-330`) reads:

```
    `regime` is no longer a parameter: it only ever fed the conviction cutoff,
    which is gone. The market regime is still computed once per run and shown
    in the digest header.
```

Add, alongside it:

```
    `risk` is no longer a parameter either: the function never read it. Position
    sizing lives in allocate_budget, which takes only what it uses
    (max_positions and the monthly budget).
```

Then fix every call site:

- `main.py:272-274` — this call is **positional**. Remove `cfg.RISK,` and
  confirm `cfg.HORIZON` and `cfg.TECH` still land on `horizon_cfg` and `tech`.
- `test_core.py` lines 435, 686, 757, 772, 1344 — these pass `risk=` as a
  keyword; delete the argument.

**Verify**:

```bash
git grep -n "risk=" -- test_core.py | grep evaluate_watchlist
```
→ no output.

```bash
python -m pytest test_core.py -q
```
→ exit 0, all pass.

### Step 3: Delete the seven dead keys from `config.py`

Replace `config.py:113-125` with:

```python
# --- Risk rules (small account) ---------------------------------------------
# Only what the engine actually reads. Seven further keys (deployable_cash,
# position_pct, max_single_pct, cash_buffer_pct, commission_rate,
# min_commission, commission_floor_pct) were removed on 2026-08-10: they had
# never been read by any code path, while README.md described them as live
# behavior — a configured cap that does not exist is worse than no cap, because
# it stops you looking. Position sizing is equal-weight from BUDGET, in
# analyze.allocate_budget. Re-adding any of them means implementing and
# measuring it first, the same bar conviction failed to clear (see
# docs/backtest-findings-2026-07-23.md).
RISK = {
    "max_positions":     5,        # max concurrent open names (analyze.allocate_budget).
    "stop_loss_pct":     0.09,     # stop distance cap below entry (analyze.derive_levels).
}
```

**Verify**:

```bash
python -c "import config; print(sorted(config.RISK))"
```
→ prints `['max_positions', 'stop_loss_pct']`.

```bash
python -c "import config, analyze, main; print('ok')"
```
→ prints `ok`.

### Step 4: Correct the README

Two edits.

`README.md:50` — the setup step. Replace:

```
3. In `config.py`, set `RISK["deployable_cash"]` to your real cash. It ships at a 3000 placeholder.
```

with:

```
3. In `config.py`, set `BUDGET["monthly_budget_sar"]` to what you are willing to commit to new buys per calendar month. It ships at 500.
```

(`BUDGET["monthly_budget_sar"]` is real — `main.py:301` reads it and
`analyze.allocate_budget` spends against it.)

`README.md:232` — the risk-rules paragraph. Replace it with:

```
Two numbers, and the engine reads both: `max_positions` (5) caps concurrent open names, and `stop_loss_pct` (9%) caps how far below entry a derived stop may sit. That is the whole list. Seven further keys — deployable-cash sizing, per-name concentration caps, a cash buffer, and commission thresholds — used to be listed here and were never implemented; they were removed in 2026-08-10 rather than left as documentation for behavior that did not exist. New-buy sizing is equal-weight from `BUDGET["monthly_budget_sar"]`, described under "Monthly buy budget" above.
```

**Verify**:

```bash
git grep -n "deployable_cash\|position_pct\|max_single_pct\|cash_buffer_pct\|commission_rate\|min_commission\|commission_floor_pct" -- '*.py' '*.md'
```
→ no output.

### Step 5: Add a regression test

In `test_core.py`, at the end of the file, following the plain
`def test_*` + `assert` style used throughout:

```python
def test_risk_config_contains_only_keys_the_engine_reads():
    """Every RISK key must have a real reader. Seven keys were removed in
    2026-08-10 because README described them as live while nothing read them;
    this test is what stops one drifting back in."""
    import config as cfg
    assert set(cfg.RISK) == {"max_positions", "stop_loss_pct"}
```

**Verify**:

```bash
python -m pytest test_core.py -q -k risk_config
```
→ exit 0, 1 passed.

### Step 6: Full suite

```bash
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q
git status --porcelain
```

**Verify**: pytest exits 0 with exactly **one more test than the step 0
baseline**. `git status --porcelain` lists only the six in-scope files.

## Test plan

- **New test**: `test_risk_config_contains_only_keys_the_engine_reads` in
  `test_core.py` — asserts the exact key set, so a re-added phantom key fails
  loudly instead of quietly becoming documentation again.
- **Structural pattern**: match the plain module-level `def test_*` + `assert`
  style used everywhere in `test_core.py`; no classes, no fixtures.
- **Existing coverage that must stay green**: the watchlist and budget tests
  around `test_core.py:435`, `:757`, `:772`, `:1344` all construct
  `evaluate_watchlist` calls and will fail immediately if step 2 misses a call
  site. That is the intended safety net — do not skip running them between
  steps.
- **Verification**: `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q`
  → step 0 baseline + 1.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `python -c "import config; print(sorted(config.RISK))"` prints `['max_positions', 'stop_loss_pct']`
- [ ] `git grep -n "deployable_cash\|position_pct\|max_single_pct\|cash_buffer_pct\|commission_rate\|min_commission\|commission_floor_pct" -- '*.py' '*.md'` returns no output
- [ ] `git grep -n "risk: dict" -- analyze.py` returns no output
- [ ] `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` exits 0 with exactly one more test than the step 0 baseline
- [ ] `python -c "import config, analyze, main, backtest; print('ok')"` prints `ok`
- [ ] `git status --porcelain` lists no file outside the in-scope list
- [ ] `docs/superpowers/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 finds any of the seven keys read by real engine code. Name the key and
  the `file:line`; that key stays.
- Removing the `risk` parameter breaks a test whose failure you do not fully
  understand — in particular, if a test's *assertions* change rather than just
  its call signature. That would mean `risk` was load-bearing after all.
- `python -c "import config, analyze, main, backtest; print('ok')"` fails after
  step 3 — something reads a deleted key at import time.
- You conclude the seven controls should be **implemented** rather than removed.
  That is a legitimate position and a different, larger plan (it needs a
  backtest, per this repo's own standard). Report it; do not start building it
  here.
- Any digest output changes. This plan must be behavior-neutral.

## Maintenance notes

- **What a reviewer should scrutinize**: `main.py:272-274`. It is the only
  positional call to `evaluate_watchlist`, so an off-by-one in argument order
  there would silently pass `cfg.HORIZON` as `tech`. The tests should catch it,
  but look at the diff directly.
- **Still dead, deliberately left alone**: `TECH["rsi_overbought"]` and
  `TECH["rsi_oversold"]` are read by nothing in engine code — they appear only
  in five `test_core.py` fixture dicts (lines 629, 652, 664, 750, 1000). They
  are out of scope because the README never promised them as risk controls, so
  the honesty problem this plan fixes does not apply. Worth a follow-up cleanup.
- **If the controls are implemented later**, the new test from step 5 is the
  thing to update, and it should be updated in the same commit that adds the
  reader — that coupling is the point.
- The equal-weight sizing in `analyze.allocate_budget` is the only sizing logic
  in the repo. Its docstring (`analyze.py:239-262`) explains why it is equal
  weight and not ranked. Read it before proposing any sizing change.
