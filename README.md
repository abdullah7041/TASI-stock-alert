# TASI recommender

Watches your TASI holdings and watchlist during the trading session (Sun-Thu, 10:00-14:55 Riyadh) and sends buy/sell/hold recommendations to Discord. Runs on GitHub Actions, so your laptop stays off.

It automates your rules. It does not place orders and it is not financial advice. You execute every trade yourself.

## What each run does

1. Pulls daily history and a delayed quote for every holding and watchlist name (Yahoo Finance, free).
2. Checks the TASI index and reports the market regime in the digest header. The regime is context, not a gate — it no longer changes any per-name decision. If the index fetch fails, the digest says so instead of quietly reporting `unknown`.
3. Holdings: alerts on STOP, TRIM, or TARGET hits. Watchlist: reports how many of the three BUY rules each name meets, and equal-weight position sizing from your monthly budget.
4. Every alert carries two reads: a long-term swing read and a short-term momentum read. Neither carries a confidence label; the short-term read is inherently noisier because it runs on delayed daily data.
5. Scans Tadawul's full universe (~265 names) daily for breakout candidates.
6. De-dupes so you get one alert per level per day.

## What the pre-open digest actually contains

One Discord embed per name, plus a chart. Every field below is computed from
data the run already pulls:

| Field | What it is |
|---|---|
| Call | HOLD / TRIM / SELL / BUY / WATCH, with the reason |
| Position | unrealised P/L on a holding, or rules met N/3 on a watchlist name |
| Volume | today's turnover against **this name's own** 20-day median |
| Levels | stop / trim / target from `levels.json`, and how far each is from here |
| Technicals | RSI, trend, 10-day and 120-day momentum, trend-streak length |
| Since yesterday | what actually changed — RSI, rules met, a trend flip |
| Next-bar trigger | the close that would flip a failing rule (watchlist only) |
| News / filings | recent headlines and Tadawul disclosures |
| Pre-open lean | a model's directional read, labelled as judgement — see below |

Attached to each embed: a 90-session candlestick with a volume subplot, the
stop/trim/target drawn on it, and unusually busy sessions highlighted.

**On volume.** The ratio is reported as an observation, not a signal.
`docs/scanner-findings-2026-07-30.md` measured it against forward return over
2021-2026 and it did not survive, which is why `scanner.py` does not rank on it
and `buy_decision` never sees it. "3.2x its own median" is still a true and
useful description of today's tape.

**On the pre-open lean.** A model reads the overnight picture — price action,
technicals, volume, headlines, filings — and states a direction with a
confidence. It is judgement, and it is labelled as judgement. Two things keep
that honest rather than merely disclaimed:

- It gates nothing. `buy_decision` takes only `(long_read, criteria)`, and a
  test asserts that signature and the absence of `lean` in its source.
- Every lean is recorded in `history.json` and graded by the post-close
  `reconcile` run against the next session's close, with moves inside ±0.5%
  counted flat rather than scored. So its hit rate is a measured number you can
  watch, not a claim. For calibration: a naive always-positive call scores about
  54% on the history recorded so far. That is the bar it has to beat.

Set `GEMINI_API_KEY` to enable it. Without the secret every name reads
`Pre-open lean: unavailable — no GEMINI_API_KEY configured`, and every other
field still ships. Calls are capped monthly in `llm_budget.json`.

## What it does not do

Short-term signals are noisier by nature, not because of any label attached to them. Delayed daily data is fine for 6-12 month swing decisions. It is not a day-trading engine. If you want reliable intraday signals, that needs licensed realtime data (SAHMK Starter, 149 SAR/mo) and is a later upgrade.

**It is not yet intraday, whatever the labels say.** `data.get_quote` returns the last *daily* close, and `movement.py` runs its robust-z over *daily* returns — while the workflow calls both every fifteen minutes and tags the result `delayed-intraday`. Whether free Yahoo actually serves intraday bars for `.SR` symbols has never been tested. Dispatch the `intraday-probe` mode to settle it: it records bar counts and volume coverage per interval into `research/intraday_probe.json`, against a threshold written down before the answer was known. Until that comes back positive, treat the session cadence as repeated daily-bar checks.

News is an auditable keyword/phrase tally over free Google News headlines — word-boundary matching for English (so "rise" doesn't fire inside "Enterprise"), plain substring for Arabic (where prefixes/conjunctions attach directly to root words). It is shown in the digest as real headlines, not a bare confidence-labeled number. It is an input, not a trigger. Do not act on it alone.

## Files

- `config.py` — your holdings, watchlist, and risk rules. The only file you edit.
- `data.py` — price + history (Yahoo primary, SAHMK Free fallback).
- `indicators.py` — RSI, support/resistance, trend, short/long reads.
- `analyze.py` — the recommendation engine and position sizing.
- `news.py` — free news + sentiment.
- `llm.py` — the pre-open lean: one model call, budget-capped, gates nothing.
- `charts.py` — candlestick + volume PNGs for the digest.
- `notify.py` — Discord delivery (embeds, chart uploads, plain text).
- `session_gate.py` — Riyadh trading calendar; blocks live modes on closed days.
- `main.py` — modes and orchestration.
- `universe.py` — Tadawul ticker discovery for the backtest.
- `scanner.py` — breakout candidate ranking (Stage F).
- `scanner_features.py` — feature extraction for scanner scoring.
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
   - `GEMINI_API_KEY` = optional. Enables Gemini pre-open leans. Without it the digest ships every fact it has and each name says the lean is unavailable and why.
3. In `config.py`, set `BUDGET["monthly_budget_sar"]` to what you are willing to commit to new buys per calendar month. It ships at 500.
4. Commit and push. The schedule runs automatically.

## First-run checklist (do these in order)

1. **Heartbeat.** Actions -> TASI recommender -> Run workflow -> mode `heartbeat`. A Discord message means secrets and webhook work.
1b. **Intraday probe.** Run workflow -> mode `intraday-probe`. It writes `research/intraday_probe.json` and commits it. Read `verdict.intradayViable`: that answers whether the every-15-minutes cadence can ever be genuinely intraday, or whether the session checks are repeated daily-bar reads. Nothing else depends on running it first, but every intraday decision depends on its answer.
2. **Suggest.** Run workflow -> mode `suggest`. Read the run log. It prints price, RSI, support, resistance, and bar count for every name. Any name showing `NO DATA` needs its code fixed in `config.py` (Yahoo may not carry some recent IPOs). The watchlist codes marked `verified: False` in `config.py` are the ones to confirm here.
3. **Autolevels.** Run workflow -> mode `autolevels`. It writes proposed buy zones, stops, and targets to `levels.json` and prints them. Open `levels.json`, adjust any number you disagree with, commit it.
4. **Digest.** Run workflow -> mode `digest`. You get one summary message with every name, its two reads, and any news. Confirms the full pipeline end to end.
5. **Let it run.** The scheduled `run` mode now fires alerts through the session whenever a level hits.

## Verify an alert actually fires

Set a holding `target` in `levels.json` just below its current price, run mode `run`, and confirm the SELL alert lands in Discord. Then set it back.

## When BUY fires (the exact criteria)

A watchlist name becomes **BUY** only when ALL THREE hold (enforced in one place: `analyze.buy_decision`):

1. **RSI** inside `rsi_recovery_band` (25–60) — recovering, not capitulating, not chasing.
2. **Trend** is `up` (the 20/50-day MA cross).
3. **Momentum** ≥ `long_mom_floor_pct` (−5%) over the long lookback.

Trend and momentum are separate rules on purpose: an `up` MA cross with falling momentum meets one and fails the other, and the digest says so — `Rules met: 2/3` — rather than hiding both behind a single verdict.

There is **no conviction score**. It was deleted, not tuned: a walk-forward backtest over 3,733 events found its buckets *inverted* against forward return, while it was gating BUY and weighting the budget (see `docs/backtest-findings-2026-07-23.md`). There is **no news rule** either — news has never been validated against outcomes, so it is shown as context and gates nothing.

The buy zone from `levels.json` is not a gate; distance to it is reported as context. All thresholds live in `BUY_CRITERIA` in `config.py`.

## Trigger prices (what would have to be true)

For every rule a watchlist name is currently failing, the digest computes
the price that would flip it on the very next bar, and shows the nearest
one: `Trigger (next bar): RSI clears the 25-60 band at 54.10 (-8.2% away)`.

This is scoped honestly: it is a next-bar estimate. Momentum and RSI solve
exactly for what price would need to land tomorrow, using the other inputs
as they will stand on that bar (the close the momentum lookback will point
at once tomorrow's bar is appended — one bar later than today's reference,
because the window shifts — and today's smoothed RSI inputs). If price
drifts there over several days instead of one, the rolling windows will
have moved and the rule may not flip at that exact number — that is a
property of the math, not a bug. The trend rule has no closed-form inverse
(it depends on two rolling means, not one number), so it is found by
scanning forward in small steps.

Every stated price is a real 2-decimal quote that has been checked by
appending it and re-running the actual indicator, so it is the smallest
qualifying cent rather than a rounded-off approximation. All three rules
are bounded at ±25% from today's close — if a rule would need a bigger
single-bar move than that, the digest says so (`none within reach`) rather
than quoting a number nobody should act on.

This is what replaces a verdict with a falsifiable claim: check tomorrow
whether the stated price did what was claimed.

## Day-over-day deltas and streaks

Every name gets a snapshot recorded once per digest run (`history.json`, capped
at 90 days per name). From the previous day's snapshot the digest computes: the
price move, the RSI move, whether any BUY rule flipped pass/fail, and how many
consecutive days the current trend has held.

Names where nothing changed (no rule flipped, `rules_met` steady, trend the
same) and that have no fresh news collapse to one line — the digest's
attention goes to what changed, not what didn't. A leading `▲` marks a name
that did change. Running the digest more than once on the same day is safe:
the second run compares against yesterday, not against the first run's own
snapshot, so deltas and streaks come out identical both times.

## Tadawul disclosures

Every name — holding or watchlist — is checked against Argaam's aggregate
Tadawul disclosures feed (official company announcements: earnings,
dividends, capital increases, board recommendations), fetched once per
digest run and matched locally by company name. This is a higher-signal
source than the news headlines Stage A added — these are the company's own
regulatory filings, not press coverage. Same honesty rule as news: a feed
outage renders `disclosures: fetch failed`, distinct from `disclosures: none
found` for a real fetch that had nothing for that name.

## Breakout scanner

The digest includes a daily scan of Tadawul's full universe (~265 listed names) for breakout candidates, appended to the digest as a `Scanner` block. The scanner ranks names by a 2-condition score:

1. **rel_strength**: 60-day return vs the TASI index's 60-day return, ≥ `rel_strength_threshold_pct` (15.0% from `config.py`).
2. **atr_squeeze**: Applied only when volatility (ATR/price) is at or below `vol_high_cutoff_pct` (2.9%) — above that level, the condition does not fire. When it does apply, true when the name's ATR is at or below the `squeeze_pctile_cutoff` (0.2, the bottom quintile) of its own trailing 126-bar range.

A **liquidity floor** is applied first: names with median 60-bar dollar turnover below `liquidity_floor_sar` (50,000 SAR) are not scored at all. This excludes about 8% of the historical sample this was measured on (thinly-traded bar-days where a small order moves the price) — see `docs/scanner-findings-2026-07-30.md` for the exact row counts.

The scanner returns the top 10 ranked by conditions_met (descending), then by rel_strength (descending). Any name with at least one condition met enters the list. All thresholds live in `SCANNER` in `config.py`.

**Base rates these candidates are measured against** (from `docs/scanner-findings-2026-07-30.md`):
- **max-High touch** (intraday touch of +15% within 60 bars): 27.97% of daily bars, 2021–2026.
- **close-to-close** (still holding +15% gain at the 60-bar mark): 12.85% of daily bars, 2021–2026.

rel_strength survives every validity check: monotonic lift within all volatility strata (not riding volatility), positive lift in every full year 2022–2025 (1.52x, 1.20x, 1.28x, 1.54x — positive, not monotonically increasing), and confirmed in the late-window (bars 31–60) as well as the full window — the edge is not an artifact of the label window overlapping the feature's own 60-day lookback. Top decile shows 1.46x lift on the max-High-touch base rate (1.51x on close-to-close).

atr_squeeze is conditional: it works as a filter within low/mid-volatility names (1.43x–1.25x lift), but has no signal in the high-volatility tercile, and is unreliable in strong bull years (see the findings doc for the detailed year-by-year breakdown).

**Dropped features (do not re-propose without reading why):**
- `vol_surge` (volume spike vs 20-day median): no monotonic lift anywhere. Deciles bounce randomly (0.92x–1.14x) with no consistent direction.
- `dist_52w_high` (distance to 52-week high): failed backwards from the plan's own hypothesis. Pooled deciles are U-shaped; within low-vol names they monotonically decrease as proximity to the 52-week high increases (1.61x → 0.79x), the exact opposite of "breakout proximity." The signal actually measures a beaten-down-stock mean-reversion bounce, not a breakout edge.

The scanner fails soft: any exception during scanning (data fetch failure, unexpected input shape, etc.) degrades to `Scanner: unavailable` in the digest, while the holdings and watchlist portions print normally. This prevents a scanner bug from breaking the whole digest.

## `max_positions` is now enforced

`RISK["max_positions"]` used to be configured and silently ignored. It now
caps concurrent open names: existing holdings plus this run's newly-qualifying
BUYs cannot exceed it. A BUY that would push past the cap still appears in
the digest with its rules and trigger — it is just not sized, with a stated
reason (`size: none — max_positions cap (5) reached ...`), the same pattern
already used when a name's price exceeds what's left of the monthly budget.

## Symbol verification (why a name might say UNVERIFIED)

Config codes are hand-entered, and a wrong code silently resolves to a real but **different** company — e.g. `6015` labeled "Jahez" is actually Americana Restaurants. Each run compares your config name to the company name the data source returns and caches the result in `symbols.json`. A mismatch marks the name **UNVERIFIED**: it is shown but **excluded from BUY and the budget**, and listed in the digest footer so you can fix the code against Tadawul (the authority). Brand-vs-legal-name cases (Avalon Pharma = "Middle East Pharmaceutical Industries") are confirmed once by setting `verified: true` for that code in `symbols.json`.

## Monthly buy budget

`BUDGET["monthly_budget_sar"]` in `config.py` (default 500) is a hard cap on recommended new-buy spend per calendar month. Each run pools all BUYs, splits the *remaining* monthly budget across them **equally**, and rounds down to whole shares (Tadawul has no fractional shares). Leftover stays cash. Recommendations are recorded in `budget_state.json` per month; later runs only allocate what's left. If you skipped a recommended buy, edit that file to give the budget back.

## Validation (does any of this actually work?)

Every BUY threshold — the 25–60 RSI band, the −5% momentum
floor — was chosen by hand and, until now, never
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

- **News is not backtested at all.** There is no news rule to validate — news
  is shown as context in the digest and gates nothing (see "When BUY fires"
  above). Historical headlines are not retrievable, so this backtest never
  attempts to score them.
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

Two numbers, and the engine reads both: `max_positions` (5) caps concurrent open names, and `stop_loss_pct` (9%) caps how far below entry a derived stop may sit. That is the whole list. Seven further keys — deployable-cash sizing, per-name concentration caps, a cash buffer, and commission thresholds — used to be listed here and were never implemented; they were removed in 2026-08-10 rather than left as documentation for behavior that did not exist. New-buy sizing is equal-weight from `BUDGET["monthly_budget_sar"]`, described under "Monthly buy budget" above.

## Known risks

- Yahoo is unofficial and can break. The SAHMK Free fallback covers the index and fills gaps, but if Yahoo drops a small-cap you will see `NO DATA` for it.
- GitHub Actions cron can be delayed a few minutes under load. Fine for 15-minute swing checks. Not fine for tick-level alerts.
- Newer IPOs have short history, so the technicals need enough bars before scoring them (`min_history_bars` in config).
- If `state.json` desyncs you could get a repeat alert. Low stakes: delete it to reset.

## The product question (unresolved)

If you turn this into something you sell, two hard gates come first: (1) data redistribution licensing, since realtime Tadawul data is licensed from the exchange or a redistributor and cannot be scraped into a product, and (2) CMA regulation of paid securities recommendations in Saudi Arabia. Verify both with the CMA or a securities lawyer before building the product track.
