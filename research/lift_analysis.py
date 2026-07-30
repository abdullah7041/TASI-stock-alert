"""
Stage 1/2 of the breakout-scanner track: does anything beat the Stage 0 base
rate, or is that rate just volatility wearing a mask?

Two checks come before any feature gets credit for "lift":

1. Volatility-stratified base rate. Stage 0's 27.97% came from
   forward_max_return_pct, which scores a single intraday touch of +15% over
   60 bars -- on a volatile universe that is close to a coin flip. Two of the
   four candidate features below (vol_surge, atr_squeeze) are themselves
   volatility proxies. If the pooled base rate rises with trailing
   volatility, any lift they show must be judged WITHIN volatility strata,
   not against the pooled rate -- otherwise "found a feature" really means
   "found volatility."
2. A stricter label alongside the existing max-High one: forward
   close-to-close return over the same window. max-High counts any intraday
   touch; close-to-close requires the gain to have actually stuck.

Then: the 5 candidate features from the master plan (Stage F table) --
vol_surge, atr_squeeze, rel_strength, dist_52w_high, liquidity (a filter, not
a signal) -- decile lift vs both labels, split by year and by volatility
tercile.

Feature math here is a research approximation (simple rolling means/ranks),
not the scalar production indicators in indicators.py -- this is exploratory
feature scoring, not a backtest replay of production decisions, so bit-exact
reuse is not required the way it is in backtest.py.

Run: `python research/lift_analysis.py` from repo root. Requires
`.cache/features.csv` (MODE=universe then MODE=features must have run).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backtest as bt  # noqa: E402
import config as cfg  # noqa: E402
from scanner_features import code_feature_series  # noqa: E402
from research.base_rate import (  # noqa: E402
    ROCKET_PCT, ROCKET_WINDOW_BARS, label_rockets,
)

LABELED_CACHE = bt.CACHE / "lift_labeled.csv"
LIQUIDITY_FLOOR_SAR = 50_000  # median daily turnover a ~500 SAR order can't move.


# --- close-to-close label, same convention as the max-High one --------------

def forward_close_return_pct(df: pd.DataFrame, t: int, window: int = ROCKET_WINDOW_BARS) -> float | None:
    """Same entry/window convention as base_rate.forward_max_return_pct, but
    scored on the window's final Close, not the running max High. Answers
    'did the gain stick', not 'did it ever touch'."""
    n = len(df)
    if t + 1 >= n:
        return None
    entry = float(df["Open"].iloc[t + 1])
    if not np.isfinite(entry) or entry <= 0:
        entry = float(df["Close"].iloc[t + 1])
    if not np.isfinite(entry) or entry <= 0:
        return None
    last = t + window
    if last >= n:
        return None
    exit_ = float(df["Close"].iloc[last])
    return round((exit_ - entry) / entry * 100, 2)


def add_close_label(labeled: pd.DataFrame, hist: dict, threshold: float = ROCKET_PCT,
                    window: int = ROCKET_WINDOW_BARS) -> pd.DataFrame:
    """Adds fwd_close_return_pct / is_rocket_close to an already max-High
    labeled frame. Same t+window bar-count check as the max-High label, so
    rows land in both or neither."""
    out = []
    for code, group in labeled.groupby("code"):
        df = hist.get(code)
        if df is None or df.empty:
            continue
        for _, row in group.iterrows():
            c = forward_close_return_pct(df, int(row["t"]), window)
            if c is None:
                continue
            out.append({**row.to_dict(), "fwd_close_return_pct": c,
                       "is_rocket_close": c >= threshold})
    return pd.DataFrame(out)


# --- per-code rolling feature series -----------------------------------------

def build_labeled_with_features(feat: pd.DataFrame, hist: dict, index_df: pd.DataFrame) -> pd.DataFrame:
    labeled = label_rockets(feat, hist)
    labeled = add_close_label(labeled, hist)
    if labeled.empty:
        return labeled

    index_ret60 = code_feature_series(index_df)["ret_60d"] if index_df is not None and not index_df.empty else pd.Series(dtype=float)
    per_code_feats = {code: code_feature_series(df) for code, df in hist.items()
                      if df is not None and not df.empty}

    out = []
    for _, row in labeled.iterrows():
        code, t = row["code"], int(row["t"])
        fdf = per_code_feats.get(code)
        if fdf is None or t >= len(fdf):
            continue
        frow = fdf.iloc[t]
        date = fdf.index[t]
        idx_ret60 = index_ret60.asof(date) if not index_ret60.empty else None
        rel_strength = (frow["ret_60d"] - idx_ret60) if pd.notna(idx_ret60) else None
        out.append({
            **row.to_dict(),
            "vol_surge": frow["vol_surge"],
            "atr_squeeze_pctile": frow["atr_squeeze_pctile"],
            "rel_strength": rel_strength,
            "dist_52w_high": frow["dist_52w_high"],
            "liquidity_sar": frow["liquidity_sar"],
            "volatility_pct": frow["volatility_pct"],
        })
    return pd.DataFrame(out)


# --- reporting ----------------------------------------------------------------

def volatility_stratified_base_rate(labeled: pd.DataFrame, label_col: str) -> pd.DataFrame:
    df = labeled.dropna(subset=["volatility_pct"]).copy()
    df["vol_tercile"] = pd.qcut(df["volatility_pct"], 3, labels=["low", "mid", "high"], duplicates="drop")
    return df.groupby("vol_tercile", observed=True)[label_col].agg(["mean", "count"])


def decile_lift(labeled: pd.DataFrame, feature_col: str, label_col: str, bins: int = 10) -> tuple[pd.DataFrame, float]:
    df = labeled.dropna(subset=[feature_col]).copy()
    base = df[label_col].mean()
    df["decile"] = pd.qcut(df[feature_col], bins, labels=False, duplicates="drop")
    table = df.groupby("decile")[label_col].agg(["mean", "count"])
    table["lift_x"] = (table["mean"] / base).round(2) if base else None
    return table, base


def decile_lift_within_vol_strata(labeled: pd.DataFrame, feature_col: str, label_col: str,
                                   bins: int = 5) -> dict:
    df = labeled.dropna(subset=[feature_col, "volatility_pct"]).copy()
    df["vol_tercile"] = pd.qcut(df["volatility_pct"], 3, labels=["low", "mid", "high"], duplicates="drop")
    results = {}
    for tercile, g in df.groupby("vol_tercile", observed=True):
        g = g.copy()
        try:
            g["decile"] = pd.qcut(g[feature_col], bins, labels=False, duplicates="drop")
        except ValueError:
            continue
        base = g[label_col].mean()
        table = g.groupby("decile")[label_col].agg(["mean", "count"])
        table["lift_x"] = (table["mean"] / base).round(2) if base else None
        results[str(tercile)] = (table, base)
    return results


def by_year_lift(labeled: pd.DataFrame, feature_col: str, label_col: str, bins: int = 5) -> pd.DataFrame:
    df = labeled.dropna(subset=[feature_col]).copy()
    df["year"] = pd.to_datetime(df["date"]).dt.year
    rows = []
    for year, g in df.groupby("year"):
        g = g.copy()
        try:
            g["decile"] = pd.qcut(g[feature_col], bins, labels=False, duplicates="drop")
        except ValueError:
            continue
        base = g[label_col].mean()
        top = g[g["decile"] == g["decile"].max()][label_col].mean()
        rows.append({"year": year, "base_rate_pct": round(base * 100, 2),
                     "top_bucket_rate_pct": round(top * 100, 2) if pd.notna(top) else None,
                     "lift_x": round(top / base, 2) if base and pd.notna(top) else None,
                     "rows": len(g)})
    return pd.DataFrame(rows)


CANDIDATE_FEATURES = ["vol_surge", "atr_squeeze_pctile", "rel_strength", "dist_52w_high"]


# --- late-window check: is rel_strength's lift just 60d-momentum bleed-over? -

def forward_max_return_pct_late(df: pd.DataFrame, t: int, start: int = 31, end: int = 60) -> float | None:
    """Max High return over bars t+start..t+end only, entry still t+1's open.

    rel_strength is a trailing 60-bar return and the label window is also 60
    bars -- if rel_strength's lift only shows up because the label counts
    bars 1-30 (where 60-day momentum is still directly bleeding over), it is
    autocorrelation, not a usable signal at a weekly scan step. Requiring the
    touch to happen in the second half isolates that.
    """
    n = len(df)
    if t + 1 >= n:
        return None
    entry = float(df["Open"].iloc[t + 1])
    if not np.isfinite(entry) or entry <= 0:
        entry = float(df["Close"].iloc[t + 1])
    if not np.isfinite(entry) or entry <= 0:
        return None
    last = t + end
    if last >= n:
        return None
    highs = df["High"].iloc[t + start:last + 1]
    if highs.empty:
        return None
    return round((float(highs.max()) - entry) / entry * 100, 2)


def add_late_label(labeled: pd.DataFrame, hist: dict, threshold: float = ROCKET_PCT) -> pd.DataFrame:
    out = []
    for code, group in labeled.groupby("code"):
        df = hist.get(code)
        if df is None or df.empty:
            continue
        for _, row in group.iterrows():
            late = forward_max_return_pct_late(df, int(row["t"]))
            if late is None:
                continue
            out.append({**row.to_dict(), "fwd_late_return_pct": late,
                       "is_rocket_late": late >= threshold})
    return pd.DataFrame(out)


def main() -> int:
    if LABELED_CACHE.exists():
        print(f"loading cached labeled+feature frame from {LABELED_CACHE}")
        labeled = pd.read_csv(LABELED_CACHE, parse_dates=["date"])
        labeled["code"] = labeled["code"].astype(str)
    else:
        feat = bt.load_features()
        if feat.empty:
            print("no features. Run MODE=features first.")
            return 1
        codes = sorted(feat["code"].astype(str).unique())
        hist = bt.load_adjusted(codes, bt.HISTORY_YEARS)
        index_df = bt.load_adjusted([cfg.REGIME["index_code"]], bt.HISTORY_YEARS).get(cfg.REGIME["index_code"])
        labeled = build_labeled_with_features(feat, hist, index_df)
        labeled.to_csv(LABELED_CACHE, index=False)
        print(f"cached labeled+feature frame to {LABELED_CACHE} ({len(labeled)} rows)")

    print(f"\n=== Base rate, both labels ({len(labeled)} rows) ===")
    for label_col, name in [("is_rocket", "max-High touch"), ("is_rocket_close", "close-to-close")]:
        positives = int(labeled[label_col].sum())
        rows = len(labeled)
        print(f"{name}: {positives}/{rows} = {round(positives / rows * 100, 2)}%")

    print("\n=== Base rate by volatility tercile (ATR/price) ===")
    for label_col, name in [("is_rocket", "max-High"), ("is_rocket_close", "close-to-close")]:
        print(f"-- {name} --")
        print(volatility_stratified_base_rate(labeled, label_col))

    liq = labeled[labeled["liquidity_sar"] >= LIQUIDITY_FLOOR_SAR].copy()
    print(f"\n=== Liquidity floor: {LIQUIDITY_FLOOR_SAR:,} SAR median daily turnover ===")
    print(f"{len(labeled)} rows -> {len(liq)} rows after floor ({len(liq) / len(labeled) * 100:.1f}%)")

    print("\n=== rel_strength late-window check: does lift survive requiring the "
          "touch in bars 31-60, not 1-60? ===")
    codes = sorted(liq["code"].astype(str).unique())
    hist_for_late = bt.load_adjusted(codes, bt.HISTORY_YEARS)
    late = add_late_label(liq, hist_for_late)
    print(f"{len(liq)} rows -> {len(late)} rows have a full 31-60 window")
    table, base = decile_lift(late, "rel_strength", "is_rocket_late")
    print(f"pooled base rate (late window) {base * 100:.2f}%")
    print(table)

    for label_col, name in [("is_rocket", "max-High"), ("is_rocket_close", "close-to-close")]:
        print(f"\n{'=' * 70}\nLabel: {name} (post-liquidity-floor, n={len(liq)})\n{'=' * 70}")
        for feature_col in CANDIDATE_FEATURES:
            table, base = decile_lift(liq, feature_col, label_col)
            print(f"\n--- {feature_col} (pooled base rate {base * 100:.2f}%) ---")
            print(table)

            print(f"--- {feature_col} within volatility terciles ---")
            strata = decile_lift_within_vol_strata(liq, feature_col, label_col)
            for tercile, (table_s, base_s) in strata.items():
                print(f"  [{tercile} vol, base {base_s * 100:.2f}%]")
                print(table_s.to_string().replace("\n", "\n  "))

            print(f"--- {feature_col} by year (top quintile vs base) ---")
            print(by_year_lift(liq, feature_col, label_col))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
