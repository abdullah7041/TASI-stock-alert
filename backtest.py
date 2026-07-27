"""
Walk-forward validation harness.

Every BUY threshold in config.py was chosen by hand and has never been checked
against history. This replays the REAL decision code over years of daily bars
and scores what each signal would actually have done.

The decision functions are imported, never reimplemented. A backtest that
computes its own RSI validates different code than the one that sends you
alerts, which makes it worse than useless.

Two stages, because tuning means re-running:

    features  slow, once   -> .cache/features.csv   (indicators per code/date)
    run       fast, often  -> events                (decisions + outcomes)

No look-ahead, enforced in four places:
  1. levels come from the sliced history, never from levels.json
  2. regime comes from the index sliced to the same date
  3. entry is the NEXT bar's open, never the decision bar's close
  4. outcomes read bars strictly after the decision bar

What this cannot validate: the news criterion (historical headlines are not
retrievable, so news_score is neutralized to 0.0, which passes the gate).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd

import analyze as az
import config as cfg
import data as dat
import indicators as ind

HERE = Path(__file__).parent
CACHE = HERE / ".cache"
HIST_CACHE = CACHE / "history"
FEATURES_FILE = CACHE / "features.csv"

MAX_HOLD_BARS = 120     # ~6 months. Past this a swing thesis has failed by time.
FWD_WINDOWS = (60, 120)  # forward-return marks, in bars.
HISTORY_YEARS = 5       # enough events to tune on, recent enough to be relevant.
STEP_DAYS = 5           # weekly decisions; a 6-12 month thesis is not daily.


# --- history ----------------------------------------------------------------
def _naive_index(df: pd.DataFrame) -> pd.DataFrame:
    """Force a tz-naive DatetimeIndex.

    yfinance returns tz-aware bars, but the CSV cache may reload them naive.
    Mixing the two makes `Series.asof` raise, which _regime_at would swallow
    into 'unknown' — silently raising every BUY threshold to the breakdown bar.
    Normalizing here kills that whole class of mismatch.
    """
    if df is None or df.empty:
        return df
    idx = pd.to_datetime(df.index, utc=True, errors="coerce")
    df = df.copy()
    df.index = idx.tz_localize(None).normalize()
    return df[df.index.notna()]


def load_adjusted(codes: list, years: int = 5, progress=print) -> dict:
    """Daily OHLCV, split/dividend adjusted, cached per code as CSV.

    Deliberately NOT data.get_histories: that one is pinned to
    auto_adjust=False, which is right for a one-year live view and wrong here —
    over five years an unadjusted split looks like a 50% crash and would fire
    phantom stops.
    """
    HIST_CACHE.mkdir(parents=True, exist_ok=True)
    out, todo = {}, []

    for c in codes:
        p = HIST_CACHE / f"{c}.csv"
        if p.exists():
            try:
                df = pd.read_csv(p, index_col=0, parse_dates=True)
                out[c] = _naive_index(df) if not df.empty else pd.DataFrame()
                continue
            except Exception:
                pass
        todo.append(c)

    if not todo:
        return out

    import yfinance as yf
    period = f"{years}y"
    for i in range(0, len(todo), 100):
        chunk = todo[i:i + 100]
        symbols = {dat.yahoo_symbol(c): c for c in chunk}
        try:
            batch = yf.download(list(symbols), period=period, auto_adjust=True,
                                group_by="ticker", threads=True, progress=False)
        except Exception:
            batch = None
        for sym, code in symbols.items():
            df = pd.DataFrame()
            if batch is not None and not batch.empty:
                try:
                    part = batch[sym] if isinstance(batch.columns, pd.MultiIndex) else batch
                    df = dat._clean_ohlcv(part)
                except Exception:
                    df = pd.DataFrame()
            df = _naive_index(df)
            out[code] = df
            df.to_csv(HIST_CACHE / f"{code}.csv")   # empty file caches the miss too.
        progress(f"  history {min(i + 100, len(todo)):>5}/{len(todo)}")
    return out


# --- outcome resolution -----------------------------------------------------
def resolve_outcome(df: pd.DataFrame, t: int, stop: float | None,
                    target: float | None, max_hold: int = MAX_HOLD_BARS) -> dict:
    """What a BUY decided on bar `t` would actually have done.

    Entry is bar t+1's OPEN — you cannot decide on a close and fill at that same
    close. Resolution then scans t+1 onward.

    When one bar's Low <= stop AND High >= target, it records a STOP. Daily bars
    do not say which came first, so the pessimistic read is the honest one.

    Returns {} when there is no bar after t to enter on.
    """
    n = len(df)
    if t + 1 >= n:
        return {}

    entry = float(df["Open"].iloc[t + 1])
    if not math.isfinite(entry) or entry <= 0:
        entry = float(df["Close"].iloc[t + 1])
    if not math.isfinite(entry) or entry <= 0:
        return {}

    last = min(t + max_hold, n - 1)
    outcome, bars_held, exit_price = "timeout", last - t, float(df["Close"].iloc[last])

    for j in range(t + 1, last + 1):
        lo, hi = float(df["Low"].iloc[j]), float(df["High"].iloc[j])
        if stop is not None and lo <= stop:          # checked first: pessimistic.
            outcome, bars_held, exit_price = "stop", j - t, float(stop)
            break
        if target is not None and hi >= target:
            outcome, bars_held, exit_price = "target", j - t, float(target)
            break

    res = {
        "entry": round(entry, 4),
        "outcome": outcome,
        "bars_held": bars_held,
        "exit": round(exit_price, 4),
        "return_pct": round((exit_price - entry) / entry * 100, 2),
    }
    for w in FWD_WINDOWS:
        k = t + w
        res[f"fwd_{w}d_pct"] = round(
            (float(df["Close"].iloc[k]) - entry) / entry * 100, 2) if k < n else None
    return res


# --- regime as-of any date --------------------------------------------------
def regime_series(index_df: pd.DataFrame, index_ma: int) -> pd.Series:
    """Regime label for every index bar, computed from that bar's history only.

    Precomputed once so a per-decision lookup is an .asof(), not a rescan.
    """
    if index_df is None or index_df.empty:
        return pd.Series(dtype="object")
    labels = [az.market_regime(index_df.iloc[:i + 1], index_ma)
              for i in range(len(index_df))]
    return pd.Series(labels, index=index_df.index)


def _regime_at(regimes: pd.Series, when) -> str:
    """Regime as of `when`, using only bars at or before it.

    No blanket except here on purpose: swallowing an error would return
    'unknown' for every date, which quietly raises the BUY bar to the breakdown
    cutoff and looks like a market call rather than a bug. Timestamps are
    normalized instead, so the mismatch that would raise cannot occur.
    """
    if regimes.empty:
        return "unknown"
    when = pd.Timestamp(when)
    if when.tzinfo is not None:
        when = when.tz_localize(None)
    val = regimes.asof(when.normalize())
    return val if isinstance(val, str) else "unknown"


# --- stage 1: features ------------------------------------------------------
FEATURE_COLS = ["code", "date", "t", "price", "trend", "rsi", "momentum_pct",
                "buy_zone_low", "buy_zone_high", "atr", "stop", "target",
                "distance_to_zone_pct", "regime"]


def build_features(hist: dict, index_df: pd.DataFrame, step_days: int = 5,
                   progress=print, checkpoint_every: int = 0,
                   done_codes: set | None = None) -> pd.DataFrame:
    """Indicators + derived levels for every (code, decision date).

    Expanding window: each row sees df.iloc[:t+1] and nothing after. Weekly step
    by default — a 6-12 month swing thesis does not change day to day, and it
    cuts the run 5x.

    Slow on purpose. It calls the same indicator functions production calls,
    which rebuild a Series per call. Vectorizing means reimplementing them and
    forfeiting the only reason to trust these numbers.

    `checkpoint_every=0` (the default) keeps this a pure function that touches
    no disk — tests call it with synthetic names, and a default of writing would
    inject those into the real feature cache. Callers that want resumability
    pass a positive value.
    """
    regimes = regime_series(index_df, cfg.REGIME["index_ma"])
    min_bars = cfg.TECH["min_history_bars"]
    stop_pct = cfg.RISK["stop_loss_pct"]
    lookback = cfg.HORIZON["long_lookback_days"]
    short_ma, long_ma = cfg.HORIZON["short_ma"], cfg.HORIZON["long_ma"]

    done_codes = done_codes or set()
    rows = []
    for n, (code, df) in enumerate(hist.items(), 1):
        if str(code) in done_codes:
            continue                    # already in the checkpoint from a prior run.
        if df is None or df.empty or len(df) < min_bars:
            continue
        for t in range(min_bars - 1, len(df), step_days):
            window = df.iloc[:t + 1]
            long = ind.long_term_read(window, lookback, short_ma, long_ma)
            lv = az.derive_levels(window, cfg.TECH, stop_pct, cfg.LEVELS)
            price = float(window["Close"].iloc[-1])
            low = lv.get("buy_zone_low")
            ref = low if low is not None else price
            dist = (price - ref) / ref * 100 if ref else float("nan")
            rows.append({
                "code": code,
                "date": window.index[-1],
                "t": t,
                "price": round(price, 4),
                "trend": long.get("trend"),
                "rsi": long.get("rsi"),
                "momentum_pct": long.get("momentum_pct"),
                "buy_zone_low": low,
                "buy_zone_high": lv.get("buy_zone_high"),
                "atr": lv.get("atr"),      # cached so multiplier sweeps are cheap.
                "stop": lv.get("stop"),
                "target": lv.get("target"),
                "distance_to_zone_pct": round(dist, 2) if not np.isnan(dist) else None,
                "regime": _regime_at(regimes, window.index[-1]),
            })
        if checkpoint_every and n % checkpoint_every == 0:
            # This loop is O(bars^2) per name and can outlive a shell timeout.
            # Partial results on disk make a re-run resume, not restart.
            _append_checkpoint(rows)
            rows = []
            progress(f"  features {n}/{len(hist)} codes checkpointed")

    if not checkpoint_every:
        return pd.DataFrame(rows, columns=FEATURE_COLS)
    _append_checkpoint(rows)
    return load_features()


def _append_checkpoint(rows: list) -> None:
    if not rows:
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=FEATURE_COLS)
    df.to_csv(FEATURES_FILE, mode="a", index=False,
              header=not FEATURES_FILE.exists())


def checkpointed_codes() -> set:
    """Codes already present in the feature cache, so a resumed build skips them."""
    if not FEATURES_FILE.exists():
        return set()
    try:
        return set(pd.read_csv(FEATURES_FILE, usecols=["code"])["code"].astype(str))
    except Exception:
        return set()


def save_features(feat: pd.DataFrame) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    feat.to_csv(FEATURES_FILE, index=False)


def load_features() -> pd.DataFrame:
    """Read the feature cache back.

    `code` is forced to str: Tadawul codes are all digits, so pandas infers
    int64 on the CSV round-trip, and every `hist` dict is keyed by str. The
    mismatch would make run() skip every name and report zero events — which
    looks exactly like the honest finding "the BUY rules never fire".
    """
    if not FEATURES_FILE.exists():
        return pd.DataFrame(columns=FEATURE_COLS)
    feat = pd.read_csv(FEATURES_FILE, parse_dates=["date"])
    if "code" in feat:
        feat["code"] = feat["code"].astype(str)
    return feat


# --- stage 2: replay --------------------------------------------------------
def _row_to_long_read(row) -> dict:
    """Rebuild the long_term_read dict buy_decision expects from a feature row."""
    return {
        "horizon": "long",
        "trend": row["trend"],
        "rsi": float(row["rsi"]) if pd.notna(row["rsi"]) else float("nan"),
        "momentum_pct": float(row["momentum_pct"]) if pd.notna(row["momentum_pct"])
        else float("nan"),
    }


def run(features: pd.DataFrame, hist: dict, criteria: dict | None = None,
        max_hold: int = MAX_HOLD_BARS,
        levels_cfg: dict | None = None) -> pd.DataFrame:
    """Replay BUY decisions and resolve each into a trade.

    One open position per name. A qualifying setup stays true for weeks, so a
    naive replay would emit a fresh 'trade' every step with overlapping forward
    windows — autocorrelated pseudo-trades that inflate both the event count and
    the win rate. Once a trade opens on a name, every bar is skipped until it
    closes.
    """
    criteria = criteria or cfg.BUY_CRITERIA
    if features.empty:
        return pd.DataFrame()

    events = []
    missing = 0
    for code, grp in features.groupby("code", sort=False):
        df = hist.get(code)
        if df is None:
            df = hist.get(str(code))    # survive an int64 code column.
        if df is None or df.empty:
            missing += 1
            continue
        open_until = -1
        for _, row in grp.sort_values("t").iterrows():
            t = int(row["t"])
            if t <= open_until:
                continue                      # position still open on this name.
            is_buy, _ = az.buy_decision(_row_to_long_read(row), criteria)
            if not is_buy:
                continue

            stop = row["stop"] if pd.notna(row["stop"]) else None
            target = row["target"] if pd.notna(row["target"]) else None
            if levels_cfg is not None and "atr" in row and pd.notna(row.get("atr")):
                # Re-place the levels from the cached ATR via the same function
                # production uses, so multipliers can be swept without a rebuild.
                lv = az.levels_from_atr(float(row["price"]), float(row["atr"]),
                                        cfg.RISK["stop_loss_pct"], levels_cfg)
                stop, target = lv.get("stop", stop), lv.get("target", target)

            res = resolve_outcome(df, t, stop, target, max_hold)
            if not res:
                continue
            open_until = t + res["bars_held"]
            events.append({"code": str(code), "date": row["date"], "t": t,
                           "regime": row["regime"],
                           "rsi": row["rsi"], "trend": row["trend"], **res})

    if missing and not events:
        print(f"WARNING: no history matched any of the {missing} codes in the "
              f"feature table. That is a plumbing failure, not a finding — "
              f"zero events here does NOT mean the BUY rules never fire.")
    return pd.DataFrame(events)


# --- metrics ----------------------------------------------------------------
def baseline_returns(events: pd.DataFrame, index_df: pd.DataFrame) -> float:
    """Mean TASI return over each event's own holding window.

    An edge only counts relative to doing nothing: a 55% win rate is not skill
    if the index rose through the same period.
    """
    if events.empty or index_df is None or index_df.empty:
        return float("nan")
    closes = index_df["Close"]
    rets = []
    for _, e in events.iterrows():
        try:
            start = closes.asof(pd.Timestamp(e["date"]))
            pos = closes.index.searchsorted(pd.Timestamp(e["date"]))
            end_pos = min(pos + int(e["bars_held"]), len(closes) - 1)
            end = float(closes.iloc[end_pos])
        except Exception:
            continue
        if start and math.isfinite(start) and start > 0:
            rets.append((end - float(start)) / float(start) * 100)
    return float(np.mean(rets)) if rets else float("nan")


def report(events: pd.DataFrame, index_df: pd.DataFrame | None = None) -> dict:
    """Headline stats. Expectancy leads because it is the only one computed over
    every event; win rate over target-vs-stop alone would describe a fraction of
    the trades and hide the rest in 'timeout'."""
    if events.empty:
        return {"events": 0}

    r = events["return_pct"].astype(float)
    wins, losses = r[r > 0], r[r <= 0]
    counts = events["outcome"].value_counts().to_dict()
    n = len(events)

    out = {
        "events": n,
        "expectancy_pct": round(float(r.mean()), 2),
        "median_return_pct": round(float(r.median()), 2),
        "win_rate_pct": round(len(wins) / n * 100, 1),
        "avg_win_pct": round(float(wins.mean()), 2) if len(wins) else None,
        "avg_loss_pct": round(float(losses.mean()), 2) if len(losses) else None,
        "payoff_ratio": round(float(wins.mean() / abs(losses.mean())), 2)
        if len(wins) and len(losses) and losses.mean() != 0 else None,
        "hit_target_pct": round(counts.get("target", 0) / n * 100, 1),
        "hit_stop_pct": round(counts.get("stop", 0) / n * 100, 1),
        "timeout_pct": round(counts.get("timeout", 0) / n * 100, 1),
        "median_bars_held": int(events["bars_held"].median()),
        "names_traded": int(events["code"].nunique()),
    }
    for w in FWD_WINDOWS:
        col = f"fwd_{w}d_pct"
        vals = pd.to_numeric(events[col], errors="coerce").dropna()
        out[f"fwd_{w}d_mean_pct"] = round(float(vals.mean()), 2) if len(vals) else None
    if index_df is not None:
        out["tasi_baseline_pct"] = round(baseline_returns(events, index_df), 2)
        if out.get("tasi_baseline_pct") is not None and \
                math.isfinite(out["tasi_baseline_pct"]):
            out["edge_vs_baseline_pct"] = round(
                out["expectancy_pct"] - out["tasi_baseline_pct"], 2)
    return out


def check_no_overlap(events: pd.DataFrame) -> list:
    """Every event on a name must close before the next one opens.

    This is the first sanity gate, not the last: overlapping events inflate the
    event count AND the win rate, so they would make the other gates pass while
    the numbers are contaminated.
    """
    bad = []
    if events.empty:
        return bad
    for code, grp in events.groupby("code"):
        g = grp.sort_values("t")
        prev_end = -1
        for _, e in g.iterrows():
            if int(e["t"]) <= prev_end:
                bad.append((code, int(e["t"]), prev_end))
            prev_end = int(e["t"]) + int(e["bars_held"])
    return bad


# --- threshold sweep --------------------------------------------------------
DEFAULT_GRID = {
    "rsi_recovery_band": [(25, 60), (30, 60), (25, 70), (35, 65), (0, 100)],
    "long_mom_floor_pct": [-15.0, -10.0, -5.0, 0.0, 5.0],
}


def sweep(features: pd.DataFrame, hist: dict, index_df=None,
          grid: dict | None = None, base: dict | None = None) -> pd.DataFrame:
    """Grid over the surviving BUY thresholds. Event count sits beside every row
    — a three-trade cell with a 100% win rate is noise, and the table must make
    that obvious rather than sorting it to the top.

    Two axes, not three: the conviction_min axis is gone with conviction.
    """
    grid = grid or DEFAULT_GRID
    base = dict(base or cfg.BUY_CRITERIA)
    rows = []
    for band in grid["rsi_recovery_band"]:
        for floor in grid["long_mom_floor_pct"]:
            crit = {**base, "rsi_recovery_band": band, "long_mom_floor_pct": floor}
            ev = run(features, hist, crit)
            rep = report(ev, index_df)
            # Defaults first, so an all-zero-event grid still has the
            # columns to sort on instead of raising a confusing KeyError.
            rows.append({"rsi_band": f"{band[0]}-{band[1]}",
                         "mom_floor": floor, "events": 0, "expectancy_pct": None,
                         "win_rate_pct": None, "timeout_pct": None, **rep})
    return pd.DataFrame(rows).sort_values("expectancy_pct", ascending=False,
                                          na_position="last")


LEVEL_GRID = {
    "atr_stop_mult":   [1.0, 1.5, 2.0, 2.5, 3.0],
    "atr_target_mult": [2.0, 3.0, 4.0, 5.0, 6.0],
}


def sweep_levels(features: pd.DataFrame, hist: dict, index_df=None,
                 grid: dict | None = None) -> pd.DataFrame:
    """Grid over the ATR stop/target multipliers.

    Cheap because the ATR is cached per feature row — only the arithmetic that
    turns it into levels is re-run, using the same function production calls.
    """
    grid = grid or LEVEL_GRID
    base = dict(cfg.LEVELS)
    rows = []
    for s in grid["atr_stop_mult"]:
        for tg in grid["atr_target_mult"]:
            lc = {**base, "atr_stop_mult": s, "atr_target_mult": tg}
            ev = run(features, hist, levels_cfg=lc)
            rep = report(ev, index_df)
            rows.append({"stop_atr": s, "target_atr": tg, "rr": round(tg / s, 2),
                         "events": 0, "expectancy_pct": None, "win_rate_pct": None,
                         "payoff_ratio": None, **rep})
    return pd.DataFrame(rows).sort_values("expectancy_pct", ascending=False,
                                          na_position="last")
