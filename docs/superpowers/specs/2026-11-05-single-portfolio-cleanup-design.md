# One saved portfolio and useful data status

Date: 2026-11-05, Riyadh. Approved by the owner on 2026-11-07.

## Intent and decisions

The owner wants one portfolio, with no account setup, broker selector, broker
forms, or repeat upload. Reuse the saved holdings and recorded activity already
present in the system. Top 10 remains in Research. Make Data status concise and
useful while retaining dated evidence and explaining real gaps.

The owner selected direct reuse of existing portfolio history over copying
positions into another store. This supersedes the earlier broker-foundations
requirement in the 2026-10-08 design and the broker-dependent parts of the
2026-10-22 holdings-secretary plan. Other secretary safeguards still apply.

## Current behavior and verified records

`PortfolioStore.view()` and `foldPortfolio()` already project the owner-scoped
`portfolio_events` ledger. The newer `book()` wraps that history as unassigned
and exposes two empty broker accounts. The cockpit, company-case eligibility,
producer and Discord reads use those empty accounts, hiding saved positions.

Remote main `796eeb3` contains a dashboard saved on 2026-11-04. Its embedded
history includes opening positions in EIC, Al-Babtain and Rasan, followed by a
sale of all 104 EIC shares on 2026-09-27. Folding that history leaves Al-Babtain
(2320), 12 shares, recorded average cost SAR 64.26, and Rasan (8313), 11 shares,
recorded average cost SAR 107.45. These are historical saved records, not a
claim about today's broker balances. `config.py` still contains EIC and must
not supply holdings or replace an unavailable ledger.

## Approaches

1. **Selected: reuse the existing ledger and fold.** One source for holdings,
   completed activity and secretary context; no data copy or new opening setup.
   Requires changing the callers currently bound to broker accounts.
2. **Copy a snapshot into new portfolio storage.** Gives a new baseline but
   duplicates records, needs migration/deduplication and risks losing sales or
   diverging from later transactions. Rejected as unnecessary.

## Scope and constraints

Use the existing React/Worker/Python stacks, database, authentication, AI budget,
providers and official-source collector. No new dependencies or portfolio store.
Remove account concepts from the active product flow and default profile text.
Retain historical database rows and confirmed profile/case/review revisions.
No automatic trades, quantities, numerical risk thresholds or strength scores.
No performance-reporting project or broker-file importer. Provider outages and
missing index data cannot be fixed by changing their labels.

## Portfolio authority and API contract

The authenticated owner's stored events are the authority. Reuse
`PortfolioStore.events()` / `view()` and the existing fold; do not seed from
configuration, hardcode the two companies, import the dashboard into D1, or
create another opening balance. This request authorizes displaying the existing
saved history without a new holdings-confirmation ceremony.

Return one validated portfolio projection plus its record count, last recorded
time and an explicit read status from the owner endpoint. The producer's
machine-authenticated endpoint exposes the same projection, retaining sole-owner
resolution and rejection of ambiguous ownership. Version the response if its
shape changes; update both producer and web parsers in the same release.

A successful empty ledger, an invalid ledger and a failed read remain distinct.
An authoritative empty result never falls back to configuration or an older
snapshot. During a failed refresh the UI may retain its last validated result,
with the original date and a visible failure notice. On initial load an existing
dashboard's validated embedded legacy events may provide a dated, read-only
fallback; they cannot authorize writes or machine review generation. Missing
history renders an unavailable state, not account setup or an invented zero.

Cash and costs come only from valid recorded events. Show ledger cash as
recorded cash with its date, not verified current buying power. Unknown fields
stay unknown. Reusing history never enables old fixed-budget allocation or
trade sizing: policy remains unconfigured independently of account-book mode.

No destructive migration is required. Historical broker records and endpoints
can remain for compatibility without appearing in navigation. Before release,
verify that this owner's broker-record table is still empty. If it contains
records, stop that release step and reconcile them explicitly; never silently
ignore, combine or duplicate them with the older ledger.

## Product behavior

Overview and Portfolio display the same saved holdings, recorded cash and date.
Remove account panels, setup calls to action, broker names and account-specific
empty-state instructions. Portfolio retains saved transaction history, including
the EIC sale. Keep manual completed-activity recording available against the one
ledger, reusing existing event validation and preview/confirm behavior where
applicable. Retain positive whole-share checks, explicit trade fees, cash and
oversell checks, same-origin protection, conflict handling and stable operation
IDs. Identical retries cannot add another event; changed payloads cannot reuse
an operation ID. Background jobs and case confirmation cannot write trades.

Assistant takes eligible companies from this same owner ledger, so missing
broker openings no longer block a case. Investor-profile and company-case
confirmation remain explicit. Update the proposed default strategy to one
portfolio; never silently rewrite an already confirmed profile. New reviews
record portfolio provenance (source, record revision or digest, dated position)
instead of requiring broker assignments. Existing reviews with broker context
remain readable as historical records without rewriting their stored payloads.
Review caching, evidence-change checks, action restrictions, budget cleanup and
acknowledgement remain intact. Unrelated ledger changes must not trigger new AI
charges. Any retained review clearly shows the position context it used.

The producer, morning brief and existing Discord portfolio reads use the same
saved holdings and stop asking for broker setup. Keep legacy Discord trade
commands disabled unless already supported safely; this change adds no command
registration. Preserve the 08:15/15:30 Riyadh Sunday-Thursday source checks,
08:30 brief and after-close reconciliation. Do not enable scheduled holding
reviews merely as part of this cleanup.

## Data status and Research

Use existing snapshot/source fields, not a second health-monitoring system.

- Prices: retain individual quote dates and snapshot time; distinguish stale,
  missing and usable dated quotes. A refresh does not relabel old prices.
- Sources: distinguish not collected, failed, successfully empty, partial and
  content supplied. Show relevant failures plainly and keep evidence links and
  publication dates in company details. Retrieval time does not prove coverage.
- Index: combine the two known index/regime warnings into one user-facing
  explanation that index-dependent comparisons are unavailable. Preserve raw
  reasons in expandable diagnostics and retain unrecognized warnings.
- AI: show whether this snapshot contains an interpretation, was skipped, or
  failed, with a plain reason when known. Put provider/model/status details in
  expandable diagnostics. Preserve existing provider attempts when attaching
  lean status; changing UI copy cannot establish AI recovery.
- Delivery: put producer/Discord/cockpit stages in expandable diagnostics. Only
  describe a Discord receipt as confirmed when the actual receipt says so;
  unknown and failed stages remain visible as such.
- Late brief: retain one snapshot-specific late-delivery explanation with its
  date. Do not present an old backstop message as today's outage.
- Top 10: keep its draft, evidence review and availability explanation inside
  Research. Its absence alone does not trigger an Overview data-warning banner.

Keep keyboard access, focus behavior, loading feedback, retries and preserved
form drafts. Reuse the existing dialog and native expandable details.

## Validation and release

Add focused regression coverage in the existing test suites for replaying the
saved positions and full EIC sale, explicit empty/error states, no config
fallback, owner isolation, unchanged history/balances, safe repeated activity
writes, account-free case eligibility and reload persistence. Test old review
compatibility, producer/web contract agreement, no sizing reactivation, and
unchanged-evidence review reuse.

Exercise failed/empty/populated sources, duplicate index warnings, stale quotes,
AI failure versus skipped state, truthful delivery receipts and Top 10 confined
to Research. Test keyboard operation and loading/error recovery for changed UI.
Use explicit test clocks and unique data-cache keys where applicable.

Run documented Python compile/tests, web lint/typecheck, full `npm test`, the
fresh producer-contract checks, and `git diff --check`. Do not hand-edit
machine-written root JSON. Build on current remote main in the existing isolated
checkout. Deploy compatible API/UI/producer changes together; verify owner and
machine authenticated reads separately, then confirm one dated portfolio and
the preserved sale in the live cockpit. Local tests or deployment alone do not
prove provider recovery, scheduled execution or actual Discord delivery.

Rollback restores code while preserving portfolio events, broker records and
confirmed case/review history; no destructive schema operation is planned.

## Builder choices

The builder may choose additive response/type names, a minimal compatibility
adapter for old reviews, and exact component boundaries/copy. Prefer existing
helpers and patterns; delete obsolete active account UI instead of introducing
a new abstraction. A broader schedule/provider repair requires evidence of its
root cause and a separately stated scope; this design preserves honest status.
