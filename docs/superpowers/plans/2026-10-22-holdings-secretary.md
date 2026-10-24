# TASI Holdings Secretary implementation

Approved specification: the user's implementation request in this chat. Base: remote main `630f359`.

## Binding scope

Extend the cockpit with persistent investor profile, owner-confirmed company cases, twice-daily official-source collection and provisional reviews when evidence changes. No automated trades, quantities, new-stock selection, invented risk thresholds, cash pooling, or inferred holdings. Preserve owner notes, broker ledgers, current daily digest/reconciliation and existing model/budget. A confirmed case is owner judgement, not independently verified financial truth.

Collect at 08:15 and 15:30 Riyadh Sun-Thu. Keep 08:30 brief. Source checks distinguish failure, successful empty and content; retain previous evidence after failure. Titles support notices/questions only. Case changes require explicit confirmation with stale-revision rejection and idempotent retries. Preserve revision history and supporting source references. No background case confirmation or portfolio mutation.

## Tasks and ownership

1. Core/store: new `app/lib/holding-secretary-core.ts`, `app/lib/holding-secretary-store.ts`, and corresponding tests. Reuse append-only D1 pattern, standalone from chat's last-30 window. Source of holdings is initialized non-damaged account book only.
2. Collection/producer: receipt-aware EvidenceStore/queue ingestion/schema, Python collector and workflow twice-daily wiring, source status/current-label correction, digest integration and deduplicated after-close notifications. Corresponding Python/Node/UI tests. No secretary core/service/UI edits.
3. Root integration: secretary service, owner copilot API and chat context/action/budget hardening, machine holding-reviews API and relay allowlist. Strict provenance; unchanged inputs no AI charge; budget/provider failure is visible. No ledger writes.
4. UI: guided profile/case draft/confirm/review/ack/history beside CopilotRail, plus damaged account display guard; accessible/persisted/error recovery tests.
5. Independent review, full repository gates, staged release qualification and documentation. Do not claim live success from CI.

## Shared contracts

Core types (agent 1 exports; root may add derived service-only types):

- `ProfileInput`: objective, horizon, contributions, riskSettings, constraints (all text).
- `InvestorProfile`: ProfileInput + revision, confirmedAt, operationId.
- `CaseInput`: symbol, reasons, supportingEvidence, risks, reconsiderWhen (text), sourceRefs (string array).
- `HoldingCase`: CaseInput + revision, profileRevision, confirmedAt, operationId.
- `AccountContext`: accountId, revision, shares.
- `HoldingCompany`: symbol, name, accounts (AccountContext array).
- `HoldingReview`: id, symbol, fingerprint, caseRevision, profileRevision, createdAt, status ('provisional'|'incomplete'|'pending'), action ('WATCH'|'RESEARCH_MORE'), changed, supporting, contrary, implications, missing, questions (strings), sourceRefs (string array), accounts (AccountContext array).
- `SecretaryView`: profile (nullable), cases, caseHistory, reviews, acknowledgedReviewIds.
- `heldCompanies(book)` returns HoldingCompany[]; `defaultProfile` exports ProfileInput; validate profile/case inputs at trust boundaries.
- `HoldingSecretaryStore(db)` methods: `view(ownerId)`, `saveProfile(ownerId,input,expectedRevision,operationId)`, `confirmCase(ownerId,input,expectedRevision,operationId,profileRevision)`, `saveReview(ownerId,review)`, `acknowledge(ownerId,reviewId,operationId)`. Return profile/case/review as applicable; acknowledge returns view. Replay with different data is conflict. Keep profiles/cases/reviews append-only. Stable review IDs prevent duplicate persistence. Same-company case shared across brokers; no legacy inference.

Owner API: GET /api/copilot returns existing messages/decisions plus `secretary: SecretaryView` and `holdingCompanies: HoldingCompany[]`. POST preserves ask/confirm and adds `save_profile` (profile,expectedRevision,operationId), `draft_case` (symbol), `confirm_case` (case,expectedRevision,operationId,profileRevision), `review_holding` (symbol), `acknowledge_review` (reviewId,operationId). Write results return the same extended conversation shape; draft_case additionally returns `caseDraft: CaseInput`. Profile/case writes work without provider credentials. UI retains draft and operation ID across uncertain retries.

Machine API GET/POST /api/holding-reviews uses existing bearer and machine relay. GET returns `{generatedAt,collection,items,notices}`. Items: symbol,name,status,reviewId,changed,sourceRefs,createdAt. Notices: id,text,kind. POST refreshes currently held confirmed cases using existing sole-owner resolution, rejecting ambiguity; accepts optional collectionRunId, no owner selection. No owner => visible setup state, no AI. All machine operations owner-bound.

Collection receipt: `{runId,attemptedAt,status:'content'|'empty'|'failed',count,error?}`. Ingest accepts existing queues plus `receipt`; failed receipts do not replace queue. Expose `EvidenceStore.latestCollection()` and `currentWithRevisions()` (reviewed records with revisionId,reviewedAt,record); preserve current()/queue() compatibility. Collection agent publishes exact final contract changes before service integration. Machine source refresh requires no new secret. Workflow review calls gated by repo variable HOLDING_REVIEWS_ENABLED, enabled only after API qualification.

AI review fields mirror HoldingReview text/sourceRefs/action; validate citations against supplied source URLs and reject unsupported action. Background reviews compare stable profile/case/evidence fingerprints excluding retrieval-only timestamps; no AI on unchanged/failure-only/empty checks without changed evidence. Pending exhausted-budget reviews retry when allowance permits. Human cases remain unchanged.

## Verification

Write meaningful failing tests before implementation. Test concurrency/retries, cross-owner protection, unconfirmed/missing/damaged account data, both brokers holding one issuer, source states, title-only limitations, citation/action validation, idempotent generation and reservations, confirmation/history, schedules/digest parity, duplicate notifications and UI recovery. Run Python compile + documented pytest, lint, typecheck, npm test including build/UI, producer contract, git diff --check. Final fresh-context review required.

## Rollout

Implement on isolated codex branch, no changes to original checkout. Stage storage/APIs before generation scheduling. Verify authenticated access, collection receipt, provisional review persistence and actual Discord delivery independently. Never invent broker openings or confirm a real company case during smoke testing. Preserve all owner records on rollback.
