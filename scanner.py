"""
Breakout scanner (Stage F). Live equivalent of research/lift_analysis.py's
feature computation, scored against the two empirically-measured base rates
(27.97% max-High touch, 12.85% close-to-close -- see docs/scanner-findings-
2026-07-30.md) rather than presented as a bare rank.

Two conditions, each worth one point (0-2 total):
  1. rel_strength: 60-day return vs the TASI index's 60-day return, >=
     SCANNER["rel_strength_threshold_pct"].
  2. squeeze: ONLY evaluated when volatility_pct is at or below
     SCANNER["vol_high_cutoff_pct"] -- above that cutoff the condition is
     simply False, never true, no partial credit. Within the low-vol regime,
     true when atr_squeeze_pctile <= SCANNER["squeeze_pctile_cutoff"].

Liquidity floor is applied first: codes below it never enter the ranking at
all (not scored, not returned, regardless of how the two conditions would
have landed).

Run standalone: `python scanner.py` (matches research/base_rate.py's own
convention). Fail-soft digest wiring is a later task (Task 6) -- scan(),
resolve_names(), and main() here let exceptions propagate.
"""

from __future__ import annotations

import pandas as pd

import config as cfg
from scanner_features import code_feature_series


def _scan_all(codes: list, hist: dict, index_df) -> list[dict]:
    """All codes with enough history AND passing the liquidity floor, scored
    (unfiltered by conditions_met, unsorted, uncapped). Shared by scan()
    (which filters to conditions_met >= 1, sorts, and caps at top_n) and by
    main() (which needs the liquidity-floor pass count on its own, before
    that filtering happens) so the scoring logic -- the condition-2 scoping
    in particular -- lives in exactly one place.
    """
    s = cfg.SCANNER
    index_ret60 = None
    if index_df is not None and not index_df.empty:
        index_ret60 = code_feature_series(index_df)["ret_60d"]
        # data.get_histories_adjusted's batch path returns a tz-naive index,
        # but its per-symbol fallback (used when Yahoo's batch call drops a
        # symbol -- which it did for ^TASI.SR in a live run) returns a
        # tz-aware one (Asia/Riyadh). A code on one path and the index on the
        # other makes .asof() raise ("Cannot compare tz-naive and tz-aware
        # timestamps"). Normalize to tz-naive here, once, since that's the
        # cheapest point to guarantee alignment regardless of which path any
        # given code came from. tz_localize(None) on daily bars already at
        # midnight local time is a wall-clock no-op, not a date shift.
        if index_ret60.index.tz is not None:
            index_ret60 = index_ret60.tz_localize(None)

    out = []
    for code in codes:
        df = hist.get(code)
        if df is None or len(df) < s["min_history_bars"]:
            continue

        feat = code_feature_series(df)
        last = feat.iloc[-1]
        date = feat.index[-1]
        if getattr(date, "tzinfo", None) is not None:
            date = date.tz_localize(None)

        liquidity_sar = last["liquidity_sar"]
        if not (pd.notna(liquidity_sar) and liquidity_sar >= s["liquidity_floor_sar"]):
            continue  # dropped entirely -- never scored, per the brief.

        rel_strength = None
        if index_ret60 is not None and not index_ret60.empty:
            idx_ret60 = index_ret60.asof(date)
            if pd.notna(idx_ret60) and pd.notna(last["ret_60d"]):
                rel_strength = last["ret_60d"] - idx_ret60

        rel_strength_met = bool(
            rel_strength is not None
            and rel_strength >= s["rel_strength_threshold_pct"]
        )

        volatility_pct = last["volatility_pct"]
        atr_squeeze_pctile = last["atr_squeeze_pctile"]
        # Condition 2 is only ever evaluated in the low-vol regime. Above the
        # cutoff it is False -- not skipped, not None, just False -- so it
        # never contributes to conditions_met.
        squeeze_met = False
        if pd.notna(volatility_pct) and volatility_pct <= s["vol_high_cutoff_pct"]:
            squeeze_met = bool(
                pd.notna(atr_squeeze_pctile)
                and atr_squeeze_pctile <= s["squeeze_pctile_cutoff"]
            )

        conditions_met = int(rel_strength_met) + int(squeeze_met)

        out.append({
            "code": code,
            "price": float(df["Close"].iloc[-1]),
            "conditions_met": conditions_met,
            "rel_strength": rel_strength,
            "rel_strength_met": rel_strength_met,
            "volatility_pct": volatility_pct,
            "atr_squeeze_pctile": atr_squeeze_pctile,
            "squeeze_met": squeeze_met,
            "liquidity_sar": liquidity_sar,
        })
    return out


def _rank(rows: list) -> list[dict]:
    """Filter to conditions_met >= 1, sort by conditions_met desc then
    rel_strength desc, cap at SCANNER["top_n"]. Split out of scan() so
    main() can call _scan_all() once, use the raw rows for its liquidity-
    floor count, and rank the same rows here -- instead of scanning twice."""
    s = cfg.SCANNER
    candidates = [c for c in rows if c["conditions_met"] >= 1]
    candidates.sort(
        key=lambda c: (c["conditions_met"],
                       c["rel_strength"] if c["rel_strength"] is not None else float("-inf")),
        reverse=True,
    )
    return candidates[: s["top_n"]]


def scan(codes: list, hist: dict, index_df) -> list[dict]:
    """Score each code's latest bar, filter to conditions_met >= 1, sort by
    conditions_met desc then rel_strength desc, cap at SCANNER["top_n"].

    hist: {code: OHLCV DataFrame}, as returned by data.get_histories_adjusted.
    index_df: the TASI index's own OHLCV DataFrame (same shape), used to
    compute rel_strength via an as-of lookup on its ret_60d series.
    """
    return _rank(_scan_all(codes, hist, index_df))


def resolve_names(candidates: list) -> dict:
    """{code: display name} for only the codes in the final candidate list --
    data._yahoo_name is a per-code network call, so this must never run
    against the full ~265-code universe."""
    import data
    names = {}
    for c in candidates:
        code = c["code"]
        try:
            name = data._yahoo_name(code)
        except Exception:
            name = ""
        names[code] = name or code
    return names


def _condition_text(c: dict) -> str:
    parts = []
    if c["rel_strength_met"]:
        parts.append(f"rel_strength {c['rel_strength']:+.1f}% vs index")
    if c["squeeze_met"]:
        parts.append(f"ATR squeeze, {c['atr_squeeze_pctile'] * 100:.0f}th percentile "
                     f"(vol {c['volatility_pct']:.2f}%)")
    return "; ".join(parts) if parts else "no condition fired"


def main() -> int:
    import universe

    codes = universe.load()
    if not codes:
        print("universe.json missing — run MODE=universe first (see main.py) "
              "to build a scannable Tadawul code list.")
        return 1

    import data
    s = cfg.SCANNER
    index_code = cfg.REGIME["index_code"]
    print(f"loading {len(codes)} histories (adjusted, {s['history_period']})")
    hist = data.get_histories_adjusted(codes + [index_code], s["history_period"])
    index_df = hist.get(index_code)
    if index_df is None or index_df.empty:
        print(f"WARNING: no data for the index ({index_code}) this run -- "
              f"rel_strength cannot be computed, so only the squeeze "
              f"condition can fire for any candidate below.")

    enough_history = [c for c in codes if len(hist.get(c, pd.DataFrame())) >= s["min_history_bars"]]
    print(f"{len(enough_history)}/{len(codes)} codes have >= {s['min_history_bars']} bars of history")

    scored = _scan_all(codes, hist, index_df)
    print(f"{len(scored)}/{len(enough_history)} codes pass the liquidity floor "
          f"({s['liquidity_floor_sar']:,} SAR median 60-bar turnover)")

    print("\n=== Base rates these candidates are measured against "
          "(docs/scanner-findings-2026-07-30.md) ===")
    print("max-High touch (any intraday touch of +15% within 60 bars): 27.97%")
    print("close-to-close (+15% still held at the 60-bar mark):         12.85%")

    candidates = _rank(scored)
    names = resolve_names(candidates)

    print(f"\n=== Breakout scanner: {len(candidates)} candidate(s) "
          f"(top {s['top_n']}) ===")
    if not candidates:
        print("no candidates today")
        return 0

    for c in candidates:
        name = names.get(c["code"], c["code"])
        print(f"{c['code']} ({name}): {c['price']:.2f} SAR, "
              f"{c['conditions_met']}/2 conditions — {_condition_text(c)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
