# TASI Digest Stage B — Delete Conviction, Add the Rule Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the 0-100 conviction score (measured *inverted* against forward
return — see `docs/backtest-findings-2026-07-23.md`) and the BUY gate and budget
weighting built on it, replacing both with an explicit, falsifiable 3-rule
checklist and equal-weight budget allocation.

**Architecture:** `analyze.buy_decision` becomes the single source of truth for
which rules exist and whether each passed — it returns a list of typed rule
dicts instead of prose strings. `evaluate_watchlist`, `allocate_budget`, and
`notify.format_recommendation` consume that list instead of a conviction score.
`backtest.run`/`backtest.sweep` are updated in lockstep because they call the
same `analyze` functions directly.

**Tech Stack:** Python 3, pandas, numpy, pytest (repo's existing offline test
convention).

## Global Constraints

- Conviction is **deleted**, not patched. `docs/backtest-findings-2026-07-23.md`
  remains the sole written record of the inverted-buckets finding — after this
  plan no code path reproduces it, and that is intentional.
- Exactly **3 surviving rules**: `rsi_band`, `trend`, `momentum_floor`. The
  original design brainstorm contains an internal tension — a parenthetical
  lists a 4th "news not negative" item, but that same document's worked example
  reads `Rules met: 2/3` and it separately states the `news_score < 0` veto "is
  removed". The worked example's denominator of 3 is the correct final reading.
  **Do not add a 4th rule for news.**
- News stays **context-only** (established in Stage A) — it must not gate
  anything anywhere, including in `backtest.py`.
- **No task may leave the test suite red, and no task may leave the live digest
  printing a broken value.** Where changing a function breaks a caller
  elsewhere, the caller's fix belongs in the SAME task. Three places in this
  plan need that bundling: `buy_decision`+`backtest.run` (Task 1),
  `evaluate_watchlist`+`main.py`+`notify.py` (Task 3), and
  `config.BUY_CRITERIA`+`backtest.sweep`+`main.py` sweep columns (Task 5).
- `analyze.evaluate_watchlist`'s `risk` parameter is **already unused** in the
  current code — a pre-existing dead parameter unrelated to this plan. Leave it.
  Removing it is out of scope.
- Stage C (`triggers.py`), Stage D (history/deltas), Stage E (disclosures, the
  `TECH["rsi_period"]` bug, CI test step), and Stage F (scanner) are separate
  future plans. Nothing here should anticipate them.
- Every task runs its tests from the repo root:
  `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system"`.

---

## File Structure

| File | Responsibility after this plan | Change |
|---|---|---|
| `analyze.py` | Owns the rule definitions and the BUY/sizing decisions | Delete `conviction_score` + `position_size`; `buy_decision` → 2 params, typed rule list; `evaluate_watchlist` drops `regime`, emits `rules`; `allocate_budget` → equal weight |
| `backtest.py` | Replays the SAME `analyze` functions over history | `run()`: new `buy_decision` call, drop dead `tech` param, drop `conviction` event column; `sweep()`: 2D grid |
| `main.py` | Wiring + output modes | Drop `regime` from the `evaluate_watchlist` call; drop `conviction_min` sweep column; delete a stale news caveat print |
| `config.py` | Tunable thresholds | `BUY_CRITERIA` loses both conviction keys |
| `notify.py` | Renders a rec to Discord text | `conviction: X/100` → `Rules met: X/Y`; equal-weight sizing wording |
| `test_core.py` | Offline unit tests | Delete conviction/position_size tests; rewrite `buy_decision`/`evaluate_watchlist`/`allocate_budget` tests; update fixtures |
| `README.md` | User-facing description | 6 stale conviction references corrected |

---

## Task 1: `buy_decision` → 3-rule checklist (+ `backtest.run` call site)

`buy_decision` currently takes `(conviction, news_score, long_read, regime, criteria)`
and returns `(bool, list[str])`. It becomes `(long_read, criteria) -> (bool, list[dict])`.

`backtest.py`'s `run()` calls `az.conviction_score` and the OLD 5-arg
`az.buy_decision` directly. Two existing tests (`test_run_holds_one_position_per_name`,
`test_run_survives_features_csv_round_trip`) call `bt.run()`, so if the call site
is not fixed in this same task, this task ends red. Both changes, one commit.

**Files:**
- Modify: `analyze.py:227-265` (`buy_decision`)
- Modify: `backtest.py:323-391` (`run()` — signature and replay loop)
- Test: `test_core.py:108-153` (the BUY-decision test block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `buy_decision(long_read: dict, criteria: dict) -> tuple[bool, list[dict]]`.
  Each rule dict has keys `rule` (one of `"rsi_band"`, `"trend"`, `"momentum_floor"`),
  `passed` (bool), `actual`, `required`, `plain` (str). `is_buy = all rules passed`.
  Rules are returned in that fixed order. Tasks 3 and 6 depend on exactly these keys.
  Also produces: `backtest.run(features, hist, criteria=None, max_hold=MAX_HOLD_BARS, levels_cfg=None)`
  — the `tech` parameter is **removed** (see Step 5).

- [ ] **Step 1: Write the failing tests**

In `test_core.py`, replace the whole block from line 108 (`# --- BUY decision ---`)
through the end of `test_positive_momentum_without_up_trend_vetoes_buy` (line 153)
with:

```python
# --- BUY decision -----------------------------------------------------------
CRITERIA = {"rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
GOOD_LONG = {"trend": "up", "momentum_pct": 10.0, "rsi": 45.0}

def _rule(rules, name):
    return next(r for r in rules if r["rule"] == name)

def test_buy_fires_when_all_rules_met():
    ok, rules = az.buy_decision(GOOD_LONG, CRITERIA)
    assert ok
    assert len(rules) == 3
    assert all(r["passed"] for r in rules)
    assert [r["rule"] for r in rules] == ["rsi_band", "trend", "momentum_floor"]

def test_rsi_outside_recovery_band_vetoes_buy():
    hot = {**GOOD_LONG, "rsi": 75.0}
    ok, rules = az.buy_decision(hot, CRITERIA)
    assert not ok
    assert _rule(rules, "rsi_band")["passed"] is False
    capitulating = {**GOOD_LONG, "rsi": 15.0}
    assert not az.buy_decision(capitulating, CRITERIA)[0]

def test_rsi_unavailable_vetoes_buy():
    unavailable = {**GOOD_LONG, "rsi": float("nan")}
    ok, rules = az.buy_decision(unavailable, CRITERIA)
    assert not ok
    assert _rule(rules, "rsi_band")["passed"] is False
    assert "unavailable" in _rule(rules, "rsi_band")["plain"]

def test_deteriorating_long_term_vetoes_buy():
    bad = {"trend": "down", "momentum_pct": -20.0, "rsi": 45.0}
    ok, rules = az.buy_decision(bad, CRITERIA)
    assert not ok
    assert _rule(rules, "trend")["passed"] is False
    assert _rule(rules, "momentum_floor")["passed"] is False

def test_up_trend_with_momentum_below_floor_vetoes_buy():
    # The Avalon case: the MA cross says 'up' but momentum is below the floor.
    # Trend and momentum are now SEPARATE rules, so this reports 2/3 with one
    # named blocker instead of a single combined "long-term not confirmed".
    avalon = {"trend": "up", "momentum_pct": -6.31, "rsi": 47.4}
    ok, rules = az.buy_decision(avalon, CRITERIA)
    assert not ok
    assert _rule(rules, "trend")["passed"] is True
    assert _rule(rules, "momentum_floor")["passed"] is False
    assert sum(1 for r in rules if r["passed"]) == 2

def test_up_trend_and_positive_momentum_passes():
    strong = {"trend": "up", "momentum_pct": 8.0, "rsi": 45.0}
    assert az.buy_decision(strong, CRITERIA)[0]

def test_positive_momentum_without_up_trend_vetoes_buy():
    flat = {"trend": "flat", "momentum_pct": 3.0, "rsi": 45.0}
    ok, rules = az.buy_decision(flat, CRITERIA)
    assert not ok
    assert _rule(rules, "trend")["passed"] is False
```

Two tests from the old block are deleted outright and must NOT reappear:
`test_breakdown_raises_bar_instead_of_blocking` (the regime-raises-the-bar
mechanic depended entirely on conviction) and `test_negative_news_vetoes_buy`
(that veto is removed by this task).

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest test_core.py -k "buy_fires or rsi_outside or rsi_unavailable or deteriorating or below_floor or without_up_trend or positive_momentum" -v`
Expected: FAIL — `buy_decision()` still requires 5 positional args, so the new
2-arg calls raise `TypeError: buy_decision() missing 3 required positional arguments`.

- [ ] **Step 3: Rewrite `buy_decision`**

Replace `analyze.py:227-265` in full:

```python
# --- BUY decision ----------------------------------------------------------
def buy_decision(long_read: dict, criteria: dict) -> tuple[bool, list]:
    """The single place BUY is decided. Returns (is_buy, rules).

    `rules` reports EVERY rule, passed or not — not just the failures — so the
    digest can say "Rules met: 2/3" and name what is blocking. Exactly three,
    always in this order:
      1. rsi_band       — long RSI inside criteria['rsi_recovery_band'].
      2. trend          — long trend == 'up'.
      3. momentum_floor — long momentum >= criteria['long_mom_floor_pct'].
    BUY fires only when all three pass.

    Conviction and the news veto are both gone. Conviction backtested INVERTED
    against forward return (docs/backtest-findings-2026-07-23.md is now the only
    record of that), and it gated BUY *and* weighted the budget. News sentiment
    has never been validated against outcomes at all — backtest.py hardcodes
    news_score=0.0 because no historical headlines existed to check it with.
    Two unvalidated inputs were deciding real money; the rules are stated
    plainly now instead of being folded into a score.
    """
    rules = []

    lo, hi = criteria["rsi_recovery_band"]
    rsi_val = long_read.get("rsi")
    rsi_missing = rsi_val is None or np.isnan(rsi_val)
    rsi_ok = (not rsi_missing) and lo <= rsi_val <= hi
    if rsi_missing:
        rsi_plain = "RSI unavailable"
    elif rsi_ok:
        rsi_plain = f"RSI {rsi_val} inside {lo}-{hi}"
    else:
        rsi_plain = f"RSI {rsi_val} outside recovery band {lo}-{hi}"
    rules.append({"rule": "rsi_band", "passed": rsi_ok, "actual": rsi_val,
                  "required": f"{lo}-{hi}", "plain": rsi_plain})

    trend_val = long_read.get("trend")
    trend_ok = trend_val == "up"
    rules.append({
        "rule": "trend", "passed": trend_ok, "actual": trend_val, "required": "up",
        "plain": f"trend {trend_val}" if trend_ok
                 else f"trend {trend_val}, need up",
    })

    mom = long_read.get("momentum_pct")
    floor = criteria["long_mom_floor_pct"]
    mom_ok = mom is not None and not np.isnan(mom) and mom >= floor
    rules.append({
        "rule": "momentum_floor", "passed": mom_ok, "actual": mom, "required": floor,
        "plain": f"momentum {mom}% >= floor {floor}%" if mom_ok
                 else f"momentum {mom}% below floor {floor}%",
    })

    return all(rule["passed"] for rule in rules), rules
```

- [ ] **Step 4: Run the buy_decision tests to verify they pass**

Run: `python -m pytest test_core.py -k "buy_fires or rsi_outside or rsi_unavailable or deteriorating or below_floor or without_up_trend or positive_momentum" -v`
Expected: 7 tests PASS.

- [ ] **Step 5: Fix `backtest.run()` — new call, and drop the now-dead `tech` param**

After removing the `conviction_score` call, `run()`'s `tech` parameter has no
remaining use (`grep -n "tech" backtest.py` shows it only at the signature, the
`tech = tech or cfg.TECH` default, and the `conviction_score` call). No caller
anywhere passes it: `sweep()` calls `run(features, hist, crit)`, `sweep_levels()`
calls `run(features, hist, levels_cfg=lc)`, `main.py` calls `bt.run(feat, hist)`,
and both tests call `bt.run(feats, {...})`. Remove it rather than leaving dead
surface behind.

Replace `backtest.py:323-391` — the signature line, the defaults, and the replay
loop:

```python
def run(features: pd.DataFrame, hist: dict, criteria: dict | None = None,
        max_hold: int = MAX_HOLD_BARS,
        levels_cfg: dict | None = None) -> pd.DataFrame:
    """Replay BUY decisions and resolve each into a trade.

    One open position per name. A qualifying setup stays true for weeks, so a
    naive replay would emit a fresh 'trade' every step with overlapping forward
    windows — autocorrelated pseudo-trades that inflate both the event count and
    the win rate. Once a trade opens on a name, every bar is skipped until it
    closes.
    """
    criteria = criteria or cfg.BUY_CRITERIA
    if features.empty:
        return pd.DataFrame()

    events = []
    missing = 0
    for code, grp in features.groupby("code", sort=False):
        df = hist.get(code)
        if df is None:
            df = hist.get(str(code))    # survive an int64 code column.
        if df is None or df.empty:
            missing += 1
            continue
        open_until = -1
        for _, row in grp.sort_values("t").iterrows():
            t = int(row["t"])
            if t <= open_until:
                continue                      # position still open on this name.
            is_buy, _ = az.buy_decision(_row_to_long_read(row), criteria)
            if not is_buy:
                continue

            stop = row["stop"] if pd.notna(row["stop"]) else None
            target = row["target"] if pd.notna(row["target"]) else None
            if levels_cfg is not None and "atr" in row and pd.notna(row.get("atr")):
                # Re-place the levels from the cached ATR via the same function
                # production uses, so multipliers can be swept without a rebuild.
                lv = az.levels_from_atr(float(row["price"]), float(row["atr"]),
                                        cfg.RISK["stop_loss_pct"], levels_cfg)
                stop, target = lv.get("stop", stop), lv.get("target", target)

            res = resolve_outcome(df, t, stop, target, max_hold)
            if not res:
                continue
            open_until = t + res["bars_held"]
            events.append({"code": str(code), "date": row["date"], "t": t,
                           "regime": row["regime"],
                           "rsi": row["rsi"], "trend": row["trend"], **res})

    if missing and not events:
        print(f"WARNING: no history matched any of the {missing} codes in the "
              f"feature table. That is a plumbing failure, not a finding — "
              f"zero events here does NOT mean the BUY rules never fire.")
    return pd.DataFrame(events)
```

Gone from the loop: the `dist = row["distance_to_zone_pct"]` line and the whole
`conviction = az.conviction_score(...)` call (`dist` fed conviction and nothing
else), plus `"conviction": conviction` from the event dict. `regime` stays in the
event dict as recorded context even though it no longer affects the decision —
`report()` does not read either column, and neither test asserts on them.

- [ ] **Step 6: Run the backtest tests that exercise `run()`**

Run: `python -m pytest test_core.py -k "test_run_holds_one_position_per_name or test_run_survives_features_csv_round_trip" -v`
Expected: both PASS unchanged. Their synthetic rows (`trend="up"`, `rsi=55.0`,
`momentum_pct=10.0`) satisfy all three new rules under `cfg.BUY_CRITERIA`'s
surviving keys (`rsi_recovery_band=(25,60)`, `long_mom_floor_pct=-5.0`) exactly
as they satisfied the old gate, and neither test reads a `conviction` column.

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass. `config.py` still carries `conviction_min` /
`conviction_min_breakdown` at this point (Task 5 removes them) — harmless, since
neither the new `buy_decision` nor the new `run()` reads them.

- [ ] **Step 8: Commit**

```bash
git add analyze.py backtest.py test_core.py
git commit -m "Restructure buy_decision into a 3-rule checklist; update backtest replay"
```

---

## Task 2: `allocate_budget` — equal weight instead of conviction weight

**Files:**
- Modify: `analyze.py:269-318` (`allocate_budget`)
- Test: `test_core.py:191-230` (budget allocation block, including the `_buy` helper)

**Interfaces:**
- Consumes: nothing new.
- Produces: `allocate_budget(buys: list, budget_sar: float) -> dict` — unchanged
  signature and unchanged return shape (`{budget, allocated, leftover}`, mutating
  each `buy["sizing"]`). After this task the input dicts no longer need a
  `"conviction"` key; `allocate_budget` never reads one.

- [ ] **Step 1: Write the failing tests**

Replace `test_core.py:191-230` (from `def _buy(code, conviction, price):` through
the end of `test_allocate_zero_budget_skips_all`) with:

```python
# --- budget allocation ------------------------------------------------------
def _buy(code, price):
    return {"kind": "watchlist", "code": code, "name": code, "price": price,
            "action": "BUY"}

def test_allocate_whole_shares_within_budget():
    buys = [_buy("A", 33.4), _buy("B", 13.7)]
    summary = az.allocate_budget(buys, 500.0)
    total = sum(b["sizing"]["spend"] for b in buys if not b["sizing"].get("skip"))
    for b in buys:
        if not b["sizing"].get("skip"):
            assert b["sizing"]["shares"] == int(b["sizing"]["shares"])
            assert abs(b["sizing"]["shares"] * b["price"] - b["sizing"]["spend"]) < 0.01
    assert total <= 500.0 + 1e-9
    assert abs(summary["allocated"] - total) < 0.01
    assert abs(summary["leftover"] - (500.0 - total)) < 0.01

def test_allocate_equal_weight_same_price_gets_same_spend():
    # The point of the change: identical prices now get identical spend, where
    # the conviction-weighted version deliberately gave one of them more.
    buys = [_buy("A", 10.0), _buy("B", 10.0)]
    az.allocate_budget(buys, 500.0)
    a = next(b for b in buys if b["code"] == "A")["sizing"]["spend"]
    b_ = next(b for b in buys if b["code"] == "B")["sizing"]["spend"]
    assert a == b_
    assert a == 250.0

def test_allocate_weight_pct_is_equal_across_names():
    buys = [_buy("A", 10.0), _buy("B", 10.0), _buy("C", 10.0)]
    az.allocate_budget(buys, 300.0)
    for b in buys:
        assert b["sizing"]["weight_pct"] == 33.3

def test_allocate_min_one_share_when_equal_slice_too_small_but_budget_allows():
    # Equal slices are 250 SAR each. B at 300 does not fit its own slice, but
    # does fit what is left of the whole budget, so the 1-share fallback gives
    # it one. (The old version of this test drove the same fallback with a
    # conviction disparity; price disparity is the equal-weight equivalent.)
    buys = [_buy("B", 300.0), _buy("A", 10.0)]
    az.allocate_budget(buys, 500.0)
    assert next(b for b in buys if b["code"] == "B")["sizing"]["shares"] == 1
    assert next(b for b in buys if b["code"] == "A")["sizing"]["shares"] == 20

def test_allocate_skips_share_pricier_than_budget():
    buys = [_buy("A", 600.0)]
    summary = az.allocate_budget(buys, 500.0)
    assert buys[0]["sizing"]["shares"] == 0 and "skip" in buys[0]["sizing"]
    assert summary["allocated"] == 0.0 and summary["leftover"] == 500.0

def test_allocate_zero_budget_skips_all():
    buys = [_buy("A", 10.0)]
    az.allocate_budget(buys, 0.0)
    assert buys[0]["sizing"]["skip"] == "monthly budget exhausted"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest test_core.py -k allocate -v`
Expected: FAIL with `KeyError: 'conviction'` — `allocate_budget` still sorts by
`r["conviction"]`, which the new `_buy()` fixtures no longer provide.

- [ ] **Step 3: Rewrite `allocate_budget`**

Replace `analyze.py:269-318` in full:

```python
# --- Budget allocation ------------------------------------------------------
def allocate_budget(buys: list, budget_sar: float) -> dict:
    """Split the remaining monthly budget EQUALLY across BUY recs. Mutates each
    rec's 'sizing' in place; returns a summary.

    Rules (transparent, in order):
      - Equal weight: every qualifying name targets the same slice, processed
        in the order given. This used to be weighted by conviction — which
        backtested inverted against forward return, so weighting toward it was
        weighting toward worse outcomes (docs/backtest-findings-2026-07-23.md).
        With conviction gone there is nothing left to rank on, and pretending
        otherwise would be inventing a ranking.
      - Each gets slice = budget / len(buys), rounded DOWN to whole shares
        (Tadawul does not allow fractions).
      - If the slice affords 0 shares but 1 share fits what is left of the
        budget, it gets 1 share.
      - Unspent remainder of a slice rolls to the next candidate via the
        running 'remaining' amount; whatever is left at the end stays cash.
      - Hard invariant: total spend <= budget_sar.
    """
    summary = {"budget": round(budget_sar, 2), "allocated": 0.0,
               "leftover": round(budget_sar, 2)}
    if not buys or budget_sar <= 0:
        for r in buys:
            r["sizing"] = {"shares": 0, "spend": 0.0, "skip": "monthly budget exhausted"}
        return summary

    n = len(buys)
    equal_slice = budget_sar / n
    remaining = budget_sar

    for r in buys:
        price = r["price"]
        slice_sar = min(equal_slice, remaining)
        shares = int(slice_sar // price) if price > 0 else 0
        if shares == 0 and 0 < price <= remaining:
            shares = 1  # min viable lot for a qualified name, if budget allows.
        spend = shares * price
        if spend > remaining:                    # never breach the cap.
            shares = int(remaining // price) if price > 0 else 0
            spend = shares * price
        if shares == 0:
            r["sizing"] = {"shares": 0, "spend": 0.0,
                           "skip": f"1 share ({price:.2f}) exceeds remaining budget ({remaining:.2f})"}
            continue
        remaining -= spend
        r["sizing"] = {
            "shares": shares,
            "spend": round(spend, 2),
            "weight_pct": round(100.0 / n, 1),
            "budget_left_after": round(remaining, 2),
        }

    summary["allocated"] = round(budget_sar - remaining, 2)
    summary["leftover"] = round(remaining, 2)
    return summary
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest test_core.py -k allocate -v`
Expected: 6 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass. `evaluate_watchlist` still emits a `"conviction"` key at this
point (Task 3 removes it); `allocate_budget` simply ignores it now.

- [ ] **Step 6: Commit**

```bash
git add analyze.py test_core.py
git commit -m "Switch budget allocation from conviction-weighted to equal-weight"
```

---

## Task 3: `evaluate_watchlist` + `main.py` call site + `notify.py` rendering

This task changes the shape of a watchlist rec (drops `conviction`, adds
`rules`/`rules_met`/`rules_total`) and updates BOTH of its consumers in the same
commit. `main.py` must drop the now-removed `regime` argument or it raises a
`TypeError`; `notify.py` must stop reading `rec["conviction"]` or the live digest
prints the literal string `conviction: None/100` for every watchlist name. A
producer and its consumers are one atomic unit.

**Files:**
- Modify: `analyze.py:322-369` (`evaluate_watchlist`)
- Modify: `main.py:235-237` (the watchlist loop's `az.evaluate_watchlist(...)` call)
- Modify: `notify.py:46-55` (`format_recommendation`'s watchlist block)
- Test: `test_core.py:173-188` (`test_unverified_watchlist_never_buys`),
  `test_core.py:381-409` (watchlist evaluation tests), and the three
  `format_recommendation` fixtures further down the file

**Interfaces:**
- Consumes: `buy_decision(long_read, criteria) -> (bool, list[dict])` from Task 1.
- Produces: `evaluate_watchlist(item, price, df, levels, risk, horizon_cfg, tech, news=None, buy_criteria=None) -> dict`.
  The `regime` parameter is **removed** — it was positional arg #5, so every
  parameter after it shifts left by one. Output dict gains `rules` (list),
  `rules_met` (int), `rules_total` (int, always 3); the `"conviction"` key is
  gone. `buy_zone` and `distance_to_zone_pct` are unchanged.

- [ ] **Step 1: Write the failing tests**

First, replace `test_core.py:381-409` (from `_WL_HORIZON = {...}` through the end
of `test_watchlist_watch_when_criteria_fail_with_reason`) with:

```python
_WL_HORIZON = {"short_lookback_days": 10, "long_lookback_days": 50,
               "short_ma": 20, "long_ma": 50}
_WL_TECH = {"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70}

def test_watchlist_buy_fires_via_rules_no_zone_needed():
    # Wide-open criteria isolate the wiring: no buy zone, uptrend frame -> BUY.
    df = _frame(list(range(1, 160)))
    w = {"code": "4015", "name": "Jamjoom", "sector": "pharma"}
    relaxed = {"rsi_recovery_band": (0, 100), "long_mom_floor_pct": -100.0}
    rec = az.evaluate_watchlist(w, price=100.0, df=df, levels={},
                                risk=BASE_RISK, horizon_cfg=_WL_HORIZON,
                                tech=_WL_TECH, buy_criteria=relaxed)
    assert rec["action"] == "BUY"
    assert rec["sizing"] is None  # sizing happens later, pooled per run.
    assert rec["rules_total"] == 3
    assert rec["rules_met"] == 3
    assert "conviction" not in rec

def test_watchlist_watch_when_rules_fail_with_reason():
    # A rising synthetic frame gives RSI 100 (all gains), so a narrow band
    # fails exactly one of the three rules: 2/3, with RSI named as the blocker.
    df = _frame(list(range(1, 160)))
    w = {"code": "4015", "name": "Jamjoom", "sector": "pharma"}
    strict = {"rsi_recovery_band": (25, 26), "long_mom_floor_pct": -5.0}
    rec = az.evaluate_watchlist(w, price=100.0, df=df, levels={},
                                risk=BASE_RISK, horizon_cfg=_WL_HORIZON,
                                tech=_WL_TECH, buy_criteria=strict)
    assert rec["action"] == "WATCH"
    assert rec["rules_met"] == 2 and rec["rules_total"] == 3
    assert any("RSI" in r for r in rec["reason"])
```

Second, replace `test_core.py:173-188` (`test_unverified_watchlist_never_buys`) with:

```python
def test_unverified_watchlist_never_buys():
    # Even a perfect setup stays out of BUY once the symbol fails verification.
    df = _frame(list(range(1, 160)))
    w = {"code": "6015", "name": "Jahez", "sector": "logistics"}
    relaxed = {"rsi_recovery_band": (0, 100), "long_mom_floor_pct": -100.0}
    rec = az.evaluate_watchlist(w, price=2.1, df=df, levels={},
                                risk=BASE_RISK, horizon_cfg=_WL_HORIZON,
                                tech=_WL_TECH, buy_criteria=relaxed)
    # evaluate_watchlist still returns BUY on the numbers; the gate that flips
    # unverified names to WATCH lives in main._collect_recs. Assert the gate's
    # contract directly: a False verification excludes the name from BUY.
    assert rec["action"] == "BUY"  # pre-gate
    verified = False
    action = "WATCH (UNVERIFIED)" if not verified else rec["action"]
    assert action == "WATCH (UNVERIFIED)"
```

Third, update the three `notify` fixtures. In `test_format_and_build_message`,
replace `"conviction": 72,` with `"rules_met": 3, "rules_total": 3,` and change
the assertion `assert "4015" in block and "BUY" in block and "conviction: 72" in block`
to:

```python
    assert "4015" in block and "BUY" in block and "Rules met: 3/3" in block
    assert "conviction" not in block
```

In `test_format_news_fetch_failed_renders_distinctly` and
`test_format_news_empty_result_renders_distinctly_from_failure`, replace
`"conviction": 0,` with `"rules_met": 0, "rules_total": 3,` in each fixture. Both
tests' assertions are about news rendering and need no other change.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest test_core.py -k "watchlist or format" -v`
Expected: FAIL — `evaluate_watchlist()` still requires the `regime` positional
argument these calls no longer pass, and `format_recommendation` still emits
`conviction: ...` rather than `Rules met: ...`.

- [ ] **Step 3: Rewrite `evaluate_watchlist`**

Replace `analyze.py:322-369` in full:

```python
# --- Watchlist evaluation --------------------------------------------------
def evaluate_watchlist(item: dict, price: float, df: pd.DataFrame, levels: dict,
                       risk: dict, horizon_cfg: dict, tech: dict,
                       news=None, buy_criteria: dict | None = None) -> dict:
    """Rule-checklist BUY/WATCH call for a name you might buy.

    Every rule from buy_decision() is reported, passed or not, so the digest can
    show "Rules met: 2/3" and name the blockers — instead of a conviction score
    that compressed three independent facts into one unfalsifiable number.

    Sizing is NOT attached here; the caller pools all BUYs and runs
    allocate_budget() so the monthly cap is respected across names.

    `regime` is no longer a parameter: it only ever fed the conviction cutoff,
    which is gone. The market regime is still computed once per run and shown
    in the digest header.
    """
    code = item["code"]
    low = levels.get("buy_zone_low")
    high = levels.get("buy_zone_high")

    ref_level = low if low is not None else price
    dist = (price - ref_level) / ref_level * 100 if ref_level else float("nan")

    short = ind.short_term_read(df, horizon_cfg["short_lookback_days"],
                                horizon_cfg["short_ma"])
    long = ind.long_term_read(df, horizon_cfg["long_lookback_days"],
                              horizon_cfg["short_ma"], horizon_cfg["long_ma"])

    criteria = buy_criteria or {"rsi_recovery_band": (25, 60),
                                "long_mom_floor_pct": -5.0}
    is_buy, rules = buy_decision(long, criteria)

    reason = []
    sizing = None
    if is_buy:
        action = "BUY"
        reason.append("all rules met")
    else:
        action = "WATCH"
        reason.extend(r["plain"] for r in rules if not r["passed"])

    out = {
        "kind": "watchlist",
        "code": code, "name": item.get("name", code),
        "price": round(price, 2), "action": action, "reason": reason,
        "rules": rules,
        "rules_met": sum(1 for r in rules if r["passed"]),
        "rules_total": len(rules),
        "buy_zone": [low, high],
        "distance_to_zone_pct": round(dist, 2) if not np.isnan(dist) else None,
        "sizing": sizing, "short_term": short, "long_term": long,
    }
    out["news"] = news_summary(news)
    return out
```

`news` is still accepted and still rendered via `news_summary()` — only its use
as a BUY veto is gone (removed from `buy_decision` in Task 1). The old
`news_score = news.score if news is not None else 0.0` line disappears with it;
nothing else in `analyze.py` reads `news.score`.

- [ ] **Step 4: Fix `main.py`'s call site**

Replace `main.py:235-237`:

```python
        rec = az.evaluate_watchlist(w, price, df, _levels_for(w["code"], stored_levels),
                                    cfg.RISK, cfg.HORIZON, cfg.TECH,
                                    news_by_code.get(w["code"]), cfg.BUY_CRITERIA)
```

The only change is dropping the `regime,` positional argument that sat between
`_levels_for(...)` and `cfg.RISK`. `_collect_recs` still computes `regime` via
`az.market_regime(...)` a few lines above and still returns it — `mode_digest`'s
header `f"TASI pre-open digest ({_today()}) - regime: {regime}"` is unaffected.

- [ ] **Step 5: Update `notify.format_recommendation`**

Replace `notify.py:46-55`:

```python
    if rec["kind"] == "watchlist":
        lines.append(f"   Rules met: {rec.get('rules_met')}/{rec.get('rules_total')}")
        sz = rec.get("sizing")
        if sz and not sz.get("skip"):
            lines.append(
                f"   size: BUY {sz['shares']} sh x {rec['price']} = {sz['spend']} SAR "
                f"(equal weight across qualifying names; "
                f"{sz.get('budget_left_after')} SAR of monthly budget left after)")
        elif sz and sz.get("skip"):
            lines.append(f"   size: none — {sz['skip']}")
```

- [ ] **Step 6: Run the affected tests**

Run: `python -m pytest test_core.py -k "watchlist or format" -v`
Expected: all PASS.

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass. `conviction_score` and `position_size` still exist as dead
code at this point (Task 4 deletes them) and their tests still pass unchanged.

- [ ] **Step 8: Commit**

```bash
git add analyze.py main.py notify.py test_core.py
git commit -m "Replace watchlist conviction score with the 3-rule checklist"
```

---

## Task 4: Delete `conviction_score` and `position_size`

After Tasks 1 and 3, nothing calls `conviction_score`. `position_size` was
already unreachable from any live path before this plan (only its own tests
call it).

**Files:**
- Modify: `analyze.py:115-172` (delete both functions and their section headers)
- Test: `test_core.py:99-105` (`test_conviction_uptrend_beats_downtrend`),
  `test_core.py:232-251` (the `# --- position sizing ---` header and 3 tests)

**Interfaces:**
- Consumes: nothing (deletion only).
- Produces: nothing new. **`BASE_RISK` must be KEPT.** Although its three
  `position_size` tests are deleted, the dict itself is still passed as
  `risk=BASE_RISK` by `test_holding_stop_triggers_sell`,
  `test_watchlist_buy_fires_via_rules_no_zone_needed`,
  `test_watchlist_watch_when_rules_fail_with_reason`, and
  `test_unverified_watchlist_never_buys`.

- [ ] **Step 1: Delete the conviction test**

Delete `test_core.py:99-105` in full — the `# --- conviction ---` header and
`test_conviction_uptrend_beats_downtrend`.

- [ ] **Step 2: Delete the three position_size tests, keep `BASE_RISK`**

In `test_core.py:232-251`, delete the `# --- position sizing ---` header comment
and the three functions `test_position_size_buys_whole_shares`,
`test_position_size_skips_when_share_too_expensive`, and
`test_position_size_respects_single_name_cap`. Leave the `BASE_RISK = {...}` dict
definition itself completely untouched (move it above where the deleted header
was if that reads better, but do not remove it).

- [ ] **Step 3: Run the full suite before touching `analyze.py`**

Run: `python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass, with 4 fewer tests than the previous run. This confirms
nothing else depended on those tests before the functions disappear.

- [ ] **Step 4: Delete both functions from `analyze.py`**

Delete `analyze.py:115-172` in full — from the `# --- Conviction ---` header
through the closing of `position_size`'s return dict. That is both:

```python
# --- Conviction ------------------------------------------------------------
def conviction_score(tr: str, r: float, tech: dict,
                     distance_to_level_pct: float) -> int:
    ...
```

and

```python
# --- Position sizing -------------------------------------------------------
def position_size(price: float, risk: dict) -> dict:
    ...
```

in their entirety, including both section-header comments. The
`# --- News shaping ---` section that follows stays exactly where it is.

- [ ] **Step 5: Confirm neither name survives anywhere**

Run: `grep -rn "conviction_score\|position_size" --include="*.py" .`
Expected: **no output at all.** Any hit means a caller was missed — fix it before
committing.

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add analyze.py test_core.py
git commit -m "Delete conviction_score and the unreachable position_size"
```

---

## Task 5: `config.py` + `backtest.sweep()` + `main.py` sweep columns

`config.BUY_CRITERIA` still carries both conviction keys. `backtest.sweep()`
sweeps a `conviction_min` axis AND reads `base["conviction_min_breakdown"]` —
the moment `config.py` drops that key, any `SWEEP=1 python main.py backtest` run
raises `KeyError`. No test covers `bt.sweep()`, so nothing would catch it. All
three files change together.

**Files:**
- Modify: `config.py:48-62` (`BUY_CRITERIA` and its comment)
- Modify: `backtest.py:479-508` (`DEFAULT_GRID` and `sweep()`)
- Modify: `main.py:365-374` (sweep print columns) and `main.py:386-387` (stale news caveat)

**Interfaces:**
- Consumes: nothing new.
- Produces: `cfg.BUY_CRITERIA = {"rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}`.
  `bt.sweep(...)` returns a frame with columns `rsi_band`, `mom_floor`, `events`,
  … — no `conviction_min` column.

- [ ] **Step 1: Update `config.py`'s `BUY_CRITERIA`**

Replace `config.py:48-62`:

```python
# --- BUY criteria ------------------------------------------------------------
# A watchlist name becomes BUY only when ALL THREE hold (enforced in one place:
# analyze.buy_decision, which reports every rule, passed or not):
#   1. RSI inside rsi_recovery_band — recovering, not capitulating, not chasing.
#   2. long-term trend == 'up'.
#   3. long-term momentum >= long_mom_floor_pct.
# There is no conviction score and no regime-raised bar: conviction backtested
# INVERTED against forward return and was deleted rather than tuned (see
# docs/backtest-findings-2026-07-23.md). There is no news rule either — news
# has never been validated against outcomes, so it is shown as context and
# gates nothing.
BUY_CRITERIA = {
    "rsi_recovery_band":        (25, 60),
    "long_mom_floor_pct":       -5.0,
}
```

- [ ] **Step 2: Update `backtest.py`'s `DEFAULT_GRID` and `sweep()`**

Replace `backtest.py:479-508`:

```python
# --- threshold sweep --------------------------------------------------------
DEFAULT_GRID = {
    "rsi_recovery_band": [(25, 60), (30, 60), (25, 70), (35, 65), (0, 100)],
    "long_mom_floor_pct": [-15.0, -10.0, -5.0, 0.0, 5.0],
}


def sweep(features: pd.DataFrame, hist: dict, index_df=None,
          grid: dict | None = None, base: dict | None = None) -> pd.DataFrame:
    """Grid over the surviving BUY thresholds. Event count sits beside every row
    — a three-trade cell with a 100% win rate is noise, and the table must make
    that obvious rather than sorting it to the top.

    Two axes, not three: the conviction_min axis is gone with conviction.
    """
    grid = grid or DEFAULT_GRID
    base = dict(base or cfg.BUY_CRITERIA)
    rows = []
    for band in grid["rsi_recovery_band"]:
        for floor in grid["long_mom_floor_pct"]:
            crit = {**base, "rsi_recovery_band": band, "long_mom_floor_pct": floor}
            ev = run(features, hist, crit)
            rep = report(ev, index_df)
            # Defaults first, so an all-zero-event grid still has the
            # columns to sort on instead of raising a confusing KeyError.
            rows.append({"rsi_band": f"{band[0]}-{band[1]}",
                         "mom_floor": floor, "events": 0, "expectancy_pct": None,
                         "win_rate_pct": None, "timeout_pct": None, **rep})
    return pd.DataFrame(rows).sort_values("expectancy_pct", ascending=False,
                                          na_position="last")
```

`LEVEL_GRID` and `sweep_levels` immediately below are unrelated to conviction —
leave them untouched.

- [ ] **Step 3: Update `main.py`'s sweep columns and delete the stale news caveat**

Replace `main.py:365-374`:

```python
    if sweep_kind:
        table = bt.sweep(feat, hist, index_df)
        cols = ["rsi_band", "mom_floor", "events",
                "expectancy_pct", "win_rate_pct", "timeout_pct",
                "edge_vs_baseline_pct"]
        print("\n" + table[[c for c in cols if c in table.columns]]
              .to_string(index=False))
        print("\nRead the events column first. A high expectancy on a handful "
              "of trades is noise, not a threshold.")
        return 0
```

Then delete this now-false `print(...)` at `main.py:386-387` entirely — it refers
to a numbered "criterion #2" (news) that no longer exists as a BUY rule:

```python
    print("News is neutralized to 0.0 (no historical headlines), so BUY "
          "criterion #2 is NOT validated here.")
```

Leave the surrounding `print(f"\nBacktest over ...")` and
`print("Survivorship: ...")` lines exactly as they are.

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass. No test exercises `bt.sweep()` — Step 5 covers it.

- [ ] **Step 5: Smoke-test `sweep()` for the `KeyError` no test would catch**

Run:

```bash
python -c "
import backtest as bt, pandas as pd
table = bt.sweep(pd.DataFrame(columns=bt.FEATURE_COLS), {})
cols = table.columns.tolist()
print(cols)
assert 'conviction_min' not in cols, 'conviction_min still in sweep output'
assert 'rsi_band' in cols and 'mom_floor' in cols
assert len(table) == 25, f'expected 5x5 grid, got {len(table)}'
print('OK')
"
```

Expected: prints the column list, then `OK`. An empty feature frame still runs
every grid cell's `crit` construction — which is exactly where the `KeyError`
would fire — so this is a cheap, real regression check.

- [ ] **Step 6: Commit**

```bash
git add config.py backtest.py main.py
git commit -m "Drop conviction_min from config and the backtest threshold sweep"
```

---

## Task 6: Documentation sweep + end-to-end verification

`README.md` describes conviction in six places and still claims BUY has four
criteria and that a breakdown regime "suppresses BUY signals". `test_core.py`'s
module docstring and `analyze.derive_levels`' docstring are also stale. These are
user-facing claims that are now false.

**Files:**
- Modify: `README.md` (lines 10, 11, 64, 66-69, 71, 79, 83-84)
- Modify: `test_core.py:4-6` (module docstring)
- Modify: `analyze.py` (`derive_levels` docstring, the "feeds the conviction score" line)

- [ ] **Step 1: Fix `README.md`'s overview lines**

Replace line 10:

```markdown
2. Checks the TASI index and reports the market regime in the digest header. The regime is context, not a gate — it no longer changes any per-name decision.
```

Replace line 11:

```markdown
3. Holdings: alerts on STOP, TRIM, or TARGET hits. Watchlist: reports how many of the three BUY rules each name meets, and equal-weight position sizing from your monthly budget.
```

- [ ] **Step 2: Fix `README.md`'s "When BUY fires" section**

Replace lines 64-71 (from `A watchlist name becomes **BUY** only when ALL four hold`
through the `The buy zone from levels.json ...` paragraph):

```markdown
A watchlist name becomes **BUY** only when ALL THREE hold (enforced in one place: `analyze.buy_decision`):

1. **RSI** inside `rsi_recovery_band` (25–60) — recovering, not capitulating, not chasing.
2. **Trend** is `up` (the 20/50-day MA cross).
3. **Momentum** ≥ `long_mom_floor_pct` (−5%) over the long lookback.

Trend and momentum are separate rules on purpose: an `up` MA cross with falling momentum meets one and fails the other, and the digest says so — `Rules met: 2/3` — rather than hiding both behind a single verdict.

There is **no conviction score**. It was deleted, not tuned: a walk-forward backtest over 3,733 events found its buckets *inverted* against forward return, while it was gating BUY and weighting the budget (see `docs/backtest-findings-2026-07-23.md`). There is **no news rule** either — news has never been validated against outcomes, so it is shown as context and gates nothing.

The buy zone from `levels.json` is not a gate; distance to it is reported as context. All thresholds live in `BUY_CRITERIA` in `config.py`.
```

- [ ] **Step 3: Fix `README.md`'s budget paragraph**

In line 79, replace the phrase `splits the *remaining* monthly budget across them
weighted by conviction, and rounds down to whole shares` with:

```markdown
splits the *remaining* monthly budget across them **equally**, and rounds down to whole shares
```

Leave the rest of that paragraph unchanged.

- [ ] **Step 4: Fix `README.md`'s validation paragraph**

Replace lines 83-84's phrasing so it no longer lists deleted thresholds:

```markdown
Every BUY threshold — the 25–60 RSI band, the −5% momentum
floor — was chosen by hand and, until now, never
```

(The sentence continues `checked against history.` on line 85 — leave that and
everything after it untouched.)

- [ ] **Step 5: Fix the `test_core.py` module docstring**

Replace `test_core.py:4-6`:

```python
Covers the logic that decisions depend on: RSI, trend, support/resistance,
regime detection, the BUY rule checklist, budget allocation, level derivation,
and the two evaluators. Data is synthetic so these are deterministic.
```

- [ ] **Step 6: Fix the `derive_levels` docstring in `analyze.py`**

In `derive_levels`' docstring, replace the sentence:

```
    Support and resistance still set the buy zone, which feeds the conviction
    score. They no longer set the money levels.
```

with:

```
    Support and resistance still set the buy zone, which is reported as context
    (distance_to_zone_pct). They no longer set the money levels, and they do not
    feed any BUY rule.
```

- [ ] **Step 7: Confirm no stale conviction references remain in code or docs**

Run: `grep -rn "conviction" --include="*.py" --include="*.md" . | grep -v "docs/superpowers/plans" | grep -v "backtest-findings"`

Expected: only deliberate historical explanations remain — the `buy_decision`,
`allocate_budget`, and `evaluate_watchlist` docstrings in `analyze.py`, the
`BUY_CRITERIA` comment in `config.py`, the `sweep()` docstring in `backtest.py`,
and the README paragraph added in Step 2. **Every one of those must be a sentence
explaining that conviction was removed and why — never a live reference.** If any
hit is a function call, dict key, or variable read, STOP and fix it.

- [ ] **Step 8: Run the full suite**

Run: `python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass, 0 failures.

- [ ] **Step 9: Manual end-to-end check**

Run: `python main.py digest`
(No `DISCORD_WEBHOOK_URL` set — prints to stdout.)

Expected in the printed digest:
- every watchlist name shows `Rules met: X/3`, never `conviction:` anything;
- no `None/100` anywhere;
- if any BUY fires, its size line reads "equal weight across qualifying names";
- the header still shows `- regime: ok` or `- regime: breakdown` as before;
- WATCH names list only their failing rules in plain language
  (e.g. `momentum -6.7% below floor -5.0%`).

- [ ] **Step 10: Commit**

```bash
git add README.md test_core.py analyze.py
git commit -m "Update docs to describe the rule checklist instead of conviction"
```

---

## Self-Review Notes

- **Spec coverage:** conviction deleted (Task 4), rule-checklist `buy_decision`
  (Task 1), equal-weight `allocate_budget` (Task 2), `evaluate_watchlist` rewired
  (Task 3), `config.BUY_CRITERIA` trimmed (Task 5), digest rendering (Task 3),
  docs (Task 6). Beyond the original design brainstorm, this plan also covers
  `backtest.run` (Task 1), `backtest.sweep` (Task 5), and `README.md` (Task 6) —
  real consumers the brainstorm did not anticipate, found by reading every call
  site before writing this plan.
- **No task ends red, and no task ends with a broken digest.** Task 1 bundles
  `buy_decision` with `backtest.run`; Task 3 bundles `evaluate_watchlist` with
  both `main.py` (a `TypeError` otherwise) and `notify.py` (a literal
  `conviction: None/100` in the live digest otherwise); Task 5 bundles
  `config.py` with `backtest.sweep` (a `KeyError` otherwise).
- **Type/signature consistency:** the rule dict shape
  (`rule`/`passed`/`actual`/`required`/`plain`) is defined once in Task 1 and
  consumed identically in Task 3 (`rules`, `rules_met`, `rules_total`) and in
  `notify.py` (`rec['rules_met']`/`rec['rules_total']`).
- **Deferred, untouched by every task here:** `triggers.py` (Stage C),
  history/deltas (Stage D), disclosures + `TECH["rsi_period"]` + CI (Stage E),
  scanner (Stage F).
- **Deliberately not cleaned up:** `evaluate_watchlist`'s unused `risk`
  parameter (pre-existing, out of scope per Global Constraints) and the `tech`
  parameter it also does not read. Only `backtest.run`'s `tech` is removed,
  because this plan is what makes it dead.

## Verification (end-to-end, after all 6 tasks)

```bash
cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system"
python -m pytest test_core.py research/test_base_rate.py -v
grep -rn "conviction_score\|position_size\|conviction_min" --include="*.py" .   # expect zero hits
python -c "import backtest as bt, pandas as pd; t=bt.sweep(pd.DataFrame(columns=bt.FEATURE_COLS), {}); assert 'conviction_min' not in t.columns and len(t)==25; print('sweep OK')"
python main.py digest    # every watchlist name shows "Rules met: X/3"
```
