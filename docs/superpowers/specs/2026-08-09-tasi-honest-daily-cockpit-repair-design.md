# TASI Honest Daily Cockpit Repair Design

## Goal

Make the private TASI Action Cockpit reliably display the existing system's
real delayed/daily market analysis. The site must never present the feed as
live or imply that it provides immediate trading protection.

The first repaired version updates after the Sunday-through-Thursday pre-open
digest. When a refresh fails, it retains the last valid snapshot, labels it
stale, and disables research actions that depend on current scanner results.

## Scope

This repair covers the existing Python digest producer, its authenticated
handoff to the private Sites application, D1 snapshot storage, the cockpit UI,
and the research/report and chat routes.

It does not add a paid quote feed, broker connection, automatic order
execution, intraday dashboard refresh, portfolio ledger, or new forecasting
model.

## Architecture and Data Flow

The existing pre-open GitHub Actions job remains the only market-data producer
for the cockpit. It performs holdings analysis and the broad-market scanner,
then creates one structured dashboard snapshot from those exact results.

The producer sends the snapshot through the private site's automation access
gate. The application then independently checks its dashboard-ingestion token
before validating or storing the payload. These are separate controls: the
hosting credential permits non-interactive access to the private site, while
the ingestion token authorizes replacement of the saved dashboard snapshot.

D1 stores the latest successfully validated snapshot. A rejected payload or a
failed scheduled run does not remove or overwrite the previous valid snapshot.
The dashboard, research report, and research chat routes all read from this
same stored snapshot. Production routes do not import or consult the preview
fixture.

## Producer Responsibilities

The scanner exposes a structured result containing candidates, resolved names,
condition counts, and data-quality warnings. Discord formatting and dashboard
serialization consume that shared result so the two outputs cannot silently
use different scanner runs.

The digest creates the dashboard snapshot only after holdings analysis and the
scanner attempt finish. A scanner failure remains fail-soft for the holdings
digest but is recorded explicitly in the snapshot's data-quality warnings.
The dashboard must not fabricate an empty successful scan when the scanner was
unavailable.

The scheduled upload runs only for the pre-open digest. Its step fails visibly
when either credential is missing, the private access gate rejects the call,
the application rejects the token or payload, or storage fails.

## Snapshot Contract

Each snapshot contains:

- a schema version;
- the Riyadh trading date and generation timestamp;
- the delayed/daily data-status label;
- source and data-quality warnings;
- market regime;
- actionable holdings decisions;
- other holding changes, when available;
- scanner candidates meeting both research conditions;
- the count of one-condition candidates withheld from the home screen; and
- relevant budget context already produced by the digest.

Validation rejects missing required fields, non-finite numbers, invalid
timestamps, unsupported schema versions, malformed candidates, and candidates
that do not meet the required two conditions. Validation occurs before the
database write.

## Freshness Rules

Freshness is based on the Riyadh trading calendar and the expected pre-open
digest, not on a simple elapsed-hours threshold.

A successful pre-open snapshot stays current until the next expected
Sunday-through-Thursday refresh deadline. That deadline is 10:15 Riyadh time,
which gives the 09:45 scheduled job 30 minutes to start, calculate, and upload.
Before that deadline, the previous trading session's snapshot remains current
and visibly carries its original observation date. Friday and Saturday do not
make the most recent Thursday snapshot stale. If 10:15 passes without a valid
snapshot for that trading date, the stored snapshot becomes stale.

The API returns the snapshot together with a derived freshness state. The
browser displays that state but does not decide market-calendar freshness on
its own.

## Dashboard Behaviour

The cockpit has four explicit states:

1. **Loading:** the first snapshot request is pending.
2. **Current:** a valid snapshot exists and is within its freshness window.
3. **Stale:** the last valid snapshot is retained after a missed refresh.
4. **Unavailable:** no valid snapshot has ever been stored or storage cannot be
   read.

Current and stale views both display the snapshot's observation time and the
delayed/daily label. The stale view adds a prominent warning and disables all
research controls. The unavailable view explains that no verified daily
snapshot is available; it does not remain on an indefinite loading message.

Empty actionable, changed, or qualified lists render explicit neutral empty
states. The client component declares hooks unconditionally so the transition
from loading to a populated snapshot cannot change React's hook order.

The permanent safety language tells the user to verify the live broker price
before acting and states that the cockpit never submits an order.

## Research and Chat

Research routes load the latest stored snapshot and derive freshness on every
request. They accept a symbol only when it belongs to that snapshot's qualified
candidate list and the snapshot is current.

Stale candidates, unknown symbols, and symbols present only in the old preview
fixture are rejected. The report and chat receive the same stored candidate and
snapshot that the dashboard displayed. Existing owner checks, budget limits,
report caching, response validation, and informational verdicts remain in
force.

## Error Handling and Security

- Invalid ingestion never replaces the last valid snapshot.
- Missing D1 or an empty store produces an explicit unavailable response.
- Upload failures fail the workflow step and remain visible in its logs.
- The site remains restricted to its owner; no route is made public to enable
  automation.
- The hosting automation credential and application ingestion token are stored
  as secrets and sent in distinct headers.
- API errors contain useful user-facing categories without exposing secrets or
  internal stack details.
- Research failures do not hide the deterministic scanner information already
  present in a current snapshot.

## Testing

Focused Python tests cover structured scanner output, use of the same scanner
result for Discord and dashboard serialization, scanner-degraded snapshots,
and complete snapshot metadata.

Site tests cover schema validation, atomic latest-snapshot replacement,
calendar-aware freshness, weekend behaviour, empty and unavailable states,
the loading-to-current transition, stale research disabling, and rejection of
stale or unknown research symbols. Existing research response parsing and
budget tests remain part of the required suite.

Validation requires the existing Python tests, site tests, lint, and production
build to pass. A focused failure is reported separately from any broader check
that times out or cannot run.

## Rollout and Verification

After tests and the production build pass, publish a new private Sites version
without changing the existing access policy. Configure the automation access
credential alongside the existing ingestion token, then manually trigger one
digest run to bootstrap production data.

Completion requires evidence that:

- the workflow's cockpit-update step succeeds;
- the dashboard API returns a valid real snapshot with a Riyadh timestamp and
  delayed/daily status;
- the UI renders the snapshot after a refresh without a hook-order failure;
- the stored snapshot remains available on a second read;
- one current qualified candidate can open research; and
- stale and unknown candidates are rejected.

The prior Sites version remains available for rollback. A green deployment or
workflow alone is not sufficient evidence that the data reached the cockpit.
