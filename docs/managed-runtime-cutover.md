# Managed runtime cutover (Stage 2)

The code for the managed runtime is committed and tested offline. Nothing in
GCP has been provisioned by this change, and no schedule has been moved. This
document is the sequence to follow when you do provision it.

## What is committed

| Piece | File |
| --- | --- |
| Session and holiday gate | [session_gate.py](../session_gate.py), [market_holidays.json](../market_holidays.json) |
| Durable claim / cooldown / delivery / health state | [runtime/state.py](../runtime/state.py) |
| Cloud Run Job entrypoint and telemetry | [runtime/job.py](../runtime/job.py) |
| Container image | [deploy/Dockerfile](../deploy/Dockerfile) |
| Schedules, secrets, shadow-mode flag | [deploy/cloud-scheduler.yaml](../deploy/cloud-scheduler.yaml) |
| Manual-only Discord smoke and recovery runs | [.github/workflows/manual-operations.yml](../.github/workflows/manual-operations.yml) |
| Offline tests for all of the above | [test_runtime.py](../test_runtime.py) |

## Invariants the tests hold

- Every schedule is `Asia/Riyadh`; digest 09:40 Sun–Thu, session every 10
  minutes 10:00–14:50, reconciliation 15:10.
- `TASI_DELIVERY_ENABLED` ships as `"false"`. Delivery and cockpit ingestion are
  both off unless it is exactly `"true"`.
- The session gate is authoritative: an invocation on a weekend or a recorded
  holiday records a health row, sends nothing, and exits 0.
- An alert is delivered only by the job that won a transactional claim on its
  deterministic event ID. A failed send releases the claim so a retry can send;
  a successful send is never repeated.
- No Google Cloud dependency reaches `requirements.txt`, so the GitHub fallback
  and the CI Python job keep working without credentials.
- `tasi.yml` still carries the digest and session cron. Removing them is a
  deliberate cutover step, not a side effect of this change.

## Before you provision

1. Confirm GCP billing and the 20–100 SAR/month budget are still current.
2. Create the four secrets in Secret Manager with the names in
   `deploy/cloud-scheduler.yaml`. Keep the Sites bypass token and the app
   ingest token as separate secrets; they authenticate different things.
3. Record known Tadawul closures in `market_holidays.json`.

## Sequence

1. Build and push the image, create the Cloud Run Job, and create the three
   Cloud Scheduler jobs from `deploy/cloud-scheduler.yaml`.
2. **Shadow mode, two trading days.** Leave `TASI_DELIVERY_ENABLED=false`.
   GitHub keeps delivering. Confirm from the structured logs that each run
   started within two minutes of its scheduled time, that event IDs do not
   repeat, and that the pre-open digest never went missing.
3. **Cut over.** Disable the digest and session `schedule:` entries in
   `tasi.yml` first, confirm no GitHub run is in flight, then set
   `TASI_DELIVERY_ENABLED=true`. In that order: the reverse order double-posts.
4. **Acceptance.** Five consecutive trading days with starts within two minutes
   of target, no duplicate event IDs, and no missing pre-open digest.

## Rollback

- **Runtime:** pause the Cloud Scheduler jobs and re-enable the `tasi.yml` cron.
  Firestore records stay intact; the claim history is what keeps a resumed
  GitHub run from re-sending an alert the managed runtime already delivered.
- **Sites:** redeploy the previous private version. Do not delete D1 data — the
  cockpit reads legacy alerts through the name normalization added in Stage 1.

## Still out of scope

Forecast stays unavailable until its validation gates pass, and Top 10 remains
evidence-pending and approval-gated. Research and Top 10 jobs stay on the
GitHub schedule until their reviewed-evidence storage is migrated.
