# Portfolio account foundations verification

Implemented locally on 2026-10-08/09 in the managed worktree
`C:\Users\NoteBook Pc\.codex\worktrees\tasi-portfolio-accounts\tasi-alert-system`.
Base: fetched `origin/main` at `781ab64`; approved spec and plan carried forward
in `756670a` and `60f6965`. Native execution was explicitly approved.

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
| `rtk python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` | 390 passed after formatter guard |
| `rtk npm run lint` | Passed |
| `rtk npm run typecheck` | Passed |
| `rtk npm test` | Build + 149 Node + 67 UI tests passed after cost-precision regression; subsequent export-whitelist check passed 3/3 |
| `rtk git diff --check` | Passed |
| Offline producer → JS parser | Passed: schema-2 book produced a schema-3 digest; separate 300/400 cash, unknown/known cost, pending company assessment and pending summary survived parsing |

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

## Review and release boundary

Independent whole-change review is pending. Findings and their regression
checks will be recorded here before completion.

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
