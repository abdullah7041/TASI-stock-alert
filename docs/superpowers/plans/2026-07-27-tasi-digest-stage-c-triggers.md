# TASI Digest Stage C — Trigger Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For every currently-failing BUY rule, compute the exact price that would flip it, and show the nearest one in the digest — replacing "WATCH, 2/3 rules met" with a falsifiable, checkable claim: "clears the -5% momentum floor at 62.10 (+4.3% away)."

**Architecture:** New `triggers.py` module with one pure function per rule type (`momentum_trigger`, `rsi_trigger`, `trend_trigger`) plus a dispatcher (`compute_triggers`) that calls the right one for each failing rule from `analyze.buy_decision`'s output. Two of the three invert in closed form (momentum, RSI); trend has no closed-form inverse and is found by a bounded forward scan, not bisection (see Global Constraints — this was checked and bisection is wrong here). `analyze.evaluate_watchlist` gains a `triggers` output key; `notify.py` renders the nearest reachable one.

**Tech Stack:** Python 3, pandas, numpy, pytest (repo's existing offline test convention).

## Global Constraints

- **Trigger prices are next-bar estimates, not "eventually" estimates.** Both closed-form inversions (momentum, RSI) solve for what the price would need to be *on the very next bar* to flip the rule, using today's other inputs (the 120-day-old reference price for momentum, today's smoothed avg_gain/avg_loss for RSI). If price drifts there over three days instead of one, the rule may not flip at that exact number — the rolling windows will have moved. This must be stated in the module docstring and reflected in the digest label (`Trigger (next bar): ...`), not left implicit.
- **The trend rule's inverse is found by bounded forward scan, never bisection.** `indicators.trend()` requires BOTH `short_mean > long_mean` AND the long MA rising — appending one hypothetical bar does not move the qualifying-price set monotonically, so bisection can converge to an arbitrary boundary instead of the *nearest* flipping price. A linear scan from the current price upward, in small steps, bounded at ±25%, is correct by construction and cheap (at most ~250 calls to `indicators.trend()` per name per digest run). This was caught before implementation — do not "simplify" it back to bisection.
- **RSI inversion must use the SAME smoothed avg_gain/avg_loss `indicators.rsi()` computes**, not a reimplementation. `indicators.py` gains a `wilder_gain_loss()` helper, extracted from `rsi()` without changing `rsi()`'s output for any existing input — this is a refactor, not a behavior change, and Task 1 proves it.
- **RSI trigger period is hardcoded to 14, matching what `indicators.long_term_read()` actually computes today** (`ind.rsi(closes)` with no period argument) — NOT read from `config.TECH["rsi_period"]`, because that config key is configured but not threaded through anywhere yet (a known, separately-deferred bug, Stage E). The trigger must invert whatever period produced the "current RSI" the rule dict already reports, or the two would disagree about what RSI even means. Keep this as a named module constant (`RSI_PERIOD = 14`) with a comment, not a bare literal, so Stage E's fix touches both together.
- **`pct_away`'s sign is meaningful, not just a magnitude.** A trigger below current price (RSI must fall) is negative; above (momentum/RSI must rise, trend must flip up) is positive. Render with an explicit sign (`{pct_away:+.1f}`).
- Every trigger function returns `{rule, trigger_price, pct_away, reachable, plain}` — `trigger_price`/`pct_away` may be numeric even when `reachable` is `False` (informative: "here's where it would be, but that's further than we bother searching"), or `None` when there's nothing to compute (insufficient history, or the rule already passes).
- `evaluate_watchlist`'s output-shape change (`triggers` key) and `notify.py`'s renderer are ONE task (Task 4) — a partial deploy wouldn't break anything, but it would ship dead, invisible code, which is the same waste a broken-render bug would be, just silent instead of loud.
- Stage D (history/deltas), Stage E (disclosures, `TECH["rsi_period"]` threading, CI), and Stage F (scanner) are separate future plans. Nothing here should anticipate them, beyond leaving the `RSI_PERIOD` constant named so Stage E can find it.

---

## File Structure

| File | Change |
|---|---|
| `indicators.py` | Add `wilder_gain_loss()`, refactor `rsi()` to use it (no behavior change) |
| `triggers.py` | **New** — `momentum_trigger`, `rsi_trigger`, `trend_trigger`, `compute_triggers` |
| `analyze.py` | `evaluate_watchlist` gains a `triggers` output key |
| `notify.py` | `format_recommendation` renders the nearest reachable trigger |
| `test_core.py` | New tests for all of the above |

---

## Task 1: `indicators.wilder_gain_loss()` — extract and prove unchanged

**Files:**
- Modify: `indicators.py:14-29` (`rsi`)
- Test: `test_core.py` (RSI section, near the existing RSI tests)

**Interfaces:**
- Produces: `wilder_gain_loss(closes, period: int = 14) -> tuple[float, float]` — returns `(avg_gain, avg_loss)`, both `nan` if `len(closes) < period + 1`. `rsi(closes, period)`'s public signature and behavior are unchanged for every existing caller.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py` near the existing RSI tests (after `test_rsi_midrange_between_0_and_100`):

```python
def test_wilder_gain_loss_matches_rsi_derivation():
    closes = [10, 10.5, 10.2, 10.8, 10.6, 11.0, 10.9, 11.3, 11.1, 11.5,
             11.4, 11.8, 11.6, 12.0, 11.9, 12.3]
    avg_gain, avg_loss = ind.wilder_gain_loss(closes, 14)
    assert not np.isnan(avg_gain) and not np.isnan(avg_loss)
    derived_rsi = 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    assert abs(derived_rsi - ind.rsi(closes, 14)) < 1e-9

def test_wilder_gain_loss_insufficient_data_is_nan():
    avg_gain, avg_loss = ind.wilder_gain_loss([10, 11, 12], 14)
    assert np.isnan(avg_gain) and np.isnan(avg_loss)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k wilder_gain_loss -v`
Expected: FAIL — `indicators.wilder_gain_loss` does not exist yet.

- [ ] **Step 3: Extract `wilder_gain_loss` and refactor `rsi`**

Replace `indicators.py:14-29`:

```python
def wilder_gain_loss(closes, period: int = 14) -> tuple[float, float]:
    """The smoothed avg_gain/avg_loss Wilder's RSI is built from. Exposed so
    triggers.py can invert RSI using the EXACT same smoothing rsi() uses — a
    second implementation of the same math would validate different numbers
    than the ones that actually decide anything. Returns (nan, nan) if there
    is not enough data.
    """
    s = pd.Series(list(closes), dtype="float64").dropna()
    if len(s) < period + 1:
        return float("nan"), float("nan")
    delta = s.diff().dropna()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    # Wilder smoothing via exponential moving average with alpha = 1/period.
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean().iloc[-1]
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean().iloc[-1]
    return float(avg_gain), float(avg_loss)


def rsi(closes, period: int = 14) -> float:
    """Wilder's RSI on the last `period` window. Returns 0-100, or float('nan')
    if there is not enough data."""
    avg_gain, avg_loss = wilder_gain_loss(closes, period)
    if np.isnan(avg_gain):
        return float("nan")
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return float(100.0 - (100.0 / (1.0 + rs)))
```

- [ ] **Step 4: Run the new tests and the FULL suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass, including the 5 pre-existing RSI tests (`test_rsi_all_gains_is_100`, `test_rsi_all_losses_is_low`, `test_rsi_insufficient_data_is_nan`, `test_rsi_midrange_between_0_and_100`, and any other test that calls `ind.rsi(...)` anywhere in the file, e.g. via `short_term_read`/`long_term_read`) — this is the proof that the refactor changed nothing observable.

- [ ] **Step 5: Commit**

```bash
git add indicators.py test_core.py
git commit -m "Extract wilder_gain_loss from rsi() so it can be inverted"
```

---

## Task 2: `triggers.py` — momentum and RSI (closed form)

**Files:**
- Create: `triggers.py`
- Test: `test_core.py` (new section)

**Interfaces:**
- Consumes: `indicators.wilder_gain_loss`, `indicators.rsi` (Task 1).
- Produces: `momentum_trigger(closes, lookback: int, floor_pct: float) -> dict`, `rsi_trigger(closes, period: int, lo: float, hi: float) -> dict`. Both return `{rule, trigger_price, pct_away, reachable, plain}`. `rule` is `"momentum_floor"` / `"rsi_band"` respectively. Task 3 adds `trend_trigger` to this same file; Task 4's `compute_triggers` dispatches to all three.

- [ ] **Step 1: Write the failing tests**

Create `test_core.py` additions (new section, anywhere after the indicator tests — e.g. right before the "BUY decision" section):

```python
# --- trigger prices -----------------------------------------------------
import triggers as trig

def test_momentum_trigger_exact_arithmetic():
    # 121 bars: index -121 (the "old" reference for a 120-day lookback) is
    # 100.0, current close is 90.0. Floor -5% -> trigger = 100 * 0.95 = 95.0.
    closes = [100.0] + [95.0] * 119 + [90.0]
    t = trig.momentum_trigger(closes, 120, -5.0)
    assert t["rule"] == "momentum_floor"
    assert t["reachable"] is True
    assert abs(t["trigger_price"] - 95.0) < 0.01
    # (95 - 90) / 90 * 100 = 5.5555...
    assert abs(t["pct_away"] - 5.56) < 0.01

def test_momentum_trigger_insufficient_history_is_unreachable():
    t = trig.momentum_trigger([100.0] * 50, 120, -5.0)
    assert t["reachable"] is False
    assert t["trigger_price"] is None

def test_rsi_trigger_round_trips_through_indicators_rsi():
    # A falling series -> RSI well below the recovery band's low edge (25).
    # Compute the trigger, append it as the NEXT bar, and confirm the
    # resulting RSI actually lands at (near) 25 -- this is the real proof,
    # not just that the algebra is self-consistent.
    closes = [20 - i * 0.15 for i in range(30)]  # steadily falling
    current_rsi = ind.rsi(closes, 14)
    assert current_rsi < 25  # below the band, as the test assumes
    t = trig.rsi_trigger(closes, 14, 25, 60)
    assert t["rule"] == "rsi_band"
    assert t["reachable"] is True
    appended = closes + [t["trigger_price"]]
    landed_rsi = ind.rsi(appended, 14)
    assert abs(landed_rsi - 25) < 0.5  # closed-form inversion, tight tolerance

def test_rsi_trigger_already_in_band_is_unreachable():
    # Flat series sits RSI at a stable mid value, inside (25, 60).
    closes = [50.0] * 30
    t = trig.rsi_trigger(closes, 14, 25, 60)
    assert t["reachable"] is False

def test_rsi_trigger_beyond_max_search_is_unreachable():
    # Deeply oversold: RSI nowhere near 25, needs an enormous single-bar
    # gain to get there -- should report a trigger_price but reachable=False.
    closes = [100 - i * 2 for i in range(20)]  # sharp, sustained decline
    t = trig.rsi_trigger(closes, 14, 25, 60)
    if not t["reachable"]:
        assert t["trigger_price"] is not None  # informative even when out of reach
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "momentum_trigger or rsi_trigger" -v`
Expected: FAIL — `triggers` module does not exist.

- [ ] **Step 3: Write `triggers.py`**

```python
"""
Trigger prices: the price that would flip a currently-failing
analyze.buy_decision rule. Computed from the SAME windows and formulas
buy_decision checks (indicators.rsi's exact smoothing, indicators.trend's
exact rule), so a stated trigger is falsifiable — check tomorrow whether
the price got there and whether the rule actually flipped.

IMPORTANT — these are NEXT-BAR estimates, not "eventually" estimates. The
closed-form inversions (momentum, RSI) solve for what price would need to
land on the very next bar, using today's other inputs (the 120-day-old
reference price, today's smoothed avg_gain/avg_loss). If price drifts there
over several days instead of one, the rolling windows will have moved and
the rule may not flip at that exact number. This is a real limit of the
math, not a bug — the digest labels these "Trigger (next bar):" so the
claim being made is scoped honestly.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import indicators as ind

MAX_SEARCH_PCT = 25.0   # give up beyond ±25% from the current price.

# RSI trigger inverts whatever period actually produced the "current RSI" a
# rule dict reports. indicators.long_term_read() calls ind.rsi(closes) with
# NO period argument (defaults to 14) because config.TECH["rsi_period"] is
# not threaded through yet (a known, separately deferred bug — Stage E).
# When that's fixed, this constant must be threaded the same way, in the
# same change.
RSI_PERIOD = 14


def momentum_trigger(closes, lookback: int, floor_pct: float) -> dict:
    """Exact: the price on the NEXT bar such that momentum over `lookback`
    bars would equal `floor_pct`. momentum = (P_now - P_old)/P_old*100, so
    P_now = P_old * (1 + floor_pct/100) is a direct solve — no search needed.
    """
    s = pd.Series(list(closes), dtype="float64").dropna()
    if len(s) < lookback + 1:
        return {"rule": "momentum_floor", "trigger_price": None,
                "pct_away": None, "reachable": False,
                "plain": "not enough history"}
    old = float(s.iloc[-lookback - 1])
    now = float(s.iloc[-1])
    if old <= 0 or now <= 0:
        return {"rule": "momentum_floor", "trigger_price": None,
                "pct_away": None, "reachable": False,
                "plain": "not enough history"}
    trigger = old * (1 + floor_pct / 100.0)
    pct_away = (trigger - now) / now * 100.0
    months = round(lookback / 21) or 1
    return {
        "rule": "momentum_floor", "trigger_price": round(trigger, 2),
        "pct_away": round(pct_away, 2), "reachable": True,
        "plain": f"{months}-mo momentum clears {floor_pct:.1f}% at "
                 f"{trigger:.2f} ({pct_away:+.1f}% away)",
    }


def rsi_trigger(closes, period: int, lo: float, hi: float) -> dict:
    """Exact: the NEXT close such that RSI lands at the nearer band edge,
    inverting the SAME Wilder smoothing indicators.rsi() uses
    (indicators.wilder_gain_loss). Only one of gain/loss changes on a single
    bar (a bar is either a gain or a loss, never both), which is what makes
    this a closed-form solve rather than a search.
    """
    s = pd.Series(list(closes), dtype="float64").dropna()
    if len(s) < period + 1:
        return {"rule": "rsi_band", "trigger_price": None, "pct_away": None,
                "reachable": False, "plain": "not enough history"}
    avg_gain, avg_loss = ind.wilder_gain_loss(s, period)
    if np.isnan(avg_gain):
        return {"rule": "rsi_band", "trigger_price": None, "pct_away": None,
                "reachable": False, "plain": "not enough history"}
    last_close = float(s.iloc[-1])
    current_rsi = ind.rsi(s, period)
    alpha = 1.0 / period

    if np.isnan(current_rsi) or current_rsi < lo:
        target = lo
    elif current_rsi > hi:
        target = hi
    else:
        return {"rule": "rsi_band", "trigger_price": None, "pct_away": None,
                "reachable": False, "plain": "already inside the band"}

    rs_target = target / (100.0 - target)

    if target > current_rsi:
        # RSI must rise: next bar is a gain (loss decays toward zero).
        if avg_loss == 0:
            return {"rule": "rsi_band", "trigger_price": None,
                    "pct_away": None, "reachable": False,
                    "plain": "no loss to decay against"}
        needed_gain = (rs_target * (1 - alpha) * avg_loss
                      - (1 - alpha) * avg_gain) / alpha
        trigger = last_close + needed_gain
    else:
        # RSI must fall: next bar is a loss (gain decays toward zero).
        if rs_target == 0:
            return {"rule": "rsi_band", "trigger_price": None,
                    "pct_away": None, "reachable": False,
                    "plain": "target RSI is zero"}
        needed_loss = ((1 - alpha) * avg_gain / rs_target
                      - (1 - alpha) * avg_loss) / alpha
        trigger = last_close - needed_loss

    if trigger <= 0:
        return {"rule": "rsi_band", "trigger_price": None, "pct_away": None,
                "reachable": False, "plain": "trigger price is non-positive"}
    pct_away = (trigger - last_close) / last_close * 100.0
    reachable = abs(pct_away) <= MAX_SEARCH_PCT
    plain = (f"RSI clears the {lo:.0f}-{hi:.0f} band at {trigger:.2f} "
            f"({pct_away:+.1f}% away)" if reachable
            else f"RSI band needs a {pct_away:+.1f}% move — beyond "
                 f"±{MAX_SEARCH_PCT:.0f}%")
    return {"rule": "rsi_band", "trigger_price": round(trigger, 2),
            "pct_away": round(pct_away, 2), "reachable": reachable,
            "plain": plain}
```

- [ ] **Step 4: Run the new tests**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "momentum_trigger or rsi_trigger" -v`
Expected: all 5 PASS. `test_rsi_trigger_round_trips_through_indicators_rsi` is the one to look at closely — it proves the closed-form inversion against the real `ind.rsi()` function, not just its own algebra.

- [ ] **Step 5: Run the full suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add triggers.py test_core.py
git commit -m "Add closed-form momentum and RSI trigger-price inversion"
```

---

## Task 3: `triggers.py` — trend (bounded forward scan)

This is the risky one — reviewed alone so a reviewer can focus on it. `indicators.trend()` requires BOTH `short_mean > long_mean` AND the long MA rising; appending one hypothetical bar does not move the qualifying-price set monotonically, so a naive bisection can converge to a boundary that isn't the *nearest* flipping price. A linear scan from the current price upward is correct by construction: the first price (in ascending order) where the predicate holds *is* the nearest one, no monotonicity assumption required.

**Files:**
- Modify: `triggers.py` (append `trend_trigger`)
- Test: `test_core.py`

**Interfaces:**
- Consumes: `indicators.trend` (unchanged).
- Produces: `trend_trigger(closes, short_ma: int, long_ma: int, max_pct: float = MAX_SEARCH_PCT) -> dict` — same 5-key shape as the other two, `rule` is `"trend"`.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py`, right after the RSI trigger tests:

```python
def test_trend_trigger_flips_down_to_up_and_no_smaller_price_does():
    # A steadily falling series: trend is "down". Find the trigger, confirm
    # appending it flips trend to "up", AND confirm the immediately-preceding
    # scan step does NOT flip it -- this is the actual guarantee a forward
    # scan gives that bisection would not: the trigger is the SMALLEST
    # qualifying price, not just A qualifying price.
    closes = [100 - i * 0.3 for i in range(60)]
    assert ind.trend(closes, 20, 50) in ("down", "flat")
    t = trig.trend_trigger(closes, 20, 50)
    assert t["rule"] == "trend"
    assert t["reachable"] is True
    appended_at_trigger = closes + [t["trigger_price"]]
    assert ind.trend(appended_at_trigger, 20, 50) == "up"
    step = max(closes[-1] * 0.001, 0.01)
    just_below = closes + [t["trigger_price"] - step]
    assert ind.trend(just_below, 20, 50) != "up"

def test_trend_trigger_already_up_is_unreachable():
    closes = [50 + i * 0.5 for i in range(60)]  # steadily rising
    assert ind.trend(closes, 20, 50) == "up"
    t = trig.trend_trigger(closes, 20, 50)
    assert t["reachable"] is False
    assert t["trigger_price"] is None

def test_trend_trigger_unreachable_within_bound():
    # A long MA falling hard enough that no single next bar within +25%
    # can make it rise -- genuinely out of reach, not a scan bug.
    closes = [200 - i * 3 for i in range(60)]
    t = trig.trend_trigger(closes, 20, 50, max_pct=25.0)
    assert t["reachable"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k trend_trigger -v`
Expected: FAIL — `trig.trend_trigger` does not exist.

- [ ] **Step 3: Append `trend_trigger` to `triggers.py`**

```python
def trend_trigger(closes, short_ma: int, long_ma: int,
                  max_pct: float = MAX_SEARCH_PCT) -> dict:
    """Bounded forward scan for the nearest NEXT-bar close that flips trend
    to 'up'. Not a closed-form inversion — trend requires BOTH the short MA
    above the long MA AND the long MA rising, and appending one bar does not
    move the qualifying-price set monotonically, so bisection is not valid
    here (checked and rejected before implementation). A linear scan from
    the current price upward is correct by construction: the first
    ascending price where the predicate holds is the nearest one.
    """
    s = pd.Series(list(closes), dtype="float64").dropna()
    if len(s) < long_ma + 2:
        return {"rule": "trend", "trigger_price": None, "pct_away": None,
                "reachable": False, "plain": "not enough history"}
    now = float(s.iloc[-1])
    if now <= 0:
        return {"rule": "trend", "trigger_price": None, "pct_away": None,
                "reachable": False, "plain": "not enough history"}
    if ind.trend(s, short_ma, long_ma) == "up":
        return {"rule": "trend", "trigger_price": None, "pct_away": None,
                "reachable": False, "plain": "trend already up"}

    step = max(now * 0.001, 0.01)
    hi_p = now * (1 + max_pct / 100.0)
    price = now
    while price <= hi_p:
        price += step
        candidate = pd.concat([s, pd.Series([price])], ignore_index=True)
        if ind.trend(candidate, short_ma, long_ma) == "up":
            trigger = round(price, 2)
            pct_away = round((trigger - now) / now * 100.0, 2)
            return {"rule": "trend", "trigger_price": trigger,
                    "pct_away": pct_away, "reachable": True,
                    "plain": f"trend flips up at {trigger} "
                             f"({pct_away:+.1f}% away)"}
    return {"rule": "trend", "trigger_price": None, "pct_away": None,
            "reachable": False,
            "plain": f"not reachable within ±{max_pct:.0f}% next bar"}
```

- [ ] **Step 4: Run the new tests**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k trend_trigger -v`
Expected: all 3 PASS. `test_trend_trigger_flips_down_to_up_and_no_smaller_price_does` is the load-bearing one — it specifically checks the scan found the *nearest* flip, not just *a* flip.

- [ ] **Step 5: Run the full suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add triggers.py test_core.py
git commit -m "Add bounded forward-scan trend trigger (not bisection — see docstring)"
```

---

## Task 4: `compute_triggers` + `evaluate_watchlist` + `notify.py` (bundled)

**Files:**
- Modify: `triggers.py` (append `compute_triggers`)
- Modify: `analyze.py:281-334` (`evaluate_watchlist`)
- Modify: `notify.py:38-59` (`format_recommendation`)
- Test: `test_core.py`

**Interfaces:**
- Consumes: `momentum_trigger`, `rsi_trigger`, `trend_trigger` (Tasks 2-3); `evaluate_watchlist`'s existing `rules`/`criteria`/`horizon_cfg` (unchanged, from Stage B).
- Produces: `compute_triggers(df, rules: list, horizon_cfg: dict, criteria: dict) -> list` — one trigger dict per FAILING rule (passed rules produce nothing, there's nothing to flip). `evaluate_watchlist`'s output dict gains `triggers` (the list `compute_triggers` returns) — no signature change, additive only. `notify.format_recommendation` renders the single nearest reachable trigger (smallest `abs(pct_away)` among `reachable=True` entries), or a "none within reach" line if triggers exist but none are reachable, or nothing at all if there are no failing rules (a BUY).

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py`:

```python
def test_compute_triggers_only_for_failing_rules():
    rules = [
        {"rule": "rsi_band", "passed": True, "actual": 45.0, "required": "25-60", "plain": "ok"},
        {"rule": "trend", "passed": False, "actual": "down", "required": "up", "plain": "trend down, need up"},
        {"rule": "momentum_floor", "passed": True, "actual": 2.0, "required": -5.0, "plain": "ok"},
    ]
    df = _frame(list(range(1, 160)))  # from the existing test fixture helper
    horizon_cfg = {"long_lookback_days": 120, "short_ma": 20, "long_ma": 50}
    criteria = {"rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
    result = trig.compute_triggers(df, rules, horizon_cfg, criteria)
    assert len(result) == 1
    assert result[0]["rule"] == "trend"

def test_compute_triggers_empty_when_all_rules_pass():
    rules = [
        {"rule": "rsi_band", "passed": True, "actual": 45.0, "required": "25-60", "plain": "ok"},
        {"rule": "trend", "passed": True, "actual": "up", "required": "up", "plain": "ok"},
        {"rule": "momentum_floor", "passed": True, "actual": 2.0, "required": -5.0, "plain": "ok"},
    ]
    df = _frame(list(range(1, 160)))
    horizon_cfg = {"long_lookback_days": 120, "short_ma": 20, "long_ma": 50}
    criteria = {"rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
    assert trig.compute_triggers(df, rules, horizon_cfg, criteria) == []

def test_evaluate_watchlist_includes_triggers_key():
    df = _frame(list(range(200, 89, -1)) + list(range(90, 110)))  # falling then flat-ish
    w = {"code": "4015", "name": "Jamjoom", "sector": "pharma"}
    strict = {"rsi_recovery_band": (25, 26), "long_mom_floor_pct": -5.0}
    rec = az.evaluate_watchlist(w, price=100.0, df=df, levels={}, risk=BASE_RISK,
                                horizon_cfg=_WL_HORIZON, tech=_WL_TECH,
                                buy_criteria=strict)
    assert "triggers" in rec
    assert isinstance(rec["triggers"], list)
    if rec["action"] == "WATCH":
        failing_rule_names = {r["rule"] for r in rec["rules"] if not r["passed"]}
        trigger_rule_names = {t["rule"] for t in rec["triggers"]}
        assert trigger_rule_names == failing_rule_names

def test_format_recommendation_renders_nearest_trigger():
    rec = {
        "kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
        "action": "WATCH", "reason": ["momentum below floor"],
        "rules_met": 2, "rules_total": 3,
        "triggers": [
            {"rule": "momentum_floor", "trigger_price": 105.0, "pct_away": 5.0,
             "reachable": True, "plain": "6-mo momentum clears -5.0% at 105.00 (+5.0% away)"},
            {"rule": "rsi_band", "trigger_price": 98.0, "pct_away": -2.0,
             "reachable": True, "plain": "RSI clears the 25-60 band at 98.00 (-2.0% away)"},
        ],
        "short_term": {"momentum_pct": 0, "rsi": 50},
        "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50},
    }
    block = nt.format_recommendation(rec)
    assert "Trigger (next bar): RSI clears the 25-60 band at 98.00 (-2.0% away)" in block
    assert "momentum clears" not in block  # the farther one is not shown

def test_format_recommendation_shows_none_within_reach_when_no_trigger_reachable():
    rec = {
        "kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
        "action": "WATCH", "reason": ["trend down"], "rules_met": 1, "rules_total": 3,
        "triggers": [
            {"rule": "trend", "trigger_price": None, "pct_away": None,
             "reachable": False, "plain": "not reachable within ±25% next bar"},
        ],
        "short_term": {"momentum_pct": 0, "rsi": 50},
        "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50},
    }
    block = nt.format_recommendation(rec)
    assert "Trigger (next bar): none within reach" in block

def test_format_recommendation_no_trigger_line_when_buy():
    rec = {
        "kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
        "action": "BUY", "reason": ["all rules met"], "rules_met": 3, "rules_total": 3,
        "triggers": [],
        "short_term": {"momentum_pct": 0, "rsi": 50},
        "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50},
    }
    block = nt.format_recommendation(rec)
    assert "Trigger" not in block
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "compute_triggers or evaluate_watchlist_includes_triggers or format_recommendation_renders_nearest or format_recommendation_shows_none or format_recommendation_no_trigger" -v`
Expected: FAIL — `trig.compute_triggers` doesn't exist; `evaluate_watchlist` doesn't produce a `triggers` key; `format_recommendation` doesn't render one.

- [ ] **Step 3: Append `compute_triggers` to `triggers.py`**

```python
def compute_triggers(df, rules: list, horizon_cfg: dict, criteria: dict) -> list:
    """For every FAILING rule in `rules` (analyze.buy_decision's output),
    compute its trigger price. Passed rules produce nothing — there is
    nothing to flip.
    """
    closes = df["Close"]
    out = []
    for r in rules:
        if r["passed"]:
            continue
        if r["rule"] == "momentum_floor":
            out.append(momentum_trigger(closes, horizon_cfg["long_lookback_days"],
                                        criteria["long_mom_floor_pct"]))
        elif r["rule"] == "rsi_band":
            lo, hi = criteria["rsi_recovery_band"]
            out.append(rsi_trigger(closes, RSI_PERIOD, lo, hi))
        elif r["rule"] == "trend":
            out.append(trend_trigger(closes, horizon_cfg["short_ma"],
                                     horizon_cfg["long_ma"]))
    return out
```

- [ ] **Step 4: Wire `evaluate_watchlist`**

In `analyze.py`, add `import triggers as trig` to the top-level imports (alongside `import indicators as ind`). Then in `evaluate_watchlist` (`analyze.py:281-334`), after the line `is_buy, rules = buy_decision(long, criteria)` and before the `reason = []` block, add:

```python
    triggers = trig.compute_triggers(df, rules, horizon_cfg, criteria)
```

And add `"triggers": triggers,` to the returned `out` dict, next to the existing `"rules"` key:

```python
    out = {
        "kind": "watchlist",
        "code": code, "name": item.get("name", code),
        "price": round(price, 2), "action": action, "reason": reason,
        "rules": rules,
        "rules_met": sum(1 for r in rules if r["passed"]),
        "rules_total": len(rules),
        "triggers": triggers,
        "buy_zone": [low, high],
        "distance_to_zone_pct": round(dist, 2) if not np.isnan(dist) else None,
        "sizing": sizing, "short_term": short, "long_term": long,
    }
```

- [ ] **Step 5: Render in `notify.py`**

Add a helper right after `_fmt_news` in `notify.py`, and call it from `format_recommendation`:

```python
def _fmt_trigger(triggers: list) -> str | None:
    """One line: the nearest reachable trigger, or an honest 'none within
    reach' if triggers exist but none are close enough to compute, or None
    if there's nothing failing to show (a BUY)."""
    if not triggers:
        return None
    reachable = [t for t in triggers if t.get("reachable")]
    if not reachable:
        return "   Trigger (next bar): none within reach"
    nearest = min(reachable, key=lambda t: abs(t["pct_away"]))
    return f"   Trigger (next bar): {nearest['plain']}"
```

In `format_recommendation` (`notify.py:38-59`), add this right after the `Rules met:` line (inside the `if rec["kind"] == "watchlist":` block, before the `sz = rec.get("sizing")` line):

```python
        trigger_line = _fmt_trigger(rec.get("triggers") or [])
        if trigger_line:
            lines.append(trigger_line)
```

- [ ] **Step 6: Run the new tests**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "compute_triggers or evaluate_watchlist_includes_triggers or format_recommendation_renders_nearest or format_recommendation_shows_none or format_recommendation_no_trigger" -v`
Expected: all 6 PASS.

- [ ] **Step 7: Run the full suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass — in particular, every EXISTING `test_format_and_build_message`-family test and every existing `evaluate_watchlist` test must still pass unchanged, since `triggers` is purely additive to both the rec dict and the rendered text (no existing assertion checks for the ABSENCE of a "Trigger" line in a fixture that doesn't set `triggers`, so verify `rec.get("triggers") or []` degrades to `[]` — and therefore no trigger line — for any pre-Stage-C fixture that doesn't include the key at all).

- [ ] **Step 8: Commit**

```bash
git add triggers.py analyze.py notify.py test_core.py
git commit -m "Wire trigger prices into evaluate_watchlist and the digest"
```

---

## Task 5: Documentation + live end-to-end verification

**Files:**
- Modify: `README.md` (add a short section on trigger prices)
- No new tests — this task verifies the branch as a whole.

- [ ] **Step 1: Add a README section**

Add a new section to `README.md`, right after the existing "When BUY fires (the exact criteria)" section (which Stage B rewrote to describe the 3-rule checklist):

```markdown
## Trigger prices (what would have to be true)

For every rule a watchlist name is currently failing, the digest computes
the price that would flip it on the very next bar, and shows the nearest
one: `Trigger (next bar): RSI clears the 25-60 band at 54.10 (-8.2% away)`.

This is scoped honestly: it is a next-bar estimate. Momentum and RSI solve
exactly for what price would need to land tomorrow, using today's other
inputs (the 120-day-old reference price, today's smoothed RSI inputs). If
price drifts there over several days instead of one, the rolling windows
will have moved and the rule may not flip at that exact number — that is a
property of the math, not a bug. The trend rule has no closed-form inverse
(it depends on two rolling means, not one number), so it is found by
scanning forward in small steps, bounded at ±25% — if nothing within that
range flips it, the digest says so (`none within reach`) rather than
guessing further out.

This is what replaces a verdict with a falsifiable claim: check tomorrow
whether the stated price did what was claimed.
```

- [ ] **Step 2: Run the full suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass, 0 failures.

- [ ] **Step 3: Manual end-to-end check**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python main.py digest`
(No `DISCORD_WEBHOOK_URL` set — prints to stdout.)

Expected in the printed digest: every WATCH name whose failing rules have at least one reachable trigger shows a `Trigger (next bar): ...` line naming the nearest one; a WATCH name with no reachable trigger shows `Trigger (next bar): none within reach`; BUY names (if any fire) and HOLD names show no Trigger line at all. Paste the actual output in your report — do not describe expected output without having run it.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document trigger prices in the README"
```

---

## Self-Review Notes

- **Spec coverage:** momentum trigger (Task 2), RSI trigger with round-trip proof (Task 2), trend trigger via forward scan not bisection (Task 3, explicitly caught before implementation), dispatcher + integration + rendering (Task 4), docs + live verification (Task 5).
- **The bisection mistake was caught before any task was written**, not discovered mid-execution — `indicators.trend()`'s two-condition predicate (mean comparison AND slope) is not monotonic in the next close, so bisection can converge to an arbitrary boundary. Task 3's forward scan is correct by construction and its test (`test_trend_trigger_flips_down_to_up_and_no_smaller_price_does`) specifically checks for the *nearest* flip, not merely *a* flip — the exact property bisection could have silently gotten wrong.
- **The RSI inversion is proven against the real `indicators.rsi()` function**, not just against its own algebra — `test_rsi_trigger_round_trips_through_indicators_rsi` appends the computed trigger price and re-derives RSI from scratch.
- **No task ends red:** `evaluate_watchlist`'s new `triggers` key is purely additive (no signature change, no existing test can regress from it existing), so Task 4 does not have the same "partial deploy breaks the digest" risk Stage B's equivalent bundling did — it is bundled anyway because a `triggers` field nobody renders is dead code, which is worth a single task and a single review, not because skipping the bundle would break anything.
- **Deferred, confirmed out of scope:** `RSI_PERIOD = 14` in `triggers.py` must be updated together with Stage E's fix to `TECH["rsi_period"]` threading — noted as a named constant specifically so that fix finds it. Stage D (history/deltas), Stage E (disclosures, CI), Stage F (scanner) — untouched.
- **Type/signature consistency:** every trigger function returns exactly `{rule, trigger_price, pct_away, reachable, plain}`; `compute_triggers` (Task 4) consumes this shape from Tasks 2-3 without modification; `notify._fmt_trigger` (Task 4) consumes the same shape from `compute_triggers`'s output.

## Verification (end-to-end, after all 5 tasks)

```bash
cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system"
python -m pytest test_core.py research/test_base_rate.py -v
python main.py digest    # every failing-rule WATCH name shows "Trigger (next bar): ..."
```
