"""
Static configuration for the TASI recommender.

Edit these values. Nothing here needs code changes to run.
Price levels are NOT set by hand here — they are auto-derived (see main.py
autolevels mode) into levels.json, which you review. The `stop`/`target`/`buy_zone`
values below are only a fallback used until levels.json exists.
"""

# --- Your holdings (positions you already own) -----------------------------
# code   : Tadawul 4-digit code (string)
# name   : for readability in alerts
# shares : how many you hold
# avg_cost: your average cost per share (SAR). Required: without it the digest
#           cannot compute P/L and the cockpit snapshot flags it as unknown.
# match_names: optional. disclosures.py filters Argaam's feed by substring on
#              this name; a few short config names never appear in real filing
#              titles, which use the full legal name instead. Only names
#              confirmed missing real matches get an override — everything
#              else matches fine on `name` alone. See match_names note below
#              HOLDINGS/WATCHLIST for how these were confirmed.
HOLDINGS = [
    {"code": "1303", "name": "EIC",          "shares": 104, "avg_cost": 12.41,
     "match_names": ["EIC", "Electrical Industries"]},
    {"code": "2320", "name": "Al-Babtain",   "shares": 12,  "avg_cost": 64.26,
     "match_names": ["Al-Babtain", "Al Babtain"]},
    {"code": "8313", "name": "Rasan",        "shares": 11,  "avg_cost": 107.45},
]

# --- Watchlist (names you might buy) ---------------------------------------
# verified=False means the code is a best-guess and must be confirmed on first
# run (symbol resolution writes the confirmed code to symbols.json).
#
# match_names below were confirmed against real archived headlines
# (news_archive.jsonl) and live digest runs, not guessed:
#   - EIC: real coverage says "Electrical Industries Company" / "Electrical
#     Industries Co.", never the bare initialism "EIC".
#   - Al-Babtain: Argaam's own titles drop the hyphen ("Al Babtain").
#   - Avalon Pharma: its actual Tadawul-registered legal name is "Middle East
#     Pharmaceutical Industries Company" — "Avalon Pharma" is the brand name,
#     confirmed via live headline: "...Middle East Pharmaceutical Industries
#     Company – TADAWUL:4016".
#   - SAL Logistics: legal name is "SAL Saudi Logistics Services Company" —
#     "SAL Logistics" is not a contiguous substring of it ("Saudi" sits
#     between "SAL" and "Logistics"), confirmed via live headline.
#   - Fakeeh Care: real coverage uses "Dr. Soliman Abdul Kader Fakeeh
#     Hospital Co." / "...Abdel Kader Fakeeh Hospital Company" — "Fakeeh
#     Care" never appears at all in real headlines for this code.
#   - Almoosa Health: no confirmed alternate legal name text was available
#     when this was added; "Al Moosa Health" (space variant) is included as
#     a low-risk spacing guess, not a confirmed real-world form — revisit if
#     disclosures keep showing "none found" for this code.
WATCHLIST = [
    {"code": "4015", "name": "Jamjoom Pharma",   "sector": "pharma",     "verified": True},
    {"code": "4016", "name": "Avalon Pharma",    "sector": "pharma",     "verified": True,
     "match_names": ["Avalon Pharma", "Middle East Pharmaceutical Industries"]},
    {"code": "4164", "name": "Nahdi Medical",    "sector": "healthcare", "verified": True},
    {"code": "4262", "name": "Lumi Rental",      "sector": "mobility",   "verified": True},
    {"code": "4017", "name": "Fakeeh Care",      "sector": "healthcare", "verified": True,
     "match_names": ["Fakeeh Care", "Fakeeh Hospital", "Soliman Abdul Kader Fakeeh",
                     "Soliman Abdel Kader Fakeeh"]},
    # Codes corrected 2026-07-20 (old codes pointed at the wrong company; each
    # new code confirmed against the data source's company name):
    {"code": "6017", "name": "Jahez",            "sector": "logistics",  "verified": True},   # was 6015 (=Americana Restaurants)
    {"code": "4263", "name": "SAL Logistics",    "sector": "logistics",  "verified": True,    # was 4030 (=Bahri/National Shipping)
     "match_names": ["SAL Logistics", "SAL Saudi Logistics", "Saudi Logistics Services"]},
    {"code": "4018", "name": "Almoosa Health",   "sector": "healthcare", "verified": True,    # was 4014 (=Scientific & Medical Equip. House)
     "match_names": ["Almoosa Health", "Al Moosa Health", "Almoosa"]},
    # Removed 2026-07-20 — not publicly traded on Tadawul (no ticker):
    #   4142 "AJIL Financial"  -> AJIL is a closed joint-stock company (Argaam ticker 0).
    #   4023 "Nupco"           -> National Unified Procurement not listed (Argaam ticker 0).
]

# --- Monthly buy budget -----------------------------------------------------
# Hard cap on recommended NEW-buy spend per calendar month. The engine tracks
# what it has already recommended this month in budget_state.json and only
# allocates from the remainder. Edit that file if you skipped a recommended buy.
BUDGET = {
    "monthly_budget_sar": 500.0,
}

# --- BUY criteria ------------------------------------------------------------
# A watchlist name becomes BUY only when ALL THREE hold (enforced in one place:
# analyze.buy_decision, which reports every rule, passed or not):
#   1. RSI inside rsi_recovery_band — recovering, not capitulating, not chasing.
#   2. long-term trend == 'up'.
#   3. long-term momentum >= long_mom_floor_pct.
# There is no conviction score and no regime-raised bar: conviction backtested
# INVERTED against forward return and was deleted rather than tuned (see
# docs/backtest-findings-2026-07-23.md). There is no news rule either — news
# has never been validated against outcomes, so it is shown as context and
# gates nothing.
BUY_CRITERIA = {
    "rsi_recovery_band":        (25, 60),
    "long_mom_floor_pct":       -5.0,
}

# --- Level placement (ATR from entry) ---------------------------------------
# The 2026-07-23 backtest found the old support/resistance levels produced a
# median reward:risk of 0.12 — 1.3% of upside against 10.5% of risk — because
# stop and target were referenced to support/resistance while the entry happened
# wherever price was. A 72% win rate still lost money on that arithmetic.
#
# Levels are now placed a volatility-scaled distance from the entry price, so
# reward:risk is fixed by construction: atr_target_mult / atr_stop_mult.
# See docs/backtest-findings-2026-07-23.md.
LEVELS = {
    "atr_period":       14,
    "atr_stop_mult":    1.5,   # stop this many ATRs below entry.
    "atr_target_mult":  3.0,   # target this many ATRs above entry => R:R 2.0.
    "atr_trim_frac":    0.6,   # take partial profit 60% of the way to target.
}

# --- Risk rules (small account) ---------------------------------------------
# Only what the engine actually reads. Seven further keys (deployable_cash,
# position_pct, max_single_pct, cash_buffer_pct, commission_rate,
# min_commission, commission_floor_pct) were removed on 2026-08-10: they had
# never been read by any code path, while README.md described them as live
# behavior — a configured cap that does not exist is worse than no cap, because
# it stops you looking. Position sizing is equal-weight from BUDGET, in
# analyze.allocate_budget. Re-adding any of them means implementing and
# measuring it first, the same bar conviction failed to clear (see
# docs/backtest-findings-2026-07-23.md).
RISK = {
    "max_positions":     5,        # max concurrent open names (analyze.allocate_budget).
    "stop_loss_pct":     0.09,     # stop distance cap below entry (analyze.derive_levels).
}

# --- Horizons --------------------------------------------------------------
# The engine reports BOTH a short-term and a long-term read; neither carries a
# confidence label. Short-term on free (delayed/daily) data is inherently noisier
# than the long-term read, by design.
HORIZON = {
    "short_lookback_days": 10,     # recent momentum window.
    "long_lookback_days":  120,    # swing / trend window (~6 months of trading days).
    "short_ma": 20,
    "long_ma":  50,
}

# --- Technical thresholds --------------------------------------------------
TECH = {
    "rsi_period":      14,
    "rsi_overbought":  70,
    "rsi_oversold":    30,
    "sr_lookback":     60,     # bars to scan for swing highs/lows.
    "history_period":  "1y",   # how much daily history to pull.
    "min_history_bars": 40,    # skip scoring a name with less history than this.
}

# --- Market regime (context label, not a filter) ----------------------------
# Computed once per run and shown in the digest header. It suppresses nothing:
# BUY is decided by BUY_CRITERIA above, per name, with no market-wide gate. The
# regime fed the conviction cutoff until conviction was deleted (see
# docs/backtest-findings-2026-07-23.md); the label was kept, the gate was not.
REGIME = {
    "index_code":   "^TASI.SR",  # Yahoo symbol for the TASI index.
    "index_ma":     50,          # index below this MA + falling => breakdown.
}

# --- Breakout scanner (empirically derived thresholds) -------------------------
# Per docs/scanner-findings-2026-07-30.md: rel_strength survives all checks
# (1.46x lift); atr_squeeze usable on non-high-vol names; vol_surge and
# dist_52w_high fail. Thresholds tuned over 2021-2026 daily OHLCV data.
SCANNER = {
    "rel_strength_threshold_pct": 15.0,    # top decile shows 1.46x lift (27.97% base rate).
    "vol_high_cutoff_pct":        2.9,     # ATR/price*100 above this: squeeze condition doesn't apply.
    "squeeze_pctile_cutoff":      0.2,     # bottom quintile of trailing 126-bar own range.
    "liquidity_floor_sar":        50_000,  # median 60-bar dollar turnover; excludes ~8% of rows.
    "min_history_bars":           130,     # 126-bar squeeze window + buffer.
    "history_period":             "1y",    # lookback for feature calculations.
    "top_n":                      10,      # return top N candidates ranked by conditions.
}

# --- Fallback levels (used only until levels.json exists) -------------------
# You should not need to touch these. autolevels mode fills levels.json.
FALLBACK_LEVELS = {
    # "1303": {"stop": 11.0, "trim": 14.5, "target": 16.0},
}
