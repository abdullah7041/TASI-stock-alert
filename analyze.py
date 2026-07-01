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
def derive_levels(df: pd.DataFrame, tech: dict, stop_pct: float) -> dict:
    """Propose levels from technicals so you don't hand-set them.

    - buy_zone: just above nearest support (a place to add on a pullback).
    - stop:     below support, capped by stop_pct.
    - target:   nearest resistance above.
    You review these in levels.json before they go live.
    """
    if df is None or df.empty:
        return {}
    support, resistance = ind.support_resistance(
        df["High"], df["Low"], df["Close"], tech["sr_lookback"]
    )
    price = float(df["Close"].iloc[-1])
    out = {"price_at_derivation": round(price, 2)}
    if support:
        out["buy_zone_low"] = round(support, 2)
        out["buy_zone_high"] = round(support * 1.03, 2)
        # Stop below support, but no deeper than stop_pct from the buy zone.
        stop_by_pct = support * (1 - stop_pct)
        out["stop"] = round(min(support * 0.97, stop_by_pct), 2)
    if resistance:
        out["target"] = round(resistance, 2)
    return out


# --- Conviction ------------------------------------------------------------
def conviction_score(df: pd.DataFrame, horizon_cfg: dict, tech: dict,
                     distance_to_level_pct: float) -> int:
    """0-100. Blends long-term trend, RSI position, and how close price is to the
    actionable level. Higher = stronger setup. Transparent, no black box."""
    closes = df["Close"]
    score = 50.0

    tr = ind.trend(closes, horizon_cfg["short_ma"], horizon_cfg["long_ma"])
    score += {"up": 20, "flat": 0, "down": -20, "unknown": -5}.get(tr, 0)

    r = ind.rsi(closes, tech["rsi_period"])
    if not np.isnan(r):
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


# --- Watchlist evaluation --------------------------------------------------
def evaluate_watchlist(item: dict, price: float, df: pd.DataFrame, levels: dict,
                       regime: str, risk: dict, horizon_cfg: dict, tech: dict,
                       news=None) -> dict:
    """BUY-zone check for a name you might buy. Suppressed in a market breakdown."""
    code = item["code"]
    low = levels.get("buy_zone_low")
    high = levels.get("buy_zone_high")

    in_zone = low is not None and high is not None and low <= price <= high
    action = "WATCH"
    reason = []
    sizing = None

    if in_zone:
        if regime == "breakdown":
            action = "WATCH (regime block)"
            reason.append("in buy zone, but TASI is breaking down; BUY suppressed")
        else:
            action = "BUY"
            reason.append(f"price {price:.2f} in buy zone {low:.2f}-{high:.2f}")
            sizing = position_size(price, risk)
            if sizing.get("skip"):
                action = "WATCH (sizing skip)"
                reason.append(sizing["skip"])

    ref_level = low if low is not None else price
    dist = (price - ref_level) / ref_level * 100 if ref_level else float("nan")
    conviction = conviction_score(df, horizon_cfg, tech, dist) if not df.empty else 0

    short = ind.short_term_read(df, horizon_cfg["short_lookback_days"], horizon_cfg["short_ma"])
    long = ind.long_term_read(df, horizon_cfg["long_lookback_days"],
                              horizon_cfg["short_ma"], horizon_cfg["long_ma"])

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
