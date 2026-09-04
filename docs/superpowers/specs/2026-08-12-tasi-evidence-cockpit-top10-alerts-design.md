# TASI Evidence Cockpit, Top 10, and Unusual-Movement Alerts Design

**Status:** Approved in conversation on 2026-08-12

## Purpose

Replace the old fixed watchlist experience with an evidence-first TASI decision cockpit that:

- makes every market and research date explicit;
- presents a concise Discord-style summary on the site;
- proposes an approval-gated Top 10 across any eligible TASI company;
- tracks the user's real portfolio and a 500 SAR monthly contribution;
- creates alerts only for statistically unusual price movement;
- shows a target-before-stop forecast only after a strict evidence gate passes;
- keeps the broker application as the real-time price-crossing and order-execution layer.

The system remains decision support. It never sends an order, silently edits the approved Top 10, or describes delayed data as real time.

## Approved product decisions

- Universe: any TASI company with sufficient tradability, history, and current evidence.
- Horizon: 1-3 month swing decisions.
- Portfolio: current holdings can occupy Top 10 positions and are visibly labelled as owned.
- Diversification: no more than two Top 10 companies from one sector.
- Turnover: an incumbent remains unless it fails eligibility, develops material risk, or a challenger exceeds it by at least five score points.
- Capital: post one 500 SAR external contribution per calendar month. The contribution limit resets monthly; confirmed account cash persists.
- Actions: add, buy new, hold, trim, sell, or hold cash.
- Execution: every trade is a proposal until manually confirmed on the site.
- Alerts: both upside and downside, but only when price movement is statistically unusual and materially large. Volume and news can explain or strengthen an alert but cannot create one by themselves.
- Delivery: Discord receives immediate delivery of the bot's delayed confirmation; the site retains alert history.
- Forecast: target-before-stop probability with target, stop, horizon, confidence, and evidence. Unsupported forecasts show `Forecast unavailable`.
- Data cost: use free or already available delayed data. The bank broker application owns real-time notifications.
- Layout: Option A, an action-first cockpit with date/freshness at the top, summary first, then alerts, portfolio, Top 10, and evidence.

## Non-goals

- Automated trading or broker integration.
- Exchange-grade real-time alerts from the bot.
- Treating news sentiment, raw volume surge, or a cheap valuation ratio as a buy signal.
- Auto-approving a newly researched list.
- Hiding stale, missing, or conflicting evidence.
- Claiming that an unvalidated probability predicts a stock's future.

## Architecture

The approved architecture has two explicit paths.

1. **Real-time safety path:** broker application price alert -> user decision/order. This is the only path presented as real-time protection.
2. **Evidence path:** delayed market data and dated official evidence -> validation -> sector-specific scoring -> proposal/alert/forecast gates -> Discord and the private site.

The current Python producer remains responsible for market analysis and snapshot generation. The current private Sites application and D1 database remain responsible for durable dashboard state, approvals, trade confirmations, and alert history. This avoids introducing a paid market feed or a new backend before the current slice proves useful.

## Data freshness contract

Every rendered data family carries its own stamp:

- `tradeDate`: exchange trading date represented by the data;
- `observedAt`: provider or filing timestamp when available;
- `receivedAt`: when this system received it;
- `source`: provider or official source name;
- `latency`: `delayed-intraday`, `delayed-daily`, `official-filing`, or `manual`;
- `freshness`: `current`, `stale`, or `unknown`.

The page header shows the newest market observation and separately shows the Top 10 evidence review date, portfolio confirmation date, and alert observation time. A global `As of` label never substitutes for these separate dates.

The last valid snapshot remains visible if refresh fails, with a prominent stale warning. Missing or stale evidence causes abstention; it never causes a neutral-looking fabricated score.

## TASI Top 10 evidence funnel

### Stage A: broad technical and tradability screen

All codes in the committed TASI universe are evaluated using point-in-time market data. A company must have:

- at least 130 completed daily bars;
- median 60-session traded value of at least 50,000 SAR;
- a verified symbol and sector;
- positive relative strength versus TASI and its sector for the selected window;
- an executable ATR-based stop and target.

This stage creates a research shortlist, not a recommendation.

### Stage B: current official evidence

The shortlist and all current holdings require a dated evidence record linked to Saudi Exchange statements, announcements, or another named primary source. Evidence is point-in-time: the report period, publication date, retrieval date, and source URL are stored.

The sector forms are different by construction:

- **Operating companies:** profitability direction, cash conversion, leverage resilience, earnings stability, receivables/inventory risk, dilution, and governance flags.
- **Banks:** ROE/profit direction, net interest and fee income, cost efficiency, asset quality, impairment coverage, capital adequacy, liquidity, and financing/deposit growth quality.
- **Insurers:** insurance revenue and service result, claims/service expense behaviour, combined-ratio equivalent when comparable, contractual service margin direction, investment-result quality, and solvency resilience.
- **REITs:** occupancy, rental-income direction, FFO or consistent cash proxy, distribution coverage, leverage/refinancing, tenant and asset concentration, related-party risk, and NAV discount/premium.

If a required sector metric is legitimately not reported, the evidence record explains the substitute. Missing data is never silently scored as zero or as average.

### Stage C: transparent 100-point score

- Fundamental direction: 30 points.
- Financial quality and resilience: 25 points.
- Swing timing and relative strength: 25 points.
- Valuation and downside context: 10 points.
- Official catalyst/evidence quality: 10 points.

General news cannot increase this score in version 1. A dated official disclosure can affect the final component or create a risk flag. Severe audit, restatement, liquidity, suspension, or governance flags make the company ineligible regardless of total score.

### Stage D: controlled selection

Sort eligible companies by total score, then apply:

- maximum two names per sector;
- owned-company labels;
- incumbent five-point replacement buffer;
- explicit exclusion reasons;
- an approval state of `draft`, `approved`, or `rejected`.

Only the most recent approved proposal is labelled `Recommended Top 10`. A newer draft is visibly separate and cannot replace it through ingestion alone.

## Portfolio and monthly cash ledger

The site stores append-only confirmed events:

- monthly contribution;
- buy;
- sell;
- cash adjustment with a required reason.

The 500 SAR contribution is posted at most once per `YYYY-MM`. Confirmed cash persists across months, so holding cash is a real outcome rather than lost budget. Confirmed sell proceeds return to cash. Proposed trades do not affect holdings, cash, or performance until confirmation succeeds.

The monthly recommendation engine compares eligible actions and may propose:

- add to an owned Top 10 company;
- buy a new approved Top 10 company;
- trim or sell a holding with a material risk or invalidated thesis;
- hold existing positions;
- hold cash when no whole-share action clears the risk and evidence gates.

The engine never recommends spending more confirmed cash than is available and never invents fractional TASI shares.

## Adaptive unusual-movement alerts

For each delayed intraday observation, compute the stock return net of broad TASI and sector movement. Scale the residual by the stock's robust time-of-day history using median and median absolute deviation.

A balanced version-1 alert requires all of:

- absolute excess move of at least 1.5%;
- absolute robust z-score of at least 4.0;
- at least 20 comparable historical observations for that time bucket;
- current-enough delayed data with verified source and timestamps;
- liquidity above the screen floor;
- no active cooldown for the same symbol and direction.

Volume never creates an alert. A volume ratio of at least 2.0 or a recent official disclosure can raise explanation confidence after the price gate has fired. General news remains a dated overlay.

Alerts use a 60-minute cooldown and rearm only after the absolute z-score falls below 2.0. Downside alerts apply to holdings; upside alerts apply to approved Top 10 names. Each alert stores observed/source/received timestamps, excess move, z-score, volume ratio, linked evidence, delivery state, and suppression reason when applicable.

Every alert says `Delayed bot confirmation`. The broker application remains responsible for immediate price alerts.

## Target-before-stop forecast

The first numerical forecast predicts whether an entry reaches a 3-ATR target before a 1.5-ATR stop within 60 trading sessions. A daily bar touching both levels counts as stop-first because intraday ordering is unknown.

The forecast pipeline uses point-in-time market features and rolling-origin evaluation with a 60-session embargo. Volume can become a feature only if it improves untouched out-of-sample results. News starts only as a dated evidence overlay; it cannot enter the model until a point-in-time archive demonstrates incremental value.

Publishing requires all of:

- multiclass Brier score and log loss better than a constant base-rate forecast;
- expected calibration error no greater than 0.05;
- positive after-cost expectancy in the displayed tier;
- stable positive skill across periods and regimes;
- adequate sample size and no unresolved leakage defect.

Failure of any gate renders `Forecast unavailable` with the reason. The forecast cannot change a deterministic action or position size in this release.

## Site information hierarchy

Option A renders in this order:

1. Header with Riyadh date, market observation date/time, data latency, and stale state.
2. Discord-style `Today's summary` with the few decisions needing attention.
3. Delayed unusual-movement alerts and alert history.
4. Portfolio positions, confirmed cash, monthly contribution status, and proposed action.
5. Approved Top 10, with draft changes shown separately.
6. Score breakdown, sector form, filing links, news overlay, target/stop, and forecast or abstention reason.
7. Safety footer: broker verifies live price; user confirms every trade.

Dates are visible without opening a detail panel. Every card states whether it is owned, proposed, approved, stale, or unavailable.

## Refresh and governance

- Delayed session checks: current 15-minute workflow, explicitly non-real-time.
- Daily pre-open: digest, portfolio summary, approved Top 10 state, and forecast status.
- Weekly after Thursday close: generate a new Top 10 draft only when evidence is current.
- Event-driven: flag a material official disclosure for review; do not auto-approve a replacement.
- Monthly: a recurring Codex research task uses the repository-local `research` skill to refresh primary-source evidence and produce an approval request.
- Quarterly/reporting cycle: rebuild sector forms after new financial statements.

The monthly task may write research and draft evidence, but it may not approve the list, confirm a trade, or send outreach. The user remains the approval boundary.

## Failure handling

- Invalid ingestion is rejected without replacing the last valid snapshot.
- A failed Top 10 refresh leaves the last approved list in place and marks the draft unavailable.
- A stale or malformed price suppresses alerts and forecasts.
- Duplicate trade confirmations are idempotent by client-generated operation ID.
- Duplicate alert deliveries are suppressed by deterministic symbol/direction/window keys.
- Discord delivery failure remains visible in site alert history.
- Missing research evidence produces an exclusion reason, not a guessed score.

## Verification and release

Each slice is test-driven and independently reviewable. Production readiness requires Python tests, frontend tests, typecheck, lint, build, a manual digest ingestion, a readback of `/api/dashboard`, a manual trade-confirmation round trip against non-production data, and a delayed alert replay. A green workflow or deployment alone is not production proof.

