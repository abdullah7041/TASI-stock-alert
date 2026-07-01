# TASI alert system

Watches your TASI holdings and watchlist during the trading session (Sun-Thu, 10:00-14:55 Riyadh) and sends buy/sell/hold recommendations to Discord. Runs on GitHub Actions, so your laptop stays off.

Design docs: `SPEC.md`, `WATCHLIST-RESEARCH.md`.

## What it does per run

1. Resolves each configured name to a real SAHMK symbol (cached in `symbols.json`).
2. Pulls quotes (+ daily history on Starter+) and the TASI index summary.
3. Checks the market regime — suppresses BUY alerts when TASI is breaking down.
4. Holdings: alerts on STOP / TRIM / TARGET hits. Watchlist: alerts on BUY-zone hits with a 0-100 conviction score and position sizing.
5. De-dupes so you get one alert per level per day (`state.json`).

## Data sources (all free)

- **Yahoo Finance (primary):** daily history + ~15-min delayed quotes, no key. Powers RSI, support/resistance, conviction, and auto-levels. Tadawul code `2222` maps to `2222.SR`.
- **SAHMK Free (fallback + index):** covers the TASI index summary for the regime filter, and fills in a quote for any symbol Yahoo doesn't carry. Needs the free `SAHMK_API_KEY`.

Total cost: 0 SAR. A 6-12 month swing system acts on daily levels, so ~15-min delayed prices are fine. Licensed realtime (SAHMK Starter, 149/mo) is an optional later upgrade, not required.

Known risks: Yahoo is unofficial and can break (the SAHMK fallback covers gaps), and its coverage of Saudi small-caps / recent IPOs is uneven. The first `suggest` run shows which of your 13 names resolve.

## Setup

1. Create a new **private** GitHub repo and put these files in it.
2. Repo Settings -> Secrets and variables -> Actions:
   - Secret `SAHMK_API_KEY` = your SAHMK key
   - Secret `DISCORD_WEBHOOK_URL` = your Discord channel webhook
   - (optional) Variable `DATA_MODE` = `delayed` while on Free, `realtime` on Starter
3. Set `RISK["deployable_cash"]` in `config.py` to your exact cash (starts at a 3,000 placeholder). Risk style is Balanced by default. You do not hand-set price levels — see below.
4. Commit and push. The schedule in `.github/workflows/tasi.yml` runs it automatically.

## Levels are auto-derived (you approve)

You chose auto-derive, so you don't edit levels by hand. History comes from Yahoo (free), so this works without a paid plan:

1. Generate proposals: Actions -> TASI alerts -> Run workflow -> mode = `autolevels`. The system writes proposed watchlist buy zones (near support) and holding stops/targets (from support/resistance) to `levels.json` and prints them in the run log.
2. Review `levels.json`. Adjust any number you disagree with, or re-run `autolevels` to refresh.
3. From then on, normal runs use `levels.json`. `config.py` values are only a fallback.

To just inspect the raw data without generating levels, use mode = `suggest` (prints price/RSI/support/resistance).

## Test it end to end

- Heartbeat ping: Run workflow -> mode = `heartbeat`. A message in Discord means secrets + webhook work.
- Levels: temporarily set a holding `target` just below current price to force a SELL alert, confirm it arrives, then reset.

## Local dev

```
pip install -r requirements.txt
python -m pytest -q          # 13 logic tests
SAHMK_API_KEY=... DISCORD_WEBHOOK_URL=... python main.py
```

## Notes / limits

- GitHub cron isn't second-accurate; runs can lag a few minutes. Fine for 10-min swing checks.
- This is analysis, not licensed advice. It never places orders. Verify live before trading.
- Keep the repo private — your holdings and cash are in `config.py`.
