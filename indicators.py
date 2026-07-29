"""
Technical indicators. Pure functions on price series.

Everything here works on a list/Series of closing prices or an OHLC DataFrame.
No network, no globals — so it is fully unit-testable offline.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


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


def sma(closes, period: int) -> float:
    """Simple moving average of the last `period` closes. NaN if too short."""
    s = pd.Series(list(closes), dtype="float64").dropna()
    if len(s) < period:
        return float("nan")
    return float(s.iloc[-period:].mean())


def atr(highs, lows, closes, period: int = 14) -> float:
    """Average True Range (Wilder). NaN if there is not enough data.

    True range is the widest of: today's range, today's high vs yesterday's
    close, today's low vs yesterday's close — so it counts overnight gaps that a
    plain high-low would miss. Used to place stops and targets a volatility-
    scaled distance from the entry, instead of at chart levels that may sit any
    distance away.
    """
    h = pd.Series(list(highs), dtype="float64")
    low = pd.Series(list(lows), dtype="float64")
    c = pd.Series(list(closes), dtype="float64")
    n = min(len(h), len(low), len(c))
    if n < period + 1:
        return float("nan")
    h, low, c = h.iloc[:n], low.iloc[:n], c.iloc[:n]

    prev_close = c.shift(1)
    tr = pd.concat([h - low, (h - prev_close).abs(), (low - prev_close).abs()],
                   axis=1).max(axis=1).dropna()
    if len(tr) < period:
        return float("nan")
    val = tr.ewm(alpha=1 / period, adjust=False).mean().iloc[-1]
    return float(val) if np.isfinite(val) else float("nan")


def support_resistance(highs, lows, closes, lookback: int = 60):
    """Nearest support (below current price) and resistance (above) from recent
    swing lows/highs. Falls back to the window min/max if no clear swing exists.

    Returns (support, resistance). Either may be None.
    """
    h = pd.Series(list(highs), dtype="float64").dropna()
    low = pd.Series(list(lows), dtype="float64").dropna()
    c = pd.Series(list(closes), dtype="float64").dropna()
    if len(c) == 0:
        return None, None
    price = float(c.iloc[-1])
    h = h.iloc[-lookback:]
    low = low.iloc[-lookback:]

    # Swing points: local extrema over a 5-bar window.
    swing_highs, swing_lows = [], []
    hv, lv = h.values, low.values
    for i in range(2, len(hv) - 2):
        if hv[i] == max(hv[i - 2:i + 3]):
            swing_highs.append(hv[i])
        if lv[i] == min(lv[i - 2:i + 3]):
            swing_lows.append(lv[i])

    supports = [x for x in swing_lows if x < price] or [float(low.min())]
    resistances = [x for x in swing_highs if x > price] or [float(h.max())]

    support = max(supports) if supports else None
    resistance = min(resistances) if resistances else None
    return support, resistance


def trend(closes, short_ma: int, long_ma: int) -> str:
    """'up' / 'down' / 'flat' from the relationship of two moving averages and
    the slope of the long MA."""
    s = pd.Series(list(closes), dtype="float64").dropna()
    if len(s) < long_ma + 2:
        return "unknown"
    short = s.iloc[-short_ma:].mean()
    long_now = s.iloc[-long_ma:].mean()
    long_prev = s.iloc[-long_ma - 1:-1].mean()
    rising = long_now > long_prev
    if short > long_now and rising:
        return "up"
    if short < long_now and not rising:
        return "down"
    return "flat"


def pct_change(closes, days: int) -> float:
    """Percent change over the last `days` bars. NaN if too short."""
    s = pd.Series(list(closes), dtype="float64").dropna()
    if len(s) < days + 1:
        return float("nan")
    old = float(s.iloc[-days - 1])
    new = float(s.iloc[-1])
    if old == 0:
        return float("nan")
    return (new - old) / old * 100.0


def short_term_read(df: pd.DataFrame, lookback: int, short_ma: int, rsi_period: int = 14) -> dict:
    """Short-horizon momentum read."""
    closes = df["Close"]
    return {
        "horizon": "short",
        "momentum_pct": round(pct_change(closes, lookback), 2),
        "rsi": round(rsi(closes, rsi_period), 1),
        "above_ma": bool(float(closes.iloc[-1]) > sma(closes, short_ma))
        if not np.isnan(sma(closes, short_ma)) else None,
    }


def long_term_read(df: pd.DataFrame, lookback: int, short_ma: int, long_ma: int,
                   rsi_period: int = 14) -> dict:
    """Long-horizon swing read. This is the more reliable one on daily data."""
    closes = df["Close"]
    return {
        "horizon": "long",
        "trend": trend(closes, short_ma, long_ma),
        "momentum_pct": round(pct_change(closes, lookback), 2),
        "rsi": round(rsi(closes, rsi_period), 1),
    }
