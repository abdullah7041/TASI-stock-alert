# Single Portfolio Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore saved holdings throughout the cockpit and secretary without broker setup, and make data status useful.

**Architecture:** Reuse the owner-scoped portfolio_events ledger and foldPortfolio. A versioned, validated saved-portfolio response feeds web and machine callers. Keep old account storage and review payloads readable without exposing account setup.

**Tech Stack:** Existing TypeScript/React/Workers/D1 and Python; no new dependencies.

**Spec:** docs/superpowers/specs/2026-11-05-single-portfolio-cleanup-design.md (approved 2026-11-07).

## Global Constraints

- One portfolio; no broker selectors, setup, forms or repeat upload.
- Never replace missing records with config holdings or resurrect sold EIC.
- Preserve recorded history and owner-confirmed cases; no quantities or automatic trades.
- Keep missing, failed, empty and populated sources distinct.
- Top 10 stays in Research. Existing schedules, provider configuration and AI budgets stay intact.
- Keep policy unconfigured independently of account-book mode.

## Review Focus

- Failed refresh must retain dated state, while an authoritative empty result must clear it (Task 2).
- Concurrent withdrawals must not both spend the same cash; changed retries must conflict (Task 1).
- Archived broker reviews must still parse after new reviews use portfolio context (Task 2).
- Malformed machine responses cannot reactivate configuration or sizing (Task 3).
- Top 10 alone must not trigger the Overview data-warning banner (Task 2).

### Task 1: Shared saved portfolio and safe completed activity

**Files:** app/lib/portfolio-core.mjs, its .d.mts declarations, evidence-types.ts, portfolio-store.ts; app/api/portfolio/{route,events/route,preview/route,current/route}.ts; tests/ui/portfolio-store.test.ts and portfolio-api.test.ts.

**Interfaces:** savedPortfolio(events) and parseSavedPortfolio(value) -> SavedPortfolio {schemaVersion:3,status:'saved'|'empty',eventCount,events,view}; PortfolioStore.saved(ownerId), previewSaved(ownerId,record,expectedRevision), appendSaved(ownerId,record,expectedRevision). Record reuses AccountRecordInput event payload validation without a broker identifier. Current endpoint returns the same envelope for the sole owner.

- [ ] Add and run a failing regression for folding the two saved holdings and full EIC sale, an empty response, and concurrent/repeated writes.
- [ ] Implement projection/parser and owner/machine reads. Reject nonempty broker records explicitly instead of silently dropping them.
- [ ] Implement manual completed activity with existing payload validation, exact retry equality, preview and atomic revision-checked insertion. Preserve existing account compatibility operations.
- [ ] Run focused storage/API tests and typecheck; commit the deliverable.

### Task 2: Account-free cockpit and secretary with honest status

**Files:** ActionCockpit.tsx, CockpitDetails.tsx, HoldingSecretary.tsx; minimal SavedPortfolio component; holding-secretary-{core,service}.ts, copilot-service.ts, api/copilot/route.ts; dashboard-core.mjs; existing UI/service tests.

**Interfaces:** consume SavedPortfolio from Task 1; HoldingCompany and new HoldingReview add portfolioContext {source:'portfolio_events',revision,shares,recordedAt}; historical accounts context remains accepted. Existing evidence fingerprints remain stable for unchanged evidence.

- [ ] Add/run failing UI checks for saved holdings without setup, authoritative empty/error recovery, keyboard recording and status deduplication/Top 10 routing.
- [ ] Replace active account panels with dated holdings/history and one completed-activity form. Validate snapshot history only as a read-only failure fallback; retain explicit policy suppression.
- [ ] Switch company eligibility, summary and chat to saved owner events; preserve old review parsing, profile confirmation and budget/review deduplication. Add/run legacy-ledger secretary regression.
- [ ] Simplify Data status using existing fields and native details: dated prices, distinct source states, one index explanation, AI failure/skipped reason and truthful delivery diagnostics; keep Top 10 availability in Research.
- [ ] Run affected UI/service tests and typecheck; commit the deliverable.

### Task 3: Producer/Discord contract, regression qualification and release readiness

**Files:** main.py, summary_contract.py as required, app/api/discord/interactions/route.ts, README.md; test_core.py, tests/producer-contract.test.mjs and affected Discord tests.

**Interfaces:** producer consumes version-3 SavedPortfolio; snapshots keep policyStatus:'unconfigured' without requiring accountBook. Existing version-2 artifacts remain readable.

- [ ] Add/run failing tests for saved/empty/malformed version-3 reads and no sizing, plus preserved lean provider attempts.
- [ ] Adapt holdings, budget guards, snapshot generation, brief and Discord reads to the shared portfolio. Never downgrade malformed/new responses to config. Preserve schedules and notifications.
- [ ] Update documentation; run Python compile/tests, lint, typecheck, full npm test, fresh producer-contract checks and diff integrity.
- [ ] Obtain one fresh whole-branch read-only review; resolve actionable findings, repeat affected checks and commit.
- [ ] Before any release, verify authenticated reads and absence of broker records; preserve all ledger and secretary history on rollback. Existing authorization covers merge/push/deploy, but do not claim live checks or delivery without separate evidence.
