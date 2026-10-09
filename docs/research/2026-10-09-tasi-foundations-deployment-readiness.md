# Account foundations deployment readiness

Prepared 2026-10-09 on `codex/tasi-portfolio-account-foundations` in the isolated
managed worktree. Approved scope: account foundations, private manual records,
reconciliation and reporting. Independent review completed; every confirmed
Important and Minor finding was reproduced and fixed. Final validation is
recorded in [the verification report](2026-10-08-tasi-portfolio-foundations-verification.md).

## Deployment targets

| Component | Configured target | Preparation evidence |
|---|---|---|
| Website | `tasi-action-cockpit`, `https://tasi-action-cockpit.ronaldinho1415.workers.dev` | GitHub `COCKPIT_PUBLIC_URL`; production Cloudflare build and bundle dry run |
| Machine gateway | `tasi-machine-gateway`, `https://tasi-machine-gateway.ronaldinho1415.workers.dev` | GitHub `COCKPIT_ORIGIN`; service binding to the cockpit; bundle dry run |
| Discord interactions | `tasi-discord-interactions` | Proxy origin points to that gateway; bundle dry run; raw Ed25519 signature and private forwarding tests |
| Python producer / Discord digest | Existing repository runtime in `abdullah7041/TASI-stock-alert` | Current CI/release Python checks, producer-to-cockpit parser contract and offline account scenarios |

The website, Discord proxy and producer converge on the cockpit D1 binding
`DB`, database `tasi-action-cockpit` (`f0a9722e-ed78-4c3a-ba7f-e28a21377440`).
The legacy `tasi-action-cockpit.busaud7041.chatgpt.site` is a separate deployment
and database; it is excluded from this release. No synchronization is implied.

Read-only secret inventories confirmed these existing names, without reading
values: cockpit `DASHBOARD_INGEST_TOKEN`, `DISCORD_OWNER_USER_ID`,
`MACHINE_RELAY_SECRET`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`; Discord proxy
`COCKPIT_ACCESS_CLIENT_SECRET`; gateway `MACHINE_RELAY_SECRET`,
`GITHUB_ACTIONS_TOKEN`; producer's existing cockpit access/ingest secrets,
`DISCORD_WEBHOOK_URL` and model-provider secrets. Presence does not prove the
values match; that requires an authorized deployed request. No new secrets,
credentials, providers, dependencies or infrastructure were introduced.

## Prepared release sequence

These are operator commands for an authorized release, not actions performed
during preparation. Run from the implementation worktree or the integrated
revision with installed locked dependencies. Integrate the branch before
scheduled producer jobs can use its Python changes.

1. Deploy the cockpit using `rtk npm run deploy:cloudflare`. This rebuilds with
   `wrangler.cloudflare.json`; do not deploy the default `npm test` build, which
   uses the separate hosting profile. Existing Cloudflare Access and private
   owner boundaries remain in place.
2. Deploy the Discord proxy with
   `rtk proxy npx wrangler deploy --config discord-interactions/wrangler.jsonc`.
   Its configured gateway is already canonical. Existing gateway source is
   unchanged by this slice; no gateway deployment or cron update is required.
3. Release the matching producer revision through the existing approved GitHub
   workflow. This preparation did not dispatch a workflow or activate delivery.
   Existing schedules, provider settings and publication gates remain unchanged.

The additive `portfolio_account_records` schema and indexes are created by
the existing idempotent `PortfolioStore.ensureReady()` path at first portfolio
access. Legacy `portfolio_events` rows are retained unassigned. There is no
backfill, inferred broker mapping, root JSON edit or destructive migration.
Opening snapshots must use actual owner-confirmed broker figures after release.

Existing Discord command registrations suffice for `/portfolio` and `/budget`;
both report independent balances and combined cash as reporting only.
`/bought` and `/sold` direct the owner to cockpit recording until a separately
approved command contract supplies the broker and actual fees. This preparation
did not call registration APIs. Signed actorless PING verification is supported;
commands still require the configured owner.

## Local packaging evidence and release checks

`rtk npm run build:cloudflare` and Wrangler 4.92.0 `deploy --dry-run` passed for
cockpit, Discord proxy and gateway. The cockpit package includes the intended
production DB binding and generated assets. Dry-run output is local packaging
evidence, not a deployment or confirmation of live delivery. Final packaging
was refreshed after the final default-profile test build. The final cockpit
package is 1540.37 KiB (340.66 KiB gzip), Discord 5.71 KiB (2.00 KiB gzip),
and gateway 2.31 KiB (1.12 KiB gzip); all three exited successfully in dry-run
mode. The deployable production config/assets remain in `dist/server/` and
`dist/client/`, with local packaging output in `dist/deployment-readiness/`.

After authorized deployment, the owner must verify private website access,
other-user rejection, signed PING/PONG, `/portfolio` and `/budget`, and the
producer's schema-2 read/ingest using the same owner/book. Use genuine broker
data only with owner approval: preview is read-only; confirmation records
activity and never places an order. Compare before/after revisions, exact retry,
independent balances and an incomplete-account state. Do not send a live digest
or enable a scheduler merely to run these checks.

Rollback retains both account and legacy tables and immutable audit records.
Coordinate cockpit and producer revisions: older producer code does not
understand the new account book and cannot be assumed to report it safely.
Review the owner read and notification behavior before resuming delivery on a
previous revision. Never delete or relabel account records as a rollback step.

Company policies, sizing/fees, concentration thresholds, portfolio returns,
review routines and broker-file imports remain tracked follow-on work. No new
investment policy or live signal qualification is claimed by this release.
