# TASI Alert System - Handoff (paste into a new chat)

## What this is
A personal automation that watches my TASI holdings and a watchlist during the trading session (Sunday-Thursday, 10:00-14:55 Riyadh) and pushes buy/sell/hold recommendations to Discord. Runs server-side so my laptop stays off. Personal tool first; possible product later. Files live in Cowork/OUTPUTS/tasi-alert-system/ (SPEC.md, WATCHLIST-RESEARCH.md, README.md, and the code).

## Locked decisions
- Data source: SAHMK (Tadawul-licensed REST API). Free = 15-min delayed, no history, 100 req/day. Starter (149 SAR/mo) = realtime + history. Pro (499) = AI news + server-side webhooks + WebSocket. Verified: webhooks/event-rules/WebSocket are Pro+ only (the marketing page wrongly lists them on every tier).
- Architecture: GitHub Actions cron (free, no laptop) -> Python -> Discord webhook.
- In v0: action + levels, position sizing from cash, technical read (RSI, support/resistance), market-regime filter, conviction score (0-100). Dropped: news + prediction. Deferred: concentration guard (phase 2), backtest (one-time pre-launch check).
- Watchlist: 10 mid/small-cap growth names (Jamjoom Pharma 4015, Avalon Pharma 4016, AJIL, Nupco, Nahdi, Jahez, Lumi Rental, SAL Logistics, Almoosa Health, Fakeeh Care). Tickers except 4015/4016 need SAHMK verification.
- Holdings tracked as positions: 1303 EIC (104 sh @ 12.41), 2320 Al-Babtain (12 @ 64.26), 8313 Rasan (11 @ 107.45).
- Risk defaults (balanced, small account): max 4-5 positions, 20-30% per buy, stop ~9%, max 35% single name, 10-15% cash buffer, commission floor that skips lots too small to be worth fees. Deployable cash placeholder 3,000 SAR (set exact).
- Levels are auto-derived (I approve), not hand-set. `autolevels` mode proposes buy zones near support and holding stops/targets from technicals into levels.json.

## What is built and tested
Python code: config.py, sahmk.py, analyze.py, notify.py, main.py, plus tests, GitHub Actions workflow, README. 17 unit tests pass (RSI, regime filter, conviction, position sizing, level derivation). Workflow YAML valid. Actions bumped to Node 24 (checkout@v5, setup-python@v6).

## Current live state
- Repo pushed to GitHub (private): abdullah7041/TASI-stock-alert.
- Secrets set via gh CLI. Heartbeat test succeeded: Discord received "TASI alert system is alive and watching." That message is expected from heartbeat mode; it does not check prices.
- No real alerts yet because no levels are set, and on Free tier there is no history to auto-derive them.

## Open strategic question (where we paused)
I don't want to pay 149/mo just for the personal tool, and I raised building a real product with realtime data. Key conclusions from that discussion:
- An AI model API key does NOT provide realtime market data. LLMs generate text, not price feeds.
- You cannot build realtime Tadawul data yourself. It is licensed from the exchange or a licensed redistributor (SAHMK). Scraping violates terms and can't go in a sellable product.
- TradingView is fine for personal realtime + alerts, but has no redistribution API and its terms block using its data in your own product.
- For a personal swing tool on a 6-12 month horizon, true realtime is not needed. Daily history + ~15-min delayed quotes, polled every 15-20 min, is enough. Free option: Yahoo Finance (yfinance) for daily history + delayed quotes, with SAHMK Free as fallback. Caveat: Yahoo is unofficial (can break) and may not cover all Saudi small-caps/new IPOs.
- Product path realities: the realtime data is a commodity everyone licenses from the same sources, so the edge is the recommendation + automation + UX layer. Two hard gates before building a product: (1) data redistribution/enterprise licensing cost, (2) CMA regulation of paid securities recommendations in Saudi Arabia (verify with CMA or a securities lawyer).

## Decisions I still need to make
1. Personal free build now (Yahoo data layer, prove the signal for a few weeks) vs start the product track (architecture + CMA legal check first).
2. If personal: confirm swapping the data layer to Yahoo (primary) + SAHMK Free (fallback), cadence every 15-20 min, add a daily open heartbeat.
3. Set exact deployable cash.

## Suggested next step
Build the Yahoo data layer for the personal tool (0 SAR), run it live for a few weeks to validate the recommendation logic on my own money, then decide on the product track with the CMA question researched first.
