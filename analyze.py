"""
Pure analysis functions. No network, no I/O -> fully unit-testable.
RSI, support/resistance, market-regime read, conviction score, position sizing.
"""
from math import floor


def rsi(closes, period=14):
    """Wilder's RSI. Returns None if not enough data. 0-100."""
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        gains.append(max(ch, 0.0))
        losses.append(max(-ch, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def support_resistance(closes, lookback=20):
    """Simple S/R = min/max of the recent window. Returns (support, resistance) or (None, None)."""
    if len(closes) < 2:
        return (None, None)
    window = closes[-lookback:]
    return (round(min(window), 2), round(max(window), 2))


def moving_average(values, n):
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def regime_ok_for_buys(summary, index_closes, regime_cfg):
    """
    Decide whether the market regime permits BUY alerts.
    summary: SAHMK market_summary dict (may be None).
    index_closes: TASI daily closes oldest->newest (may be []).
    Returns (ok: bool, reason: str).
    """
    if summary:
        chg = summary.get("index_change_percent")
        if chg is not None and chg <= regime_cfg["index_down_day_pct"]:
            return (False, f"TASI down {chg}% today (<= {regime_cfg['index_down_day_pct']}%)")
        mood = summary.get("market_mood")
        if mood in regime_cfg["bearish_moods"]:
            return (False, f"market mood {mood}")
    if index_closes:
        ma = moving_average(index_closes, regime_cfg["index_below_ma_days"])
        if ma is not None and index_closes[-1] < ma:
            return (False, f"TASI below its {regime_cfg['index_below_ma_days']}-day average")
    return (True, "regime ok")


def conviction_score(price, rsi_val, closes, buy_zone):
    """
    0-100 conviction for a BUY setup. Transparent, weighted:
      trend (40): price above short MA and MA rising
      rsi   (35): favours 40-60 rising, penalises >70 (extended) and <30 (falling knife risk)
      level (25): closer to / inside the buy zone scores higher
    Missing inputs (Free tier: no history) just drop that component's weight.
    """
    parts, weights = [], []

    # Trend component
    ma20 = moving_average(closes, 20) if closes else None
    ma50 = moving_average(closes, 50) if closes else None
    if ma20 is not None:
        trend = 0.0
        if price > ma20:
            trend += 0.6
        if ma50 is not None and ma20 > ma50:
            trend += 0.4
        parts.append(trend * 100)
        weights.append(40)

    # RSI component
    if rsi_val is not None:
        if rsi_val >= 70:
            r = 20        # extended, risky to chase
        elif rsi_val >= 55:
            r = 85        # strong but not overbought
        elif rsi_val >= 45:
            r = 100       # sweet spot
        elif rsi_val >= 35:
            r = 60
        else:
            r = 30        # oversold, could keep falling
        parts.append(r)
        weights.append(35)

    # Level proximity component
    if buy_zone:
        low, high = buy_zone
        if low <= price <= high:
            lvl = 100
        else:
            nearest = low if price < low else high
            dist = abs(price - nearest) / price
            lvl = max(0.0, 100 - dist * 1000)  # ~10% away -> 0
        parts.append(lvl)
        weights.append(25)

    if not parts:
        return None
    return round(sum(p * w for p, w in zip(parts, weights)) / sum(weights))


def derive_levels(kind, price, support, resistance, stop_loss_pct=0.09):
    """
    Propose levels from live technicals (for your approval, not auto-applied blindly).
    kind: 'watchlist' -> {'buy_zone': (low, high)} near support.
          'holding'   -> {'stop','trim','target'} from support/resistance.
    Needs history (support/resistance); returns {} if unavailable (e.g. Free tier).
    """
    if kind == "watchlist":
        if support is None:
            return {}
        return {"buy_zone": [round(support, 2), round(support * 1.03, 2)]}
    # holding
    out = {}
    out["stop"] = round(support * 0.97, 2) if support is not None else round(price * (1 - stop_loss_pct), 2)
    if resistance is not None:
        out["trim"] = round(resistance, 2)
        out["target"] = round(resistance * 1.05, 2)
    return out


def position_size(price, risk):
    """
    Shares to buy given cash + risk rules. Returns dict with shares, cost, commission,
    and a 'skip' reason if the trade fails a rule.
    """
    cash = risk["deployable_cash"]
    if cash <= 0:
        return {"shares": 0, "skip": "deployable_cash is 0 - set it in config"}

    investable = cash * (1 - risk["cash_buffer_pct"])
    budget = min(investable * risk["position_pct"],
                 cash * risk["max_single_position_pct"])
    shares = floor(budget / price)
    if shares <= 0:
        return {"shares": 0, "skip": "budget too small for one share"}

    trade_value = shares * price
    one_side = max(trade_value * risk["commission_rate"], risk["min_commission_sar"])
    round_trip = one_side * 2
    if round_trip > trade_value * risk["commission_floor_pct"]:
        return {"shares": 0, "skip": "commission > floor (trade too small to be worth it)"}

    return {
        "shares": shares,
        "cost": round(trade_value, 2),
        "commission_round_trip": round(round_trip, 2),
        "stop_price": round(price * (1 - risk["stop_loss_pct"]), 2),
        "skip": None,
    }
