"""
Recommendation engine.

Turns price + history + your levels into an action call. Pure functions on
plain inputs so every decision is inspectable and unit-testable offline.

It automates YOUR rules. It is not licensed financial advice and it never places
an order. You execute every trade yourself.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import indicators as ind


# Used when a caller does not pass config.LEVELS (older call sites, tests).
_DEFAULT_LEVELS = {
    "atr_period": 14, "atr_stop_mult": 1.5, "atr_target_mult": 3.0,
    "atr_trim_frac": 0.6,
}


# --- Market regime ---------------------------------------------------------
def market_regime(index_df: pd.DataFrame, index_ma: int) -> str:
    """'ok' or 'breakdown'. Breakdown = index below its MA and the MA is falling.
    When breakdown, BUY signals are suppressed."""
    if index_df is None or index_df.empty or "Close" not in index_df:
        return "unknown"
    closes = index_df["Close"]
    if len(closes) < index_ma + 2:
        return "unknown"
    ma_now = closes.iloc[-index_ma:].mean()
    ma_prev = closes.iloc[-index_ma - 1:-1].mean()
    price = float(closes.iloc[-1])
    if price < ma_now and ma_now < ma_prev:
        return "breakdown"
    return "ok"


# --- Level derivation ------------------------------------------------------
def levels_from_atr(price: float, atr_val: float, stop_pct: float,
                    levels_cfg: dict | None = None) -> dict:
    """Stop / target / trim placed a volatility distance from `price`.

    Split out of derive_levels so the backtest can re-place levels from a cached
    ATR without recomputing indicators — and, more importantly, so both paths
    run the SAME arithmetic. A backtest that reimplemented this would be tuning
    multipliers that production does not use.

    Returns {} when there is no usable ATR.
    """
    lc = levels_cfg or _DEFAULT_LEVELS
    if not np.isfinite(atr_val) or atr_val <= 0 or price <= 0:
        return {}
    out = {}
    # Stop: volatility distance, but never risk more than the configured cap.
    atr_stop = price - lc["atr_stop_mult"] * atr_val
    out["stop"] = round(max(atr_stop, price * (1 - stop_pct)), 2)
    out["target"] = round(price + lc["atr_target_mult"] * atr_val, 2)
    trim = price + lc["atr_trim_frac"] * (out["target"] - price)
    if price < trim < out["target"]:
        out["trim"] = round(trim, 2)
    return out


def derive_levels(df: pd.DataFrame, tech: dict, stop_pct: float,
                  levels_cfg: dict | None = None) -> dict:
    """Propose levels from technicals so you don't hand-set them.

    Stop and target are placed a volatility-scaled distance from the CURRENT
    price — the price you would actually enter at — so reward:risk is fixed by
    construction at atr_target_mult / atr_stop_mult.

    They used to be referenced to support and resistance instead, which silently
    assumed you entered near support. You do not: `buy_decision` fires wherever
    price is inside an uptrend, which is usually near resistance. The
    2026-07-23 backtest measured the consequence over 4,721 signals — median
    1.28% of upside against 10.50% of risk, R:R 0.12, negative expectancy at a
    71.9% win rate. Anchoring to entry is the fix.

    Support and resistance still set the buy zone, which feeds the conviction
    score. They no longer set the money levels.

    - buy_zone: just above nearest support (a place to add on a pullback).
    - stop:     atr_stop_mult ATRs below entry, never risking more than stop_pct.
    - target:   atr_target_mult ATRs above entry.
    - trim:     atr_trim_frac of the way from entry to target.
    You review these in levels.json before they go live.
    """
    if df is None or df.empty:
        return {}
    lc = levels_cfg or _DEFAULT_LEVELS
    support, resistance = ind.support_resistance(
        df["High"], df["Low"], df["Close"], tech["sr_lookback"]
    )
    price = float(df["Close"].iloc[-1])
    out = {"price_at_derivation": round(price, 2)}

    if support:
        out["buy_zone_low"] = round(support, 2)
        out["buy_zone_high"] = round(support * 1.03, 2)
    if resistance:
        out["resistance"] = round(resistance, 2)   # context only, not a target.

    a = ind.atr(df["High"], df["Low"], df["Close"], lc["atr_period"])
    if np.isfinite(a) and a > 0:
        out["atr"] = round(float(a), 4)
    out.update(levels_from_atr(price, a, stop_pct, lc))   # {} if no usable ATR.
    return out


# --- Conviction ------------------------------------------------------------
def conviction_score(tr: str, r: float, tech: dict,
                     distance_to_level_pct: float) -> int:
    """0-100. Blends long-term trend, RSI position, and how close price is to the
    actionable level. Higher = stronger setup. Transparent, no black box.

    Takes the already-computed trend label and RSI value so indicators are
    calculated once per name, not once per consumer."""
    score = 50.0

    score += {"up": 20, "flat": 0, "down": -20, "unknown": -5}.get(tr, 0)

    if r is not None and not np.isnan(r):
        if r < tech["rsi_oversold"]:
            score += 15           # oversold into support = better entry.
        elif r > tech["rsi_overbought"]:
            score -= 15           # overbought = chasing.
        else:
            score += (50 - abs(r - 50)) * 0.2  # mild bonus for mid-range.

    # Closer to the level = more actionable now.
    if not np.isnan(distance_to_level_pct):
        d = abs(distance_to_level_pct)
        score += 15 if d <= 1 else 8 if d <= 3 else 0 if d <= 6 else -8

    return int(max(0, min(100, round(score))))


# --- Position sizing -------------------------------------------------------
def position_size(price: float, risk: dict) -> dict:
    """How many shares to buy given cash and risk rules. Transparent math.

    Returns shares, spend, and a `skip` reason if the trade fails a rule.
    """
    cash = risk["deployable_cash"]
    investable = cash * (1 - risk["cash_buffer_pct"])
    target_spend = min(investable * risk["position_pct"],
                       cash * risk["max_single_pct"])
    if price <= 0 or target_spend <= 0:
        return {"shares": 0, "spend": 0.0, "skip": "no cash / bad price"}

    shares = int(target_spend // price)
    if shares < 1:
        return {"shares": 0, "spend": 0.0,
                "skip": f"one share ({price:.2f}) exceeds target spend ({target_spend:.0f})"}

    spend = shares * price
    commission = max(spend * risk["commission_rate"], risk["min_commission"])
    if commission > spend * risk["commission_floor_pct"]:
        return {"shares": 0, "spend": 0.0,
                "skip": "round-trip commission over floor; lot too small"}

    return {
        "shares": shares,
        "spend": round(spend, 2),
        "commission": round(commission, 2),
        "pct_of_cash": round(spend / cash * 100, 1),
    }


# --- Holdings evaluation ---------------------------------------------------
def evaluate_holding(holding: dict, price: float, df: pd.DataFrame, levels: dict,
                     horizon_cfg: dict, tech: dict) -> dict:
    """STOP / TRIM / TARGET / HOLD for a name you own, with short+long reads."""
    code = holding["code"]
    action, reason = "HOLD", []
    stop = levels.get("stop")
    trim = levels.get("trim")
    target = levels.get("target")

    if stop is not None and price <= stop:
        action = "SELL (STOP)"
        reason.append(f"price {price:.2f} <= stop {stop:.2f}")
    elif target is not None and price >= target:
        action = "SELL (TARGET)"
        reason.append(f"price {price:.2f} >= target {target:.2f}")
    elif trim is not None and price >= trim:
        action = "TRIM"
        reason.append(f"price {price:.2f} >= trim {trim:.2f}")

    short = ind.short_term_read(df, horizon_cfg["short_lookback_days"], horizon_cfg["short_ma"])
    long = ind.long_term_read(df, horizon_cfg["long_lookback_days"],
                              horizon_cfg["short_ma"], horizon_cfg["long_ma"])
    pnl_pct = round((price - holding["avg_cost"]) / holding["avg_cost"] * 100, 1) \
        if holding.get("avg_cost") else None

    return {
        "kind": "holding",
        "code": code, "name": holding.get("name", code),
        "price": round(price, 2), "action": action, "reason": reason,
        "unrealized_pct": pnl_pct,
        "short_term": short, "long_term": long,
    }


# --- BUY decision ----------------------------------------------------------
def buy_decision(conviction: int, news_score: float, long_read: dict,
                 regime: str, criteria: dict) -> tuple[bool, list]:
    """The single place BUY is decided. Returns (is_buy, failed_checks).

    BUY fires only when ALL of these hold:
      1. conviction >= criteria['conviction_min'] — raised to
         criteria['conviction_min_breakdown'] when the TASI regime is
         'breakdown' or 'unknown'. The regime raises the bar; it never blocks.
      2. news_score >= 0 (no news / failed fetch is neutral 0.0, which passes).
      3. long-term RSI inside criteria['rsi_recovery_band'] — recovering, not
         capitulating and not chasing.
      4. long-term read confirms strength: trend == 'up' AND long momentum
         >= criteria['long_mom_floor_pct']. Both are required — an 'up' MA
         cross with falling momentum (or positive momentum under a non-up
         trend) is not enough. This closes the "up trend but momentum below
         the floor" contradiction.
    """
    failed = []
    cautious = regime in ("breakdown", "unknown")
    cutoff = criteria["conviction_min_breakdown"] if cautious else criteria["conviction_min"]
    if conviction < cutoff:
        failed.append(f"conviction {conviction} < {cutoff}"
                      + (" (breakdown-raised bar)" if cautious else ""))
    if news_score < 0:
        failed.append(f"news sentiment negative ({news_score})")
    lo, hi = criteria["rsi_recovery_band"]
    r = long_read.get("rsi")
    if r is None or np.isnan(r):
        failed.append("RSI unavailable")
    elif not (lo <= r <= hi):
        failed.append(f"RSI {r} outside recovery band {lo}-{hi}")
    mom = long_read.get("momentum_pct")
    trend_up = long_read.get("trend") == "up"
    mom_ok = mom is not None and not np.isnan(mom) and mom >= criteria["long_mom_floor_pct"]
    if not (trend_up and mom_ok):
        failed.append(f"long-term not confirmed (trend {long_read.get('trend')}, "
                      f"mom {mom}% vs floor {criteria['long_mom_floor_pct']}%; "
                      f"need trend=up AND mom>=floor)")
    return (len(failed) == 0), failed


# --- Budget allocation ------------------------------------------------------
def allocate_budget(buys: list, budget_sar: float) -> dict:
    """Split the remaining monthly budget across BUY recs, weighted by
    conviction. Mutates each rec's 'sizing' in place; returns a summary.

    Rules (transparent, in order):
      - Candidates processed highest conviction first.
      - Each gets slice = budget * (its conviction / total conviction), then
        rounded DOWN to whole shares (Tadawul does not allow fractions).
      - If the slice affords 0 shares but 1 share fits what is left of the
        budget, it gets 1 share (highest conviction first).
      - Unspent remainder of a slice rolls to the next candidate via the
        running 'remaining' amount; whatever is left at the end stays cash.
      - Hard invariant: total spend <= budget_sar.
    """
    summary = {"budget": round(budget_sar, 2), "allocated": 0.0, "leftover": round(budget_sar, 2)}
    if not buys or budget_sar <= 0:
        for r in buys:
            r["sizing"] = {"shares": 0, "spend": 0.0, "skip": "monthly budget exhausted"}
        return summary

    candidates = sorted(buys, key=lambda r: r["conviction"], reverse=True)
    total_conv = sum(r["conviction"] for r in candidates) or 1
    remaining = budget_sar

    for r in candidates:
        price = r["price"]
        weight = r["conviction"] / total_conv
        slice_sar = min(budget_sar * weight, remaining)
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
            "weight_pct": round(weight * 100, 1),
            "budget_left_after": round(remaining, 2),
        }

    summary["allocated"] = round(budget_sar - remaining, 2)
    summary["leftover"] = round(remaining, 2)
    return summary


# --- Watchlist evaluation --------------------------------------------------
def evaluate_watchlist(item: dict, price: float, df: pd.DataFrame, levels: dict,
                       regime: str, risk: dict, horizon_cfg: dict, tech: dict,
                       news=None, buy_criteria: dict | None = None) -> dict:
    """Criteria-based BUY/WATCH call for a name you might buy.

    The buy zone (levels.json) is no longer a gate — proximity to it feeds the
    conviction score. The actual BUY decision lives in buy_decision() above.
    Sizing is NOT attached here; the caller pools all BUYs and runs
    allocate_budget() so the monthly cap is respected across names.
    """
    code = item["code"]
    low = levels.get("buy_zone_low")

    ref_level = low if low is not None else price
    dist = (price - ref_level) / ref_level * 100 if ref_level else float("nan")

    short = ind.short_term_read(df, horizon_cfg["short_lookback_days"], horizon_cfg["short_ma"])
    long = ind.long_term_read(df, horizon_cfg["long_lookback_days"],
                              horizon_cfg["short_ma"], horizon_cfg["long_ma"])

    conviction = conviction_score(long.get("trend"), long.get("rsi"), tech, dist) \
        if not df.empty else 0

    news_score = news.score if news is not None else 0.0
    criteria = buy_criteria or {"conviction_min": 65, "conviction_min_breakdown": 80,
                                "rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
    is_buy, failed = buy_decision(conviction, news_score, long, regime, criteria)

    reason = []
    sizing = None
    if is_buy:
        action = "BUY"
        reason.append(f"all BUY criteria met (conviction {conviction}, regime {regime})")
    else:
        action = "WATCH"
        reason.extend(failed)

    high = levels.get("buy_zone_high")
    out = {
        "kind": "watchlist",
        "code": code, "name": item.get("name", code),
        "price": round(price, 2), "action": action, "reason": reason,
        "conviction": conviction, "buy_zone": [low, high],
        "distance_to_zone_pct": round(dist, 2) if not np.isnan(dist) else None,
        "sizing": sizing, "short_term": short, "long_term": long,
    }
    if news is not None:
        out["news"] = {"label": news.label, "score": news.score,
                       "confidence": news.confidence, "count": len(news.headlines)}
    return out
