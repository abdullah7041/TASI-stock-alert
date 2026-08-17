# Discord Smoke Delivery Design

**Date:** 2026-08-18
**Status:** Approved for planning

## Problem

A manual `run` workflow is intentionally alert-only: it posts to Discord only
when a new unusual delayed-price movement is detected. When there is no new
movement, it exits successfully without attempting delivery. That makes it a
poor webhook test, particularly outside the market session. In addition,
`mode_run` currently returns success even when a real movement message fails to
send, allowing a false-green GitHub Actions run.

## Goals

- Provide a clearly named, manually triggered Discord delivery smoke test.
- Send one short, unmistakably labelled test message without collecting market
  data or changing cockpit, alert, portfolio, or research state.
- Make a failed Discord delivery fail both the smoke test and a real movement
  alert run.
- Keep the delayed-data, broker-owned real-time safety boundary unchanged.

## Non-goals

- Do not change scheduled digest timing, movement thresholds, or alert rules.
- Do not add broker integration, trade execution, dashboard ingestion, or a
  new Discord notification type for normal runs.
- Do not delete or alter prior dashboard or alert records.

## Chosen Approach

Add a `discord-smoke` mode beside the existing workflow modes. It will call a
small, dedicated function that sends a timestamped message stating that it is
a delivery test, contains no prices, uses no market data, and creates no order.
It returns a non-zero process result if the webhook rejects or cannot deliver
the message.

The existing `run` mode remains alert-only. When it generates one or more new
unusual-movement alerts, it will return success only if `send_discord` succeeds;
otherwise it will return failure. When no alert is generated it continues to
complete successfully and logs that no delivery was attempted.

## Workflow Behavior

`workflow_dispatch.inputs.mode` will list `discord-smoke` with the other
modes. The manual routing continues to pass the requested value through as
`MODE`. There will be no scheduled cron route to this mode.

The smoke mode will not create `dashboard.json` or `movement_alerts.json`, so
the existing dashboard-ingest and delayed-alert-ingest workflow steps will not
run. The existing state-commit step remains harmless because no state file is
changed by this mode.

## Message Contract

The smoke message will be a single plain Discord post, for example:

> TASI Discord delivery smoke test - 2026-08-18T00:00:00Z. No market data,
> dashboard update, alert, or order was created.

The exact timestamp is generated at execution time. The label allows users to
distinguish the test from the daily digest and from unusual-movement alerts.

## Error Handling and Observability

- Successful send: print `discord smoke sent: True` and return zero.
- Failed send: print `discord smoke sent: False` and return one.
- Real movement alert send failure: print the existing delivery status and
  return one.
- No movement: print `no new unusual movement; nothing sent.` and return zero.

GitHub Actions therefore remains green only when it either deliberately had no
message to send or when a required webhook delivery succeeded.

## Tests

Add focused unit tests that mock the notification sender:

1. Smoke success calls Discord exactly once with a test-only message and exits
   successfully.
2. Smoke failure exits non-zero.
3. `run` exits successfully when it detects no movement and does not call
   Discord.
4. `run` exits successfully when movement is detected and Discord succeeds.
5. `run` exits non-zero when movement is detected and Discord fails.
6. Workflow validation confirms `discord-smoke` is a dispatchable mode and has
   no scheduled route or cockpit-ingest side effect.

## Acceptance Criteria

- A manual `discord-smoke` run sends exactly one labelled, non-market message
  to the existing Discord channel.
- The same run fails visibly if delivery cannot be confirmed.
- A manual `run` with no new unusual movement remains silent and successful.
- A real alert delivery failure turns the run red.
- No dashboard ingest, delayed-alert ingest, portfolio change, broker action,
  or scheduled behavior changes as part of the smoke test.
