# TASI reliability and trade-outcome forecast design

## Status and purpose

This design replaces a time-critical GitHub Actions workflow with managed scheduling, makes the bot's delayed-data role explicit, fixes Discord delivery defects, and adds a rigorously gated entry-forecast research track.

The bot remains decision support. The user's broker or broker application remains the only immediate stop/target safety layer. No forecast may change a BUY decision, position size, or automated trade until its validation and shadow-mode gates have passed and a later manual production switch is approved.

## Goals

- Deliver a concise pre-open plan and delayed-data confirmations with predictable scheduling and observable health.
- Make all bot conclusions truthful about quote source, timestamp, and delayed status.
- Remove arbitrary Discord text slicing, malformed character encoding, duplicate cross-mode alerts, and stale news noise.
- Preserve the existing deterministic levels and rules while researching a calibrated probability for new-entry outcomes.
- Reject poor-quality data and abstain from unsupported predictions rather than producing a plausible-looking answer.

## Non-goals

- Replacing broker/app price alerts or claiming five-minute detection from the actual exchange crossing.
- Automated order execution.
- A real-time market-data subscription. The selected budget does not cover a verified real-time Saudi market-data feed.
- Allowing an ML score to replace the existing BUY rules before validation.

## Architecture

There are two deliberately independent paths.

1. **Safety path:** Saudi market prices -> broker/app alert -> user. Stops and targets are configured in the broker and are not dependent on the bot, a webhook, GitHub, or a delayed quote.
2. **Decision-support path:** a timezone-aware managed scheduler invokes a containerized Python job; the job fetches data, validates it, evaluates rules, writes durable event state, and posts complete Discord cards.

GitHub Actions remains responsible for tests, manual recovery, and deployment only. It is removed from the time-critical scheduling path.

The first implementation targets a Cloud Run job invoked by Cloud Scheduler in `Asia/Riyadh`. Cloud Scheduler retries and Cloud Run execution logs are the scheduling and operational record. The Python application stays containerized rather than being translated to an edge-runtime language.

A Cloud Firestore Standard database replaces bot-authored commits of `state.json`, `history.json`, and other runtime artifacts to `main`. It holds `events`, `snapshots`, `deliveries`, `health`, and `model_runs` documents. An event-claim transaction reads the deterministic event id and creates its pending state only when absent; downstream network delivery occurs after that transaction, never inside it. Firestore transactions provide the atomic read/write transition required when scheduled jobs overlap or retry.

## Schedules and data-quality contract

The scheduler uses the Saudi exchange calendar rather than a raw Sunday-through-Thursday cron expression.

- **09:40 Riyadh:** pre-open plan based only on the preceding completed session.
- **Every five minutes during the market session:** delayed-data confirmation for holding stops and targets only.
- **15:10 Riyadh:** post-close reconciliation, daily snapshot, and health summary.

Every observation passed to a decision has these fields: symbol, price, source, provider-observed timestamp, received timestamp, session date, and delayed/live status. The data-quality layer rejects a missing or non-finite price, symbol mismatch, future timestamp, wrong exchange session, or price older than the configured freshness limit.

A rejected observation never creates a trading recommendation. It may create one concise health warning after the configured consecutive-failure threshold. All accepted messages display quote source, observed time, received time when material, and delayed status.

Daily indicators (RSI, moving averages, momentum, scanner features, and forecasts) are calculated from completed daily bars only. Intraday runs evaluate price levels for existing holdings only; they do not reinterpret a partial daily candle as a new daily technical signal.

## Event state and notifications

Each event is keyed by symbol, level type, configured-level version, and crossing direction. The state machine distinguishes `planned`, `confirmed`, `sent`, and `failed` delivery states. A crossing rearms only after price clears a configurable hysteresis band, avoiding alert oscillation.

The pre-open digest can state `PLAN` for a level already breached at the previous close. An intraday run can later state `CONFIRMED ON DELAYED DATA`. These are different, explicitly labelled states; the event ledger prevents accidental duplicates between digest and monitoring modes.

Discord delivery is at-least-once under an ambiguous network failure. The system records attempts, retries transient failures and rate limits with bounded backoff, and emits a concise health warning when delivery remains unresolved. It does not claim exactly-once delivery, which a simple Discord webhook cannot guarantee.

## Discord content model

The renderer produces structured cards before creating Discord requests. A packer groups only whole cards below a conservative size limit; it never substrings raw content. Therefore a company, headline, word, or Markdown construct cannot be split between messages.

Source files and message content use valid UTF-8. Existing mojibake literals are corrected and protected with rendering tests.

The pre-open message has this order:

1. Header, prior-close timestamp, source, and delayed-data disclaimer.
2. Holding actions requiring attention.
3. The top eligible entry forecasts, or a clear statement that no forecast is publishable.
4. Material watchlist changes and recent official disclosures.
5. Compact budget and operational information only when relevant.

An intraday confirmation is one complete card for one holding action. It names the breached level and the source and age of the delayed observation. Stale news is excluded using a configured recency cutoff; a lack of recent coverage is not rendered as evidence.

## Entry trade-outcome forecast

The first forecast is for new entry candidates across the scanner's liquidity-eligible TASI universe. It is produced after the daily close and assumes entry at the next session's open.

The prediction horizon is 60 trading sessions. It predicts three mutually exclusive outcomes using the existing ATR convention:

- **Target first:** the 3-ATR target is reached before the 1.5-ATR stop.
- **Stop first:** the stop is reached first. If a daily bar touches both boundaries, it is counted as a stop because the intraday order is unknowable.
- **Neither:** neither boundary is reached by session 60; the session-60 close, net of costs, is retained for expected-return analysis.

The digest will eventually show target-first probability, stop-first probability, neither probability, the relevant baseline, expected net return, confidence tier, model version, and as-of date. An illustrative card is not a live prediction. If any forecast gate fails, the renderer says `forecast unavailable` and gives the reason rather than substituting a scanner rank.

### Dataset and features

Training rows must be point-in-time safe: split/dividend-adjusted OHLCV, index history, liquidity, trading calendar, and delisted or suspended constituents where obtainable. The current current-listing-only universe has survivorship bias; until that is materially addressed, results remain research/shadow only.

Initial features are lagged relative strength, 5/20/60/120-day momentum, moving-average distances/slopes, RSI, ATR/price, ATR squeeze, liquidity/turnover, and market regime. News is excluded from version 1 because the project has no historical point-in-time news corpus. Features previously rejected for the breakout hypothesis are not silently revived; any later retest must be preregistered against this different outcome label.

### Model selection, validation, and release gates

The project starts with a constant empirical-rate baseline, then a multinomial logistic model. One constrained tree-based challenger may be evaluated only against the same time splits and feature snapshot. Complexity is not a success criterion.

Validation uses rolling-origin time splits with a 60-session purge/embargo, a final untouched evaluation period, and block-bootstrap uncertainty that respects market/date correlation. Calibration occurs only on validation data, never on the final test period.

A production-eligible model must demonstrate all of the following on unseen data:

- Better multiclass Brier score and log loss than the constant base-rate forecast.
- Calibration error no greater than five percentage points.
- Positive after-cost expectancy in the forecast tier that would be published.
- Stability across years and volatility regimes, with improvement outside its bootstrap uncertainty interval.
- No material unresolved survivorship, missing-data, or leakage defect.

Passing historical gates begins shadow mode; it does not change trading behavior. Shadow forecasts are recorded and evaluated once their 60-session outcomes mature. A manual, reversible approval is required before any forecast influences recommendations or budget allocation.

## Failure handling and observability

The job emits structured logs and metrics for scheduled-versus-start latency, execution duration, quote age, provider failures, rejected observations, events created/suppressed, Discord delivery attempts, and forecast abstentions.

Health notices are deduplicated and stateful: one notice on an actionable degradation and one recovery notice when it clears. The absence of a daily digest, a run starting beyond the lateness threshold, repeated stale data, or unresolved delivery failure is observable without spamming the decision channel.

## Verification and rollout

Automated tests cover:

- UTF-8 rendering and whole-card message packing.
- Price-quality rejection, source/age labelling, and stale-news filtering.
- Cross-mode event transitions, deduplication, and hysteresis rearming.
- Provider timeout, rate-limit, and Discord 429/5xx delivery behavior.
- Forecast label construction, point-in-time feature isolation, purge/embargo boundaries, baseline comparison, calibration, and abstention gates.

Rollout is staged:

1. Containerize and run the existing rules in a test Discord channel with managed scheduling and health telemetry.
2. Validate managed-state migration, message behavior, and operational timing against the existing bot without duplicate production posts.
3. Run the entry forecast in offline validation, then shadow mode; it stays informational and absent when validation fails.
4. Manually enable production Discord delivery and, separately, any future forecast influence only after evidence review.

## Decision record

- Reliable decisions, not a richer but noisier digest, are the primary objective.
- The user selected hybrid operation: broker/app for real-time safety plus bot decision support.
- The user selected a managed scheduler, a sub-five-minute bot-processing target, and a 20-100 SAR/month infrastructure budget.
- The bot is allowed to confirm delayed data but not to claim real-time crossing detection.
- The first forecast is a 60-session new-entry trade-outcome model over all liquidity-eligible TASI names.
