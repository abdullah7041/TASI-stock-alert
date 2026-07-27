"""
Stage 0 of the breakout-scanner track: what is the real base rate of a
"rocket" (a big forward move) across the full backtest universe?

Every later scanner feature must be judged as lift OVER this number, never as
raw accuracy. If nothing beats it, the scanner track stops here — that is the
agreed outcome, not a failure to fix.

Run: `python research/base_rate.py` from the repo root. Requires
`.cache/features.csv` to already exist (MODE=universe then MODE=features).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backtest as bt  # noqa: E402

ROCKET_PCT = 15.0
ROCKET_WINDOW_BARS = 60


def forward_max_return_pct(df: pd.DataFrame, t: int, window: int = ROCKET_WINDOW_BARS) -> float | None:
    """Max close-to-high gain from bar t+1's open over the next `window` bars.

    Entry is t+1's open, matching backtest.resolve_outcome's no-look-ahead
    convention (a decision made on bar t cannot fill at bar t's own close).
    Returns None when there are not enough future bars to judge a full
    window — those rows must be DROPPED by the caller, not scored as "not a
    rocket", or the base rate would be biased toward names near the end of
    their history (which have disproportionately few forward bars).
    """
    n = len(df)
    if t + 1 >= n:
        return None
    entry = float(df["Open"].iloc[t + 1])
    if not np.isfinite(entry) or entry <= 0:
        entry = float(df["Close"].iloc[t + 1])
    if not np.isfinite(entry) or entry <= 0:
        return None
    last = min(t + window, n - 1)
    if last < t + window:
        return None
    highs = df["High"].iloc[t + 1:last + 1]
    return round((float(highs.max()) - entry) / entry * 100, 2)


def label_rockets(feat: pd.DataFrame, hist: dict, threshold: float = ROCKET_PCT,
                  window: int = ROCKET_WINDOW_BARS) -> pd.DataFrame:
    """Adds fwd_max_return_pct and is_rocket to every feature row that has a
    matching, non-empty history and enough future bars to judge. Rows that
    fail either check are dropped, not zero-filled."""
    if feat.empty:
        return pd.DataFrame()
    out_rows = []
    for code, group in feat.groupby("code"):
        df = hist.get(code)
        if df is None or df.empty:
            continue
        for _, row in group.iterrows():
            fwd = forward_max_return_pct(df, int(row["t"]), window)
            if fwd is None:
                continue
            out_rows.append({**row.to_dict(), "fwd_max_return_pct": fwd,
                             "is_rocket": fwd >= threshold})
    return pd.DataFrame(out_rows)


def base_rate_report(labeled: pd.DataFrame) -> dict:
    """Overall and per-year base rate, plus counts. A rate without its count
    is not trustworthy — 2 positives out of 8 rows is not a 25% base rate
    worth acting on."""
    if labeled.empty:
        return {"rows": 0, "positives": 0, "base_rate_pct": None, "by_year": {}}
    overall = {
        "rows": len(labeled),
        "positives": int(labeled["is_rocket"].sum()),
        "base_rate_pct": round(labeled["is_rocket"].mean() * 100, 2),
    }
    labeled = labeled.copy()
    labeled["year"] = pd.to_datetime(labeled["date"]).dt.year
    by_year = {}
    for year, g in labeled.groupby("year"):
        by_year[int(year)] = {
            "rows": len(g),
            "positives": int(g["is_rocket"].sum()),
            "base_rate_pct": round(g["is_rocket"].mean() * 100, 2),
        }
    overall["by_year"] = by_year
    return overall


def main() -> int:
    feat = bt.load_features()
    if feat.empty:
        print("no features. Run MODE=features first.")
        return 1
    codes = sorted(feat["code"].astype(str).unique())
    hist = bt.load_adjusted(codes, bt.HISTORY_YEARS)
    labeled = label_rockets(feat, hist)
    rep = base_rate_report(labeled)
    print(f"Base rate for +{ROCKET_PCT}% within {ROCKET_WINDOW_BARS} bars: "
          f"{rep['positives']}/{rep['rows']} = {rep['base_rate_pct']}%\n")
    print("By year:")
    for year, y in sorted(rep["by_year"].items()):
        print(f"  {year}: {y['positives']}/{y['rows']} = {y['base_rate_pct']}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
