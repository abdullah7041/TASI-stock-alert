# Close TASI data and research gaps safely

## Constraints

- Market pulses are delayed, observation-only, and never reach Discord, trade,
  sizing, BUY, budget, or forecast input paths.
- Preserve the explicit current, stale, and unavailable states.
- Reviewed, dated, first-party evidence remains the sole Top 10 input.
- Forecast publication requires every existing release gate, including a
  non-survivorship-limited dataset.

## Task 1: Source-qualified market pulse

Add a test-driven, source-neutral five-minute pulse contract with qualified
index and tracked-stock coverage. Add a managed-runtime `market-pulse` mode
that records health only in shadow mode. Retain the last valid pulse as stale;
never synthesize a current pulse from incomplete data.

## Task 2: Durable cockpit pulse and evidence review

Add D1-backed, authenticated pulse ingest/read APIs, a durable official-link
queue, immutable validated evidence revisions, and the owner review surface.
Make the producer fetch only validated evidence before drafting a Top 10.

## Task 3: Strict forecast evaluation

Build point-in-time outcomes/datasets, purged rolling evaluation against the
constant baseline, metrics output, and explicit abstention. Keep all forecast
data outside decision and delivery paths.

## Task 4: Integration and verification

Wire workflow/runtime configuration without enabling live delivery or provider
credentials. Add regression coverage, run the repository CI commands, and
leave operational provider/scheduler activation for a separately authorized
shadow run.
