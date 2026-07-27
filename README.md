# TASI recommender

Watches your TASI holdings and watchlist during the trading session (Sun-Thu, 10:00-14:55 Riyadh) and sends buy/sell/hold recommendations to Discord. Runs on GitHub Actions, so your laptop stays off.

It automates your rules. It does not place orders and it is not financial advice. You execute every trade yourself.

## What each run does

1. Pulls daily history and a delayed quote for every holding and watchlist name (Yahoo Finance, free).
2. Checks the TASI index. If the index is breaking down, it suppresses BUY signals.
3. Holdings: alerts on STOP, TRIM, or TARGET hits. Watchlist: alerts on BUY-zone hits with a 0-100 conviction score and position sizing from your cash.
4. Every alert carries two reads: a long-term swing read and a short-term momentum read. Neither carries a confidence label; the short-term read is inherently noisier because it runs on delayed daily data.
5. De-dupes so you get one alert per level per day.

## What it does not do

Short-term signals are noisier by nature, not because of any label attached to them. Delayed daily data is fine for 6-12 month swing decisions. It is not a day-trading engine. If you want reliable intraday signals, that needs licensed realtime data (SAHMK Starter, 149 SAR/mo) and is a later upgrade.

News is an auditable keyword/phrase tally over free Google News headlines — word-boundary matching for English (so "rise" doesn't fire inside "Enterprise"), plain substring for Arabic (where prefixes/conjunctions attach directly to root words). It is shown in the digest as real headlines, not a bare confidence-labeled number. It is an input, not a trigger. Do not act on it alone.

## Files

- `config.py` — your holdings, watchlist, and risk rules. The only file you edit.
- `data.py` — price + history (Yahoo primary, SAHMK Free fallback).
- `indicators.py` — RSI, support/resistance, trend, short/long reads.
- `analyze.py` — the recommendation engine and position sizing.
- `news.py` — free news + sentiment.
- `notify.py` — Discord delivery.
- `main.py` — modes and orchestration.
- `universe.py` — Tadawul ticker discovery for the backtest.
- `backtest.py` — walk-forward validation of the BUY rules.
- `test_core.py` — offline tests (no network).
- `.github/workflows/tasi.yml` — the schedule.

`levels.json`, `state.json`, `symbols.json` are generated at runtime and committed back by the workflow. `universe.json` is generated once by the `universe` mode and committed. `.cache/` holds backtest history and features; it is gitignored and safe to delete (it just costs a re-download).

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

## When BUY fires (the exact criteria)

A watchlist name becomes **BUY** only when ALL four hold (enforced in one place: `analyze.buy_decision`):

1. **Conviction** ≥ `BUY_CRITERIA["conviction_min"]` (65). When the TASI regime is `breakdown` or `unknown`, the bar rises to `conviction_min_breakdown` (80) — the regime **raises the bar, it never blocks outright**.
2. **News** sentiment score ≥ 0. No news or a failed fetch counts as neutral (0.0) and passes.
3. **RSI** inside `rsi_recovery_band` (25–60) — recovering, not capitulating, not chasing.
4. **Long-term read confirms strength**: long trend is `up` **AND** long momentum ≥ `long_mom_floor_pct` (−5%). Both are required — an `up` MA cross with falling momentum is not enough.

The buy zone from `levels.json` is no longer a gate — distance to it feeds the conviction score instead. All thresholds live in `BUY_CRITERIA` in `config.py`.

## Symbol verification (why a name might say UNVERIFIED)

Config codes are hand-entered, and a wrong code silently resolves to a real but **different** company — e.g. `6015` labeled "Jahez" is actually Americana Restaurants. Each run compares your config name to the company name the data source returns and caches the result in `symbols.json`. A mismatch marks the name **UNVERIFIED**: it is shown but **excluded from BUY and the budget**, and listed in the digest footer so you can fix the code against Tadawul (the authority). Brand-vs-legal-name cases (Avalon Pharma = "Middle East Pharmaceutical Industries") are confirmed once by setting `verified: true` for that code in `symbols.json`.

## Monthly buy budget

`BUDGET["monthly_budget_sar"]` in `config.py` (default 500) is a hard cap on recommended new-buy spend per calendar month. Each run pools all BUYs, splits the *remaining* monthly budget across them weighted by conviction, and rounds down to whole shares (Tadawul has no fractional shares). Leftover stays cash. Recommendations are recorded in `budget_state.json` per month; later runs only allocate what's left. If you skipped a recommended buy, edit that file to give the budget back.

## Validation (does any of this actually work?)

Every BUY threshold — conviction 65/80, the 25–60 RSI band, the −5% momentum
floor, the conviction weights — was chosen by hand and, until now, never
checked against history. Three local modes measure them. They are slow, they
write large caches, and they are deliberately **not** on the GitHub Actions
schedule.

```
MODE=universe python main.py     # once, ~30 min -> universe.json
MODE=features python main.py     # once, 30-90 min -> .cache/features.csv
MODE=backtest python main.py     # seconds -> the report
SWEEP=1 MODE=backtest python main.py        # BUY threshold grid
SWEEP=levels MODE=backtest python main.py   # ATR stop/target multiplier grid
```

The `features` build checkpoints every 25 names, so if it is interrupted,
re-running it resumes instead of starting over. Delete `.cache/features.csv` to
force a clean rebuild — required whenever you change anything `derive_levels`
or the indicators depend on.

`universe` probes Tadawul's 4-digit code blocks on Yahoo and keeps whatever is
listed, so the backtest runs on a few hundred names instead of your eight —
eight names through a narrow gate produce too few BUY events to tune anything.
`features` replays an expanding window over 5 years of adjusted daily bars,
calling the same indicator and level functions production calls. `backtest`
then replays the real `buy_decision` over those features and scores each signal.

**What the numbers mean.** Entry is the bar *after* the signal, at its open.
Each trade runs until it hits the derived stop or target, or times out at 120
bars. **Expectancy** — mean return across every event, timeouts included — is
the headline; win rate alone would describe only the trades that resolved. The
TASI baseline row is the return of simply holding the index over the same
windows, and a signal is only worth anything if it beats that.

**What it cannot tell you.**

- **News is not validated.** Historical headlines are not retrievable, so the
  news score is neutralized to 0.0 — which passes the gate. BUY criterion #2 is
  simply untested.
- **Survivorship bias.** Probing Yahoo today finds only currently-listed names.
  Companies that delisted are invisible, which flatters every result.
- **Same-bar ambiguity.** When one daily bar spans both the stop and the target,
  it is recorded as a stop. Daily data cannot say which came first, so the
  pessimistic read is the honest one.

Before trusting any number: the report fails loudly if two trades on the same
name overlap, and a win rate near 90% means look-ahead leaked, not that the
system is good.

**What the first run found** (`docs/backtest-findings-2026-07-23.md`): the old
support/resistance levels gave a median reward:risk of 0.12 — a 71.9% win rate
that still lost money. Levels are now placed by ATR from the entry price, which
fixed the bleed. The entry signal itself shows no measurable edge, so a high
win rate here should always be read alongside expectancy.

## Risk rules (in config.py)

Defaults are tuned for a small account: max 5 positions, 25% of deployable cash per buy, 9% stop, 35% cap on any single name, 12% cash buffer, and a commission floor that skips lots too small to be worth the fees. Change any number. The engine reads your values.

## Known risks

- Yahoo is unofficial and can break. The SAHMK Free fallback covers the index and fills gaps, but if Yahoo drops a small-cap you will see `NO DATA` for it.
- GitHub Actions cron can be delayed a few minutes under load. Fine for 15-minute swing checks. Not fine for tick-level alerts.
- Newer IPOs have short history, so the technicals need enough bars before scoring them (`min_history_bars` in config).
- If `state.json` desyncs you could get a repeat alert. Low stakes: delete it to reset.

## The product question (unresolved)

If you turn this into something you sell, two hard gates come first: (1) data redistribution licensing, since realtime Tadawul data is licensed from the exchange or a redistributor and cannot be scraped into a product, and (2) CMA regulation of paid securities recommendations in Saudi Arabia. Verify both with the CMA or a securities lawyer before building the product track.
