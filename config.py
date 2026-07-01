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
    {"code": "4164", "name": "Nahdi Medical",    "sector": "healthcare", "verified": False},
    {"code": "4023", "name": "Nupco",            "sector": "healthcare", "verified": False},
    {"code": "4030", "name": "SAL Logistics",    "sector": "logistics",  "verified": False},
    {"code": "4262", "name": "Lumi Rental",      "sector": "mobility",   "verified": False},
    {"code": "6015", "name": "Jahez",            "sector": "logistics",  "verified": False},
    {"code": "4014", "name": "Almoosa Health",   "sector": "healthcare", "verified": False},
    {"code": "4017", "name": "Fakeeh Care",      "sector": "healthcare", "verified": False},
    {"code": "4142", "name": "AJIL Financial",   "sector": "logistics",  "verified": False},
]

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
# The engine reports BOTH a short-term and a long-term read, each labeled with a
# confidence. Short-term on free (delayed/daily) data is lower confidence by design.
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
