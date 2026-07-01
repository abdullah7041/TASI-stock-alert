"""
TASI alert system - configuration.
No secrets here. SAHMK_API_KEY and DISCORD_WEBHOOK_URL come from environment variables.

Levels: leave a level as None until you confirm it on live data. The system only
fires a buy/sell alert when the relevant level is set. Run `python main.py --suggest`
to print live-data-based level suggestions you can paste in here.
"""

# TASI trades Sunday-Thursday, 10:00-15:00 Riyadh (UTC+3).
MARKET = "TASI"
SESSION_START_UTC = 7   # 10:00 Riyadh
SESSION_END_UTC = 12    # 15:00 Riyadh

# --- Holdings (watched for SELL / TRIM / STOP) ---
# levels in SAR. Set them once you confirm on live data.
HOLDINGS = {
    "1303": {"name": "Electrical Industries (EIC)", "shares": 104, "avg_cost": 12.41,
             "stop": None, "trim": None, "target": None},
    "2320": {"name": "Al-Babtain Power & Telecom", "shares": 12, "avg_cost": 64.26,
             "stop": None, "trim": None, "target": None},
    "8313": {"name": "Rasan", "shares": 11, "avg_cost": 107.45,
             "stop": None, "trim": None, "target": None},
}

# --- Watchlist (watched for BUY) ---
# 'symbol': None means resolve via SAHMK /companies/ by name on first run.
WATCHLIST = {
    "4015": {"name": "Jamjoom Pharma", "buy_zone": None},          # confirmed ticker
    "4016": {"name": "Avalon Pharma", "buy_zone": None},           # confirmed ticker
    "AJIL": {"name": "AJIL Financial Services", "buy_zone": None}, # resolve by name
    "NUPCO": {"name": "Nupco", "buy_zone": None},
    "NAHDI": {"name": "Nahdi Medical", "buy_zone": None},
    "JAHEZ": {"name": "Jahez International", "buy_zone": None},
    "LUMI": {"name": "Lumi Rental", "buy_zone": None},
    "SAL": {"name": "SAL Saudi Logistics Services", "buy_zone": None},
    "ALMOOSA": {"name": "Almoosa Health", "buy_zone": None},
    "FAKEEH": {"name": "Fakeeh Care Group", "buy_zone": None},
}
# buy_zone format when set: (low, high) e.g. (14.5, 15.2)

# --- Risk rule (defaults tuned for a small account; override freely) ---
RISK = {
    "deployable_cash": 3000.0,     # placeholder (you chose "under 3,000"); change to your exact cash
    "max_open_positions": 5,
    "position_pct": 0.25,          # fraction of deployable cash per new buy
    "max_single_position_pct": 0.35,  # cap of total portfolio in one name
    "stop_loss_pct": 0.09,         # default stop distance if no technical level
    "cash_buffer_pct": 0.12,       # keep this fraction uninvested
    "commission_rate": 0.00155,    # ~0.155% Saudi brokerage (round-trip ~0.31%)
    "min_commission_sar": 1.0,     # broker minimum per side
    "commission_floor_pct": 0.01,  # skip buy if round-trip commission > 1% of trade
}

# --- Regime filter thresholds ---
REGIME = {
    "index_down_day_pct": -1.5,    # suppress buys if TASI down more than this on the day
    "bearish_moods": {"Bearish", "Very Bearish"},
    "index_below_ma_days": 20,     # if history available: suppress buys when index < its N-day avg
}

# --- Technicals ---
RSI_PERIOD = 14
SR_LOOKBACK_DAYS = 20              # support/resistance window
HISTORY_DAYS = 120                # daily candles to pull when available

# --- Alerts ---
CADENCE_MINUTES = 10              # how often the GitHub Action runs during the session
