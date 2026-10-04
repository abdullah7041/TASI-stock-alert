# Verification repair operations

## Disabled producer pulse ingestion

Session jobs collect their existing observations, but publish to the cockpit only
when the repository variable `TASI_PULSE_INGESTION_ENABLED` is exactly `true`.
An absent or different value produces `pulse_ingestion=disabled` in the job
summary and sends no pulse ingestion request. Enabling this variable requires
separate owner authorization. It is independent of the shadow Worker's
`TASI_PULSE_PUBLICATION_ENABLED=false` boundary.

A disabled step is not proof that the ingestion endpoint works. Before any
authorized activation, trace the prior HTTP 404 through deployed Access, the
machine gateway and cockpit route, then verify authenticated ingestion.

## Register only Discord /ask

Configure `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN` securely in the process
environment. Set `DISCORD_GUILD_ID` for the intended server; omitting it selects
global scope, which must be an explicit owner choice. Never paste the token into
source, documentation or a command argument.

Run `npm run discord:register` only after inspecting the existing registrations
and confirming the destination. It uses Discord's single-command POST to upsert
`ask`; it does not bulk-replace the command list or register ledger commands.
See [Discord's application command documentation](https://docs.discord.com/developers/interactions/application-commands).

Verify the registered command by GET at the same application/scope. Registration
does not prove signed interactions work. With separate authorization for one
configured-model call, capture temporary live logs while the owner sends one
`/ask`; reconcile signature validation, acknowledgment, upstream processing and
actual reply. Do not enable historical observability merely for this test.

## Regime and forecast

The regime requires 52 usable completed daily index bars for a 50-session moving
average and its direction. Messages now report that threshold; no data gate was
weakened. Provider failure or insufficient history keeps it unavailable.

Forecast remains unavailable pending survivorship-complete point-in-time history
and every offline gate. Passing research metrics alone does not release a live
point-in-time forecast generator.
