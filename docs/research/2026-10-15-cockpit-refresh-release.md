# Cockpit refresh production release

The owner approved publishing the concrete preview on 15 October 2026.

- [Refresh PR #27](https://github.com/abdullah7041/TASI-stock-alert/pull/27)
  merged as `903c6600e99438c7f7ce3212ef047f1ec6b787b7`.
- [CI on the merged commit](https://github.com/abdullah7041/TASI-stock-alert/actions/runs/38787336696)
  passed Python, web and current-producer contract jobs.
- The canonical Cloudflare build deployed to the existing
  [cockpit](https://tasi-action-cockpit.ronaldinho1415.workers.dev/), version
  `995c783c-014f-4d26-a421-77393abf7362`. The deployed commit binding matches
  `903c6600e99438c7f7ce3212ef047f1ec6b787b7`.
- Rollback reference: prior Worker version
  `18d381bd-1a0d-4bc5-b57d-02f6e696bfe8`; prior producer main `194a5fc`.
  Rollback must preserve portfolio data and newer generated state.

## Live qualification

The authenticated production browser shows the new views and account setup
states. Both broker opening snapshots remain unconfirmed; no balances or
holdings were invented or recorded by this release.

[Approved one-time digest run](https://github.com/abdullah7041/TASI-stock-alert/actions/runs/38787529047)
completed successfully on the released producer commit. It sent one embed,
ingested the canonical artifact with HTTP 200 and recorded Discord delivery.
The browser's Data status shows Producer, Discord and Cockpit all confirmed.

Artifact: `sha256:1d5e3926312499913e8a3aedba1c2019f90a2c48254d87c4cadc3c8bf63d2e90`.
Saved at `2026-10-15T18:41:24Z` (21:41 Riyadh); actual quotes dated
`2026-10-14`, matching its explicit expected session. These are delayed quotes.

![Live overview](assets/cockpit-live-overview.jpg)

The bounded live Assistant question failed with an explicit OpenRouter HTTP
401. The owner is replacing the existing Worker secret through Wrangler's
interactive prompt; no credential is requested in chat or written into source.
Assistant success is not yet claimed. The producer's optional Gemini perspective
also returned an upstream 503; dated facts and delivery remained available.

## Screening coverage follow-up

Live source verification returned one adjusted bar for the configured `^TASI.SR`
one-year history, with no calculable 60-day return. The producer previously
treated every non-empty index response as available, causing a misleading empty
shortlist. This is a data-state bug, not evidence that no company qualified.

The producer now checks the existing scanner feature calculation for a valid
60-day return. The cockpit also recognizes explicit insufficient-bar warnings
in older artifacts that carried the incorrect flag. A regime warning with 90
bars does not disable screening solely because the longer regime calculation
is unavailable.

Regression verification observed the Python one-bar case and two UI cases fail
before the fix. The Python cases for 1/60/61 bars and four UI availability cases
then passed. No index history, policy, schedule or credential was fabricated.

## Final qualification, rechecked 17 October 2026

- [Coverage PR #28](https://github.com/abdullah7041/TASI-stock-alert/pull/28)
  merged as `ef0bfd10b63d5c11f4d7bf208b1db037c5d5e277`.
- [CI on the merged coverage commit](https://github.com/abdullah7041/TASI-stock-alert/actions/runs/38789818386)
  passed. The PR run recorded 428 Python tests, 160 Node tests, 87 UI tests
  and four fresh-producer parser checks. The local Python run including the
  additional refresh regressions passed 436 tests.
- The canonical build deployed Worker version
  `e0051c60-2218-4493-bfe4-13c4ac303e11`. Authenticated health returned the
  matching `ef0bfd10b63d5c11f4d7bf208b1db037c5d5e277` commit and database ready.
- The live Research view now says: "Screening unavailable: a required data source
  is missing. Review data status." It does not claim a valid empty shortlist.
- The live Portfolio view loads independent brokers and the opening-snapshot
  form. A company detail dialog loads its delayed chart, dated sources and
  explicit unavailable AI perspective. No real portfolio write was performed.
- Anonymous portfolio access returned HTTP 302 to authentication. The access
  boundary, existing D1 database and owner records were preserved.
- No additional Discord message was sent for the coverage fix. The approved
  single-embed digest and authenticated receipt above remain the delivery proof.

![Confirmed production delivery](assets/cockpit-live-delivery.jpg)

The Assistant was retested on 17 October and still returned OpenRouter HTTP 401.
It is not functional until its configured key is replaced. The owner can enter
the replacement in Wrangler's hidden interactive prompt, without putting the
value in chat, source, command arguments or command history:

```powershell
cd 'C:\Users\NoteBook Pc\.codex\worktrees\tasi-cockpit-refresh\tasi-alert-system'
npx wrangler secret put OPENROUTER_API_KEY --config wrangler.cloudflare.json
```

After the owner confirms the update, perform one bounded Assistant question and
verify a saved reply. Do not rotate unrelated credentials or copy keys from
other projects. Both broker opening snapshots and reviewed company evidence
also remain user inputs; release approval does not supply those facts.

The original checkout's unrelated changes remain unchanged. The final report
and screenshots are saved in the implementation worktree; runtime code for both
PRs is merged and deployed.
