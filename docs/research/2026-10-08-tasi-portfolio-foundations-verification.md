# Portfolio account foundations verification

Implemented locally on 2026-10-08/09 in the managed worktree
`C:\Users\NoteBook Pc\.codex\worktrees\tasi-portfolio-accounts\tasi-alert-system`.
Base: fetched `origin/main` at `781ab64`; approved spec and plan carried forward
in `756670a` and `60f6965`. Native execution was explicitly approved.
Local branch: `codex/tasi-portfolio-account-foundations`.

## Implemented scope

- Independent Al Rajhi/Al Ahli records, cash and holdings; reporting-only totals.
- Manual openings, variable deposits, withdrawals, dividends, fees, buys/sells.
- Immutable correction/void history and effective-time replay; statement comparisons
  report differences without changing balances.
- Owner-authenticated preview/confirmation and machine schema-2 book reads.
  Atomic account revision constraints and exact normalized operation retries.
- Account forms, explicit Riyadh times/fees, retained drafts, independent ledger
  loading, stale-refresh notices, dated valuation and account-specific P/L.
- Producer/Discord/copilot abstention from unconfigured company policy and sizing.
  Legacy records remain unassigned; old artifacts remain readable.

## Verification evidence

All checks use synthetic data or local files; no market/provider calls,
notification smoke tests, scheduled runs, production writes or deployments.

| Check | Evidence |
|---|---|
| `rtk npm ci` | Passed; no dependency changes |
| `rtk python -m compileall -q main.py movement.py session_gate.py runtime research` | Passed |
| Expanded current CI/release Python suite, including `research/test_entry_forecast.py`, `test_event_study.py`, `test_official_sources.py`, `test_company_evidence.py`, and `test_top10.py` | 431 passed; this includes all AGENTS checks |
| `rtk npm run lint` | Passed |
| `rtk npm run typecheck` | Passed |
| Final `npm test` through Task 5 completion command | Passed: build, 156 Node tests and 75 UI tests in 14 files; no unhandled errors reported |
| `rtk git diff --check` | Passed |
| Offline producer → JS parser | Passed twice after fixes: healthy 300/400 accounts and a damaged Al Rajhi account beside healthy Al Ahli; nullable combined cash, account error/revision, known/unknown cost, pending assessment and pending summary survived parsing |

The offline contract scenario used the existing `scripts/emit_sample_snapshot.py`
builder with a synthetic `buildPortfolioBook` input and the actual
`parseDashboardSnapshot` consumer. No generated root JSON was edited.

Focused tests cover competing withdrawal/buy revisions using real SQLite,
cross-owner and cross-broker isolation, exact/changed retries, backdated
correction replay, overspending/overselling, zero cash versus unconfirmed cash,
multiple deposits, sale fees and full exits, unknown cost, statement discrepancy
and match, reconciliation invalidation, same-time revision order, and Riyadh
month boundaries. UI checks cover preview before confirmation, failed saves,
draft preservation, changed operation IDs, missing snapshots, and failed refreshes.

An existing source-text trade test was replaced by rendered-form behavioral
coverage. An outdated refresh mock was made endpoint-aware. The final full web
rerun checks for unhandled errors as well as passing assertions.
The executed-trade retry check now uses the explicit `Retry confirmation` label
after an unavailable response; it still asserts the unchanged operation ID.

An intermediate lint run scanned generated dry-run JavaScript inside the plan's
scratch directory and failed there. That generated output was removed; retained
release bundles now live under the already-ignored `dist/` directory. An
intermediate concurrent full run also had UI timeouts. The final complete run
passed without changing test timeouts or production behavior for those failures.

## Review regression evidence

The initial reviewer supplied concrete findings before its usage-limit interruption.
A fresh independent reviewer completed the whole-change review on 2026-10-09.
Each confirmed defect was reproduced before its fix in a grouped local pass:

| Guarantee | Observed RED | GREEN evidence |
|---|---|---|
| Split sales equal one full exit | SAR 50.01 instead of SAR 50 realised gain | Core split-sale test |
| Calendar dates remain exactly as entered | February 30 silently rolled into March | Core timestamp test, including leap day and timezone |
| Native arithmetic remains representable | A finite huge opening yielded Infinity/null; accumulated totals, gross trade values and shares were unchecked | Core monetary/quantity precision tests, including a gross sale that fees could otherwise hide |
| A damaged broker remains separate | Error account lost its audit revision; malformed stored JSON aborted the whole book | Core parser and real SQLite store tests, including healthy append and exact retry |
| Refreshes update each account independently | A partial error refresh hid both the error and healthy broker's new balance | Rendered cockpit test also protects against a later stale healthy revision |
| An ambiguous save remains exactly retryable | Advancing the revision removed the confirmation control | Rendered form retry sends the identical original envelope |
| Pending policy preserves diagnostics history | Account-mode return skipped deltas, streaks and history writes | Producer test retains history while forbidding allocation/spend writes |
| Missing-price warnings use current holdings | Old config holdings were reported missing despite complete current-account data | Same producer test requires no false warning |
| Account P/L depends on the quote and own cost | Missing chart/rules hid supported P/L | Decision-view test retains P/L with a verified dated quote; stale/undated prices remain unavailable |
| Discord reports combined cash honestly | Combined reporting cash absent from `/portfolio` and `/budget` | Owner API tests cover SAR 700 and incomplete cash, with no spending pool |
| Discord can verify a signed actorless PING | Owner check rejected a valid PING with 403 | Signed PING/PONG, other-user rejection and invalid-signature rejection tests |
| A committed save remains retryable after readback failure | Actual SQLite insert committed, but the route returned 400 | API returns generic 503 for operational failure, real store exact retry remains revision 1, rendered form retries identical envelope after refresh |
| Combined company exposure aggregates brokers | One company appeared twice at 40% and 60% | Rendered combined view shows its full SAR 50 exposure at 100% |

Focused checks passed: 27 core tests, 11 decision-view tests, 27 UI/store tests,
and both targeted Python cases. The combined-total precision regression also
confirmed that a reporting total too large for native cents cannot hide either
individually supported account.

## Rulings

- Keep full average-cost precision through later sales, rounding displayed money
  and realised totals instead. The old calculator invented one cent of gain
  when selling a three-share position with SAR 100 total cost. Cost if wrong:
  consumers expecting an already-rounded average must format it for display;
  no investment policy or threshold was supplied.

- Include the additive account table in the existing protected migration export
  whitelist. This preserves access to the audit history through that path. Cost
  if wrong: the existing migration-token boundary covers one additional table.
  The export was neither enabled nor called.

- Reject monetary values or accumulated totals whose rounded cents are outside
  JavaScript's safe integer range. This is a storage/arithmetic support boundary,
  not an investment limit. Preserve individually valid accounts when their
  combined reporting total exceeds that range. Cost if wrong: supporting larger
  values requires an explicit decimal representation rather than native numbers.

- The earlier ruling kept independent review open after its usage limit instead
  of substituting author checks. That limitation is now resolved by a fresh,
  complete review. Cost of the original ruling was an additional review pass.

- Keep company suitability, entry and selling policy pending. The reviewer
  declined these investment choices because they are outside the approved
  slice. Cost: the foundations release cannot qualify a company or trade signal.

- Keep sizing, fee assumptions and concentration thresholds unconfigured.
  Reviewed policy choices are still required. Cost: no suggested quantities or
  policy-based concentration warnings in this release.

- Defer portfolio return methodology and review routines to their approved
  follow-on plan. The account history supports later work but does not select
  a return formula or delivery cadence. Cost: neither is supplied here.

- Keep broker-file parsers and batch imports deferred until real examples and
  their mapping contract exist. Manual records are the agreed first scope.
  Cost: account setup and statement comparison require manual entry.

- Use the configured Cloudflare cockpit as the release website. Live read-only
  GitHub variables and Discord configuration point to its machine gateway, so
  producer and Discord use the same cockpit D1. The separate legacy ChatGPT
  Site has its own database and no agreed synchronization contract. Cost:
  this release does not update or synchronize that legacy Site.

- Keep live deployment, delivery qualification and real balances unverified
  until the release is explicitly executed. Dry runs and synthetic tests cannot
  prove deployed credentials match or broker data is correct. Cost: authorized
  deployment and owner smoke checks remain release operations, not code work.

## Deferred minors

None. The earlier Discord combined-cash minor and the fresh review's
combined-exposure minor are both fixed with observed RED-to-GREEN regressions.

## Review and release boundary

Fresh independent whole-change review completed against `781ab64..9a5a83f`.
It reported no Critical findings, one Important operational-save ambiguity,
and one Minor combined-exposure presentation issue. Its 62 bounded offline
checks passed, and its verdict was ready to merge/deploy after the Important
fix and regression checks. Both findings are fixed in `a7ed8d2`, with 12/12
focused API/store/form checks, 30/30 core/Discord parser checks, lint and
typecheck passing. As required by the execution method, tests verify the fixes;
there is no author-substituted verdict or repeat review loop.

The complete release preparation and exact deployment commands are recorded
in [the deployment record](2026-10-09-tasi-foundations-deployment-readiness.md).

The original checkout remains on `codex/tasi-portfolio-decision-support-spec`.
Its pre-existing changes remain untouched: `top10_draft.json`, `AGENTS.md`,
`docs/research/2026-09-04-tasi-top10-evidence-refresh.md`, and
`research/company_evidence_draft_2026-09-04.json`.

This is account foundations only. Financial-strength criteria, company-case and
entry policies, signal evaluation, qualified sizing/fee assumptions,
concentration warnings, portfolio return methodology, routines, broker-file
adapters and live qualification are deferred. Real account inputs are not
populated. No push, merge, production D1 migration, deployment, command
registration, notification delivery or schedule activation was performed.
