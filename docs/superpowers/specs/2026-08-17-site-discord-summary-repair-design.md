# Site and Discord summary repair

## Purpose

Make the private TASI cockpit and Discord report the same delayed-analysis
decision state, while preserving the broker as the only real-time price-alert
and order channel. The repair addresses the observed production incident:
Sites version 8 serves schema-v2 correctly, but its Top 10 has no evidence,
new delayed alerts are not displayed in the cockpit, and Discord still renders
the legacy recommendation message.

## Confirmed constraints

- Data is delayed/daily. No site or Discord output may claim real-time price
  protection or place an order.
- One routine digest is sent before the market session. Discord sends an
  additional message only for a newly stored unusual movement.
- A Top 10 draft may contain only valid, dated, primary-source company
  evidence. It remains explicitly unavailable when evidence is absent.
- Trade, Top 10, and portfolio approvals stay explicit and idempotent.
- The current version-1 snapshot key remains untouched for rollback. The
  version-2 snapshot remains additive.
- Smoke checks must not send Discord messages, place broker orders, or delete
  D1 data.

## Root cause

The production deployment is not stale. The site reports commit `57edc70` and
schema version 2. On 2026-08-17 the pre-open cron was dispatched late by
GitHub Actions, then completed successfully at 10:38 Riyadh and ingested the
dashboard snapshot.

The visible gaps have independent causes:

1. The evidence contract and scoring code exist, but no
   `research/evidence.json` producer has created valid records. The
   empty Top 10 is therefore an intentional safety state.
2. `mode_digest` calls the legacy `notify.build_message`; it does not consume
   the schema-v2 dashboard summary. Discord cannot therefore match the newer
   site presentation.
3. `/api/alerts/ingest` persists delayed alerts, but `/api/dashboard` reads
   only the daily snapshot. A successfully ingested alert is invisible to the
   cockpit until this response is composed from both stores.
4. The workflow stages an optional `top10_draft.json` together with required
   state files. When that optional path does not exist, the broad `git add`
   fails and its error is suppressed. Dashboard, news, history, and alert
   state are then not committed back to the repository.

## Target architecture

### Canonical summary contract

Python will build a versioned `summary-v1` object as part of every daily
dashboard snapshot. It is the canonical, dated decision payload; neither the
site nor Discord may reconstruct conclusions from unrelated fields.

It contains:

- `generatedAt`, `scheduledFor`, `observedAt`, and explicit delay/freshness
  labels;
- portfolio actions that require confirmation, including the monthly 500 SAR
  budget context;
- Top 10 status, evidence-reviewed time, and either ranked entries or the
  precise evidence-pending reason;
- forecast state and validation reason;
- market-data and research warnings; and
- a deterministic ordered list of semantic cards for display.

The site validates and displays these cards. Discord formats the same ordered
cards into compact Markdown. Text may differ only for surface-specific
formatting; the date, action, reason, evidence state, and forecast state must
be identical.

### Daily digest and Discord

`mode_digest` will create the snapshot and its `summary-v1` object, ingest it,
and send one Discord daily-digest rendering from that object. The legacy
recommendation-only formatter is retained only for backwards-compatible
non-digest commands until its callers are migrated.

`mode_run` will not resend the daily digest. When it detects a new,
idempotent delayed movement alert, it stores the alert, ingests it into D1,
and sends one clearly labelled movement card to Discord. Duplicate alert IDs
produce no repeat message.

Both Discord forms state that analysis is delayed and the broker app owns
real-time protection. Neither includes an order link or an order action.

### Cockpit response

`GET /api/dashboard` continues to preserve the daily snapshot and its
freshness calculation. It additionally reads the latest delayed alerts from
`AlertStore` and returns them as a separate `alerts` collection with each
alert's observed and received timestamps. Adding an alert must not update the
daily `asOf` time.

The cockpit renders the daily summary first, then the independently updated
movement section. It distinguishes no-alerts, delayed alerts, and unavailable
alert storage. The existing last-valid snapshot remains visible on producer or
transport failure.

### Evidence and Top 10

Add a dedicated, scheduled `research-evidence` mode. It validates dated,
HTTPS primary-source records before writing `research/evidence.json`.
It records company, sector, report period, publication/retrieval times,
metrics, source URLs, risks, and analyst notes. Invalid or unavailable source
material produces an evidence-pending result rather than a ranking.

The weekly `top10-draft` mode reads only these validated records, scores the
current universe with the agreed maximum of two companies per sector, and
persists an approval-gated draft. No price-only fallback is allowed.

### Workflow reliability

The scheduler reports its intended time, actual start, lateness, mode, source
commit, snapshot time, alert count, ingest response, and Discord result in the
GitHub job summary. A digest that starts after its target is labelled late in
both the job summary and snapshot warning.

State persistence stages only paths that exist, or stages the explicit changed
set without suppressing failures. Required output commit failures fail the
job visibly; optional Top 10 data does not block daily state persistence.

GitHub Actions remains a best-effort scheduler. It cannot guarantee a 09:45
Riyadh start, as the 2026-08-17 delay demonstrates. A future exact-time
requirement requires moving only the trigger to a persistent scheduled runner;
the producer, D1 API, and Sites deployment remain unchanged.

## Interfaces

- `dashboard.json`: schema version 2 plus required `summary-v1` payload.
- `POST /api/dashboard/ingest`: validates and stores the daily snapshot; no
  Discord or order side effect.
- `POST /api/alerts/ingest`: authenticated, idempotent delayed-alert storage.
- `GET /api/dashboard`: returns `{ snapshot, freshness, alerts }` without
  changing snapshot freshness for alert-only updates.
- `GET /api/health`: continues to expose only deployment, schema, D1, and
  latest-snapshot metadata.

## Error handling and observability

- A failed dashboard ingest leaves the previous valid snapshot visible and
  fails the producer job.
- A failed alert ingest fails its producer job and sends no alert Discord
  message, avoiding a claim the site cannot display.
- A failed Discord delivery is logged in the job summary without invalidating
  an already stored dashboard snapshot.
- Missing or invalid evidence produces an evidence-pending card, never a
  fabricated Top 10 entry.
- Scheduler lateness is factual metadata, not a substitute for reliable
  real-time alerts.

## Verification and rollout

1. Add contract tests for the canonical summary, including an empty-evidence
   Top 10 and an unavailable forecast.
2. Add integration tests proving that an accepted alert appears through
   `GET /api/dashboard` while the daily snapshot time is unchanged.
3. Add Discord rendering tests that compare its semantic card input with the
   stored summary input, including duplicate-alert suppression.
4. Add workflow tests for optional absent paths and required state-commit
   failure visibility.
5. Run Python and web CI on the exact release commit. Build and save a new
   private Sites version only after these gates pass.
6. Run the no-notification production smoke workflow, verify health commit,
   schema versions, v1 fallback, v2 ingest, current Riyadh date, and dashboard
   alert composition.
7. Do not post a test message to production Discord. The next normal digest
   is the first production daily message; its job summary records delivery.

Rollback redeploys the prior Sites version without deleting D1 data. Version 7
continues reading the retained version-1 snapshot key. If the new producer
fails, the site retains the last valid snapshot with its stale warning.

## Out of scope

- Real-time market feed replacement, broker integration, and automatic order
  placement.
- Publishing a Top 10 without reviewed primary-source evidence.
- Moving scheduling infrastructure before the user approves an exact-time
  provider and budget.
