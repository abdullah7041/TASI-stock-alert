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
| `rtk python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` | 391 passed after the review fixes |
| `rtk npm run lint` | Passed |
| `rtk npm run typecheck` | Passed |
| `rtk npm test` | Passed: build, 156 Node tests, 69 UI tests in 14 files; no unhandled errors reported |
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

## Review regression evidence

The reviewer supplied concrete findings before its usage-limit interruption.
Each confirmed defect was reproduced before its fix in one grouped local pass:

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

- Keep the independent-review gate open and retain its local scratch evidence.
  The fresh reviewer stopped at a usage limit before a final graded verdict;
  author-run regression checks cannot supply that verdict. Cost if wrong:
  further independent findings may remain before integration.

## Deferred minors

- Discord portfolio/budget text shows independent broker balances but omits a
  combined reporting cash total. The cockpit supplies that labelled total.

## Review and release boundary

Independent whole-change review was dispatched on the fresh review context.
It returned the concrete findings addressed above, then stopped at a usage limit
before delivering final severity grades or a complete verdict. No clean-review
claim is made, and Task 5's review checkbox remains open. The partial review
package and scratch evidence are retained locally; no second reviewer was run.

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
