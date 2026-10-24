# Holdings secretary verification and staged release

Implementation branch: `codex/tasi-holdings-secretary`, created from fetched
remote main `630f359` in an isolated managed worktree. The original checkout
and its existing edits were not changed. Later remote updates through
`d6ade97` contain generated state only.

## Implemented behavior

The Assistant stores a confirmed investor profile outside conversation history,
maintains one immutable company-case history across brokers, and shows each
broker's confirmed position separately. Missing or damaged accounts require
setup. No configuration holdings are substituted. Profile/case confirmation
uses revision checks and stable operation IDs, preserves history, and cannot
write portfolio balances or trades.

Official checks are wired for 08:15 and 15:30 Riyadh Sunday–Thursday. The
existing 08:30 digest, backstop, reconciliation and gateway pre-open trigger
remain intact. Every attempt has a receipt distinguishing content, empty and
failed checks. Replays cannot replace newer queue corrections. Source dates
remain separate from retrieval dates; unmatched announcements stay unassigned.

Confirmed cases receive provisional reviews when relevant evidence content
changes. Retrieval-only changes reuse reviews. Financial interpretations
require reviewed source content; announcement titles provide research notices.
Model action validation permits only WATCH/RESEARCH_MORE. Owner-authored manual
decision notes retain their existing choices. Budget/provider failures remain
visible, failed reservations are released, and terminated claims can recover.
Reviews retain profile/case/evidence revisions and the account context used.

The complete announcement queue remains available. Review context includes at
most 30 recent notices with an explicit omitted count. Published source dates
determine the subset rather than the latest retrieval time. This bounds stored
lineage and provider input without claiming complete coverage.

## Local evidence

All commands ran against the final implementation. The later workflow status
and branch-handling regressions both failed before their fixes, then passed
with the 45-test runtime/source suite. GitHub CI also passed for implementation
revision `0ea5d4a` (Python, web and fresh producer contract).

| Check | Observed result |
| --- | --- |
| Python compile of main/movement/session/runtime/research | Passed |
| Documented pytest suite plus official-source regressions | 404 passed |
| Additional CI entry-forecast/event-study tests | 31 passed |
| Web lint and TypeScript | Passed |
| Full npm test, including build | 160 Node + 128 UI tests passed |
| Fresh current-producer artifact parsed by cockpit | 4 passed |
| Cloudflare production build | Passed |
| Cockpit and gateway deployment dry runs | Passed |
| Patch integrity | Passed |

Two independent reviews found six important issues, all reproduced and fixed:
retrieval-only AI charges, expired request claims, generated action-schema
restrictions, announcement growth, concurrent profile refresh, and older
collection replay. Deterministic coverage also includes missing/damaged broker
records, both brokers owning the same company, conflicting confirmations,
unsupported citations, source outcomes, model/provider errors, idempotency,
notification retries/deduplication, keyboard use and reload persistence.

## Live evidence and remaining qualification

Stage 1 deployed using the production build with existing configuration and
secrets retained:

| Component | Deployed version |
| --- | --- |
| tasi-action-cockpit | `8eeec855-466b-496e-b552-2768c17b117e` |
| tasi-machine-gateway | `5637d9b4-441c-497e-9b12-1a8c99fedebb` |

The gateway retains `20 5 * * SUN-THU`. Scheduled review generation and
after-close review delivery remain disabled: `HOLDING_REVIEWS_ENABLED` is
absent. The producer workflow changes require integration into main before
their revised schedules become active.

A read-only live D1 check found zero confirmed broker account records. The
agent did not create broker openings, confirm the owner profile, or confirm
an investment case to manufacture qualification evidence.

A local live collector attempt at `2026-10-23T11:14:27Z` returned 95 official
announcement notices with run ID `18c9351b-e3df-4199-aea8-3b61d8e12387`.
This proves collection, not authenticated ingestion, complete company coverage,
review generation or Discord delivery. Its generated artifacts remain in
ignored verification scratch. The tracked queue was restored afterwards.

Authenticated collection ingestion, summary access and generated state
persistence passed in the existing `research-evidence` workflow
[run 39945608414](https://github.com/abdullah7041/TASI-stock-alert/actions/runs/39945608414)
on 2026-10-23. It collected and ingested 95 notices, read the saved summary,
and committed the generated queue/receipt/archive as `7a66f41`. The saved
receipt is `bf6458e9-2799-4074-b00c-4d800c7a1dbc`, attempted at
`2026-10-23T11:23:04Z`. Generation and review-delivery steps were skipped by
the disabled switch. A separate read-only D1 query also confirmed durable
collection storage. Source/review/notification status remain separate.

The first qualification attempt had already ingested successfully before its
state-commit step failed: shallow feature history was rebased onto main. The
workflow now fetches complete history and synchronizes its actual checked-out
branch, preserving the existing main behavior and the digest guard's main
checkout. The successful rerun above verifies that repair end to end.

Discord accepted one clearly labeled synthetic smoke message in
[run 39945226324](https://github.com/abdullah7041/TASI-stock-alert/actions/runs/39945226324)
(`discord smoke sent: True`). That initial job subsequently hit the same
state-commit failure. Delivery itself succeeded and was not repeated. This
qualifies the existing webhook transport, not a real holding-review notice or
proof that the owner read a message.

Unauthenticated checks received HTTP 302 at the owner API's sign-in boundary
and HTTP 403 at the machine gateway. Owner browser verification was not
established: browser automation could not attach to the cockpit tab.

After genuine broker setup and owner confirmation of the profile and at least
one company case, verify a provisional review, reload/persisted lineage, exact
retry without an additional charge, and real Discord delivery independently.
Only then enable `HOLDING_REVIEWS_ENABLED=true`. A successful build or collection
does not satisfy those gates.

## Rollback

Keep the generation variable disabled first. Restore the previous Worker
versions if necessary: cockpit `ae80698e-e503-4324-b1c5-f8d3175f04e0`, gateway
`642276a9-293a-475a-abfa-0467a3175f80`. Coordinate producer workflow rollback
with the deployed API version. Preserve the existing portfolio tables,
`holding_secretary_entries`, evidence history and collection receipts.
Worker rollback does not roll back D1 data; no rollback step deletes or edits
confirmed portfolio records or company-case history.
