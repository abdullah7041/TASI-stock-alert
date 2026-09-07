# Friendly private cockpit implementation

Approved in conversation: holdings-first friendly finance UI, Today briefing, all holdings, three opportunity previews with View all, per-stock details and charts, Data status drawer, truthful availability and market dates; fix empty AI configuration and independent news retrieval; preserve Top 10 and forecast evidence gates; record actual executed trades. Migrate all eight D1 tables to the owner's Cloudflare Workers account with owner-only Access login (one month), preserve ledger owner IDs, machine authentication and Discord signatures. No added paid subscriptions or spending caps. Keep Sites for rollback and preserve unrelated research edits. A live Discord send needs explicit authorization.

## Tasks
1. Baseline and focused failing tests; typed decision view over shared digest records.
2. Friendly dashboard, details, data drawer, executed-trade form, UI verification.
3. AI/news availability fixes and shared producer fields, regression tests.
4. Verified Access authorization, separate machine routes, runtime and workflow migration support.
5. Export/reconcile eight tables, protected deployment, production checks and controlled cutover.
6. Whole-change review, build/type/lint/Python/UI verification and delivery.

## Implementation ledger
- Worktree from origin/main 896d631; root research edits untouched.
- UI consumes digestRecords; producer fields remain backward-compatible.
- Access and workflow migration share machine route classification: preserve separate application token and signed Discord payloads.
- UI and provider changes share availability contract: distinguish absent, partial and failed from neutral results.
- No implementation scope conflicts found; hosted operations remain owned by the primary agent.
- Read-only authentication research delegated; source edits stay with primary agent.
