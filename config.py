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
# avg_cost: your average cost per share (SAR)
HOLDINGS = [
    {"code": "1303", "name": "EIC",          "shares": 104, "avg_cost": 12.41},
    {"code": "2320", "name": "Al-Babtain",   "shares": 12,  "avg_cost": 64.26},
    {"code": "8313", "name": "Rasan",        "shares": 11,  "avg_cost": 107.45},
]

# --- Watchlist (names you might buy) ---------------------------------------
# verified=False means the code is a best-guess and must be confirmed on first
# run (symbol resolution writes the confirmed code to symbols.json).
WATCHLIST = [
    {"code": "4015", "name": "Jamjoom Pharma",   "sector": "pharma",     "verified": True},
    {"code": "4016", "name": "Avalon Pharma",    "sector": "pharma",     "verified": True},
    {"code": "4164", "name": "Nahdi Medical",    "sector": "healthcare", "verified": True},
    {"code": "4262", "name": "Lumi Rental",      "sector": "mobility",   "verified": True},
    {"code": "4017", "name": "Fakeeh Care",      "sector": "healthcare", "verified": True},
    # Codes corrected 2026-07-20 (old codes pointed at the wrong company; each
    # new code confirmed against the data source's company name):
    {"code": "6017", "name": "Jahez",            "sector": "logistics",  "verified": True},   # was 6015 (=Americana Restaurants)
    {"code": "4263", "name": "SAL Logistics",    "sector": "logistics",  "verified": True},   # was 4030 (=Bahri/National Shipping)
    {"code": "4018", "name": "Almoosa Health",   "sector": "healthcare", "verified": True},   # was 4014 (=Scientific & Medical Equip. House)
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

# --- Risk rules (small account, balanced) ----------------------------------
# Every number here is yours to change. The engine reads these, no magic constants.
RISK = {
    "deployable_cash":   3000.0,   # SET THIS to your real deployable cash (SAR).
    "max_positions":     5,        # max concurrent open names.
    "position_pct":      0.25,     # target size per new buy, fraction of deployable cash.
    "stop_loss_pct":     0.09,     # stop distance below entry (technical invalidation cap).
    "max_single_pct":    0.35,     # no single name above this fraction of portfolio.
    "cash_buffer_pct":   0.12,     # keep this fraction uninvested (dry powder).
    "commission_rate":   0.00155,  # Tadawul round-trip ~0.155% (buy+sell). Adjust to your broker.
    "min_commission":    0.0,      # some brokers have a floor; set if yours does.
    "commission_floor_pct": 0.01,  # skip a buy if round-trip commission > 1% of trade value.
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

# --- Market regime (index breakdown filter) --------------------------------
# When TASI itself is breaking down, suppress BUY signals.
REGIME = {
    "index_code":   "^TASI.SR",  # Yahoo symbol for the TASI index.
    "index_ma":     50,          # index below this MA + falling => breakdown.
}

# --- Fallback levels (used only until levels.json exists) -------------------
# You should not need to touch these. autolevels mode fills levels.json.
FALLBACK_LEVELS = {
    # "1303": {"stop": 11.0, "trim": 14.5, "target": 16.0},
}
