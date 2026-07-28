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

import math

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


def trend_trigger(closes, short_ma: int, long_ma: int,
                  max_pct: float = MAX_SEARCH_PCT) -> dict:
    """Bounded forward scan for the nearest NEXT-bar close that flips trend
    to 'up'. Not a closed-form inversion — trend requires BOTH the short MA
    above the long MA AND the long MA rising, a two-part predicate over the
    appended price. Uses a forward scan rather than solving for the
    closed-form threshold: it does not require deriving or trusting that
    closed form, and stays correct if indicators.trend()'s definition ever
    changes to something non-monotonic in the future. (For the current
    definition, the qualifying set happens to be a single threshold in the
    appended price — but this code does not depend on that fact.) A linear
    scan from the current price upward is correct by construction: the
    first ascending price where the predicate holds is the nearest one.
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

    def is_up(p: float) -> bool:
        candidate = pd.concat([s, pd.Series([p])], ignore_index=True)
        return ind.trend(candidate, short_ma, long_ma) == "up"

    step = max(now * 0.001, 0.01)
    hi_p = now * (1 + max_pct / 100.0)
    price = now
    while price <= hi_p:
        price += step
        if is_up(price):
            # price is a scan step, not necessarily a "clean" 2-decimal
            # price a real quote could take. Round UP to the nearest cent
            # (never down) and re-verify: naively round()-ing the raw scan
            # price to 2dp can round it DOWN past the actual qualifying
            # boundary, reporting a trigger that would NOT actually flip
            # trend if that exact price were appended tomorrow.
            candidate_trigger = math.ceil(price * 100) / 100
            while not is_up(candidate_trigger):
                candidate_trigger += 0.01
            trigger = round(candidate_trigger, 2)
            pct_away = round((trigger - now) / now * 100.0, 2)
            return {"rule": "trend", "trigger_price": trigger,
                    "pct_away": pct_away, "reachable": True,
                    "plain": f"trend flips up at {trigger} "
                             f"({pct_away:+.1f}% away)"}
    return {"rule": "trend", "trigger_price": None, "pct_away": None,
            "reachable": False,
            "plain": f"not reachable within ±{max_pct:.0f}% next bar"}


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
