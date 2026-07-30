"""
Shared feature math for both research/lift_analysis.py (offline validation)
and scanner.py (live scanning). Must remain byte-identical or results will drift.
"""

import pandas as pd


def code_feature_series(df: pd.DataFrame) -> pd.DataFrame:
    """Whole-history rolling features for one code's OHLCV, indexed same as df.

    Every column at position t is computed from bars up to and including t
    only (rolling/shift, no centering) -- matches the no-look-ahead
    convention features.csv itself uses (window = df.iloc[:t+1]).
    """
    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    dollar_vol = close * vol

    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr14 = tr.rolling(14).mean()
    atr_over_price = atr14 / close

    out = pd.DataFrame(index=df.index)
    out["vol_surge"] = dollar_vol / dollar_vol.rolling(20).median()
    out["atr_squeeze_pctile"] = atr_over_price.rolling(126).apply(
        lambda w: (w <= w.iloc[-1]).mean(), raw=False)
    out["ret_60d"] = close.pct_change(60) * 100
    roll_high_252 = high.rolling(252).max()
    out["dist_52w_high"] = (close - roll_high_252) / roll_high_252 * 100
    out["liquidity_sar"] = dollar_vol.rolling(60).median()
    out["volatility_pct"] = atr_over_price * 100
    return out
