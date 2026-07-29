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
import triggers as trig


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

    Support and resistance still set the buy zone, which is reported as context
    (distance_to_zone_pct). They no longer set the money levels, and they do not
    feed any BUY rule.

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


# --- News shaping ------------------------------------------------------------
def news_summary(news) -> dict | None:
    """Shape a news.NewsResult into the dict notify.py renders. Shared by both
    evaluators so a fetch failure and a genuinely empty result render
    identically regardless of which evaluation path found the name."""
    if news is None:
        return None
    return {
        "ok": news.ok,
        "label": news.label,
        "score": news.score,
        "headlines": news.headlines,
    }


# --- Holdings evaluation ---------------------------------------------------
def evaluate_holding(holding: dict, price: float, df: pd.DataFrame, levels: dict,
                     horizon_cfg: dict, tech: dict, news=None) -> dict:
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
        "news": news_summary(news),
    }


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
    triggers = trig.compute_triggers(df, rules, horizon_cfg, criteria)

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
        "triggers": triggers,
        "buy_zone": [low, high],
        "distance_to_zone_pct": round(dist, 2) if not np.isnan(dist) else None,
        "sizing": sizing, "short_term": short, "long_term": long,
    }
    out["news"] = news_summary(news)
    return out
