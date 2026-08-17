# Sites production release runbook

GitHub merges never publish this private Sites application automatically. Use this runbook for every approved production release.

1. Run `Sites release readiness` with the exact `origin/main` commit. Download its seven-day `sites-release-<sha>` artifact and keep `sites-release-manifest.json` with the release record.
2. Read the current Sites project and record its live version ID and commit before making any change. This is the rollback reference.
3. Set the Sites runtime environment variable `DEPLOYED_COMMIT_SHA` to the exact manifest commit. Do not place ingestion secrets or source credentials in the repository.
4. Save a Sites version using only the readiness archive, then publish that saved version. Record the project, previous-version, new-version, deployment, commit, and archive-hash identifiers together.
5. Run `Sites production smoke` with the same commit. It verifies `/api/health`, runs `cockpit-refresh` without Discord, posts only the safe snapshot, then verifies `/api/dashboard` schema version 2, Riyadh trade date, freshness, and its separately composed `alerts` array.
6. Wait for the next normal scheduled digest and inspect its GitHub job summary for the recorded scheduled-versus-actual timing and successful Discord delivery. Do not use the smoke workflow to send a Discord message.

Rollback is a deployment action, never a data deletion. The compatibility release keeps the older v1 dashboard data under `latest` and v2 data under `latest-v2`. If smoke fails, deploy the recorded prior Sites version; it continues to read `latest`. Do not overwrite or delete either snapshot during rollback.

The broker app remains the real-time alert and order path. The smoke workflow, cockpit refresh, and dashboard controls never submit a broker order or send Discord.
