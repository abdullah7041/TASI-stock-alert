# TASI recommender

Watches your TASI holdings and watchlist during the trading session (Sun-Thu, 10:00-14:55 Riyadh) and sends buy/sell/hold recommendations to Discord. Runs on GitHub Actions, so your laptop stays off.

It automates your rules. It does not place orders and it is not financial advice. You execute every trade yourself.

## What each run does

1. Pulls daily history and a delayed quote for every holding and watchlist name (Yahoo Finance, free).
2. Checks the TASI index. If the index is breaking down, it suppresses BUY signals.
3. Holdings: alerts on STOP, TRIM, or TARGET hits. Watchlist: alerts on BUY-zone hits with a 0-100 conviction score and position sizing from your cash.
4. Every alert carries two reads: a long-term swing read (medium confidence) and a short-term momentum read (low confidence, by design, because it runs on delayed daily data).
5. De-dupes so you get one alert per level per day.

## What it does not do

Short-term signals are labeled low-confidence on purpose. Delayed daily data is fine for 6-12 month swing decisions. It is not a day-trading engine. If you want reliable intraday signals, that needs licensed realtime data (SAHMK Starter, 149 SAR/mo) and is a later upgrade.

News is a keyword tally over free Google News headlines. It is an input, not a trigger, and it is labeled low-confidence. Do not act on it alone.

## Files

- `config.py` — your holdings, watchlist, and risk rules. The only file you edit.
- `data.py` — price + history (Yahoo primary, SAHMK Free fallback).
- `indicators.py` — RSI, support/resistance, trend, short/long reads.
- `analyze.py` — the recommendation engine and position sizing.
- `news.py` — free news + sentiment.
- `notify.py` — Discord delivery.
- `main.py` — modes and orchestration.
- `test_core.py` — offline tests (no network).
- `.github/workflows/tasi.yml` — the schedule.

`levels.json`, `state.json`, `symbols.json` are generated at runtime and committed back by the workflow.

## Cost

0 SAR. Yahoo data, GitHub Actions, and a Discord webhook are all free at this volume. SAHMK Starter (realtime, 149/mo) is optional and only needed if you later want short-term reliability.

## Setup

1. Create a new **private** GitHub repo and put these files in it (keep the folder structure, including `.github/workflows/tasi.yml`).
2. Repo Settings -> Secrets and variables -> Actions -> New repository secret:
   - `DISCORD_WEBHOOK_URL` = your Discord channel webhook URL.
   - `SAHMK_API_KEY` = your SAHMK Free key (optional; only used as a fallback and for the index).
3. In `config.py`, set `RISK["deployable_cash"]` to your real cash. It ships at a 3000 placeholder.
4. Commit and push. The schedule runs automatically.

## First-run checklist (do these in order)

1. **Heartbeat.** Actions -> TASI recommender -> Run workflow -> mode `heartbeat`. A Discord message means secrets and webhook work.
2. **Suggest.** Run workflow -> mode `suggest`. Read the run log. It prints price, RSI, support, resistance, and bar count for every name. Any name showing `NO DATA` needs its code fixed in `config.py` (Yahoo may not carry some recent IPOs). The watchlist codes marked `verified: False` in `config.py` are the ones to confirm here.
3. **Autolevels.** Run workflow -> mode `autolevels`. It writes proposed buy zones, stops, and targets to `levels.json` and prints them. Open `levels.json`, adjust any number you disagree with, commit it.
4. **Digest.** Run workflow -> mode `digest`. You get one summary message with every name, its two reads, and any news. Confirms the full pipeline end to end.
5. **Let it run.** The scheduled `run` mode now fires alerts through the session whenever a level hits.

## Verify an alert actually fires

Set a holding `target` in `levels.json` just below its current price, run mode `run`, and confirm the SELL alert lands in Discord. Then set it back.

## Risk rules (in config.py)

Defaults are tuned for a small account: max 5 positions, 25% of deployable cash per buy, 9% stop, 35% cap on any single name, 12% cash buffer, and a commission floor that skips lots too small to be worth the fees. Change any number. The engine reads your values.

## Known risks

- Yahoo is unofficial and can break. The SAHMK Free fallback covers the index and fills gaps, but if Yahoo drops a small-cap you will see `NO DATA` for it.
- GitHub Actions cron can be delayed a few minutes under load. Fine for 15-minute swing checks. Not fine for tick-level alerts.
- Newer IPOs have short history, so the technicals need enough bars before scoring them (`min_history_bars` in config).
- If `state.json` desyncs you could get a repeat alert. Low stakes: delete it to reset.

## The product question (unresolved)

If you turn this into something you sell, two hard gates come first: (1) data redistribution licensing, since realtime Tadawul data is licensed from the exchange or a redistributor and cannot be scraped into a product, and (2) CMA regulation of paid securities recommendations in Saudi Arabia. Verify both with the CMA or a securities lawyer before building the product track.
