# Market-pulse shadow runbook

The `market-pulse` mode is an observational, delayed five-minute artifact. It
does not send Discord messages or alter recommendations, BUY decisions, sizing,
budgets, or forecast inputs.

## Before a live integration decision

Run it during two separate Riyadh trading sessions through the managed job,
without adding a Cloud Scheduler schedule. Keep both
`TASI_DELIVERY_ENABLED` and `TASI_PULSE_INGEST_ENABLED` set to `false`.

For each run, retain the structured managed-job log and the persisted
`market_pulse.json` artifact. Verify that each artifact has all of the
following:

- `dataStatus` is `delayed-intraday`, and its source/delay are stated;
- a `current` pulse has an index completed-bar timestamp and at least 70% stock
  coverage, while a failed collection is explicitly `stale` or `unavailable`;
- a regime is present only when the qualified daily index history is long
  enough; and
- the log reports `pulseIngestResult` as `skipped: pulse ingest disabled
  (shadow mode)`.

Do not provision a paid provider, create a scheduler entry, set
`TASI_PULSE_INGEST_ENABLED=true`, or activate cockpit ingestion from this
runbook. Those are separate, action-time-approved changes after two actual
trading-day timestamp reviews. If Yahoo cannot meet the completed-bar and
coverage contract, retain `unavailable`; do not substitute an unqualified feed.
