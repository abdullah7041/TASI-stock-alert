# Cloudflare market-pulse shadow

The `tasi-market-pulse-shadow` Worker is a Cloudflare-only alternative to the
unprovisioned Google managed job. It shares the cockpit D1 database, but writes
each scheduled collection to `observational_market_pulse_attempts` only.
`TASI_PULSE_PUBLICATION_ENABLED` remains `false`: the site API, daily dashboard,
Discord, trading decisions, sizing, and forecast inputs are not changed.

The cron runs every five minutes from 07:00 through 12:55 UTC, Sunday–Thursday.
The handler further limits collection to 10:00–15:20 Asia/Riyadh. The provider
is a Yahoo **qualification probe**, not a licensed feed. Each attempt states
the source and 15-minute declared delay, requires a completed index bar plus
at least 70% of tracked stocks, and retains the last valid pulse as stale on
failure. A 50-session market regime requires at least 52 usable daily index
bars; fewer bars leave it unavailable.

Check the exact Worker/account/database targets in `wrangler.pulse.jsonc` before
deploying. Deploy with `npx wrangler deploy --config wrangler.pulse.jsonc`.
The Worker has no public route. Do not turn on publication, paid providers,
ingestion, or notifications during shadow verification.

After **two separate Riyadh trading days**, inspect persisted attempts with
`npx wrangler d1 execute tasi-action-cockpit --remote --config
wrangler.pulse.jsonc --command "SELECT scheduled_at, fetched_at, status,
error_json, json_extract(attempt_json, '$.observedAt') AS observed_at,
json_extract(attempt_json, '$.coverage.tracked') AS tracked,
json_extract(attempt_json, '$.coverage.usable') AS usable,
json_extract(attempt_json, '$.regime.status') AS regime
FROM observational_market_pulse_attempts ORDER BY scheduled_at DESC LIMIT 30"`.
The persisted `scheduled_at`, `fetched_at`, and `observed_at` must be consistent
with completed delayed bars, not merely successful HTTP requests. Read
`attempt_json` and `error_json` when qualification fails. Do not claim the
five-minute pulse is green because an unavailable or stale attempt exists.

On the next Riyadh sessions after 2026-09-25, the earliest two trading days are
2026-09-27 and 2026-09-28, unless the exchange is closed. If Yahoo egress,
index history, freshness, or coverage does not qualify, leave publication off
and report the specific gap. Activation needs a separate decision after these
reviews and any required provider licensing.
