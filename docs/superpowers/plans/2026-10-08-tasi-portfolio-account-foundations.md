# TASI Portfolio Account Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Give Al Rajhi and Al Ahli independent, auditable cash and position records with manual reconciliation, while preventing combined cash or unassigned legacy records from supporting trade quantities.

**Architecture:** Reuse the existing portfolio fold, authenticated routes, cockpit forms, and D1 database. Store new account records separately from the unassigned legacy ledger, using a unique per-account revision to serialize validated writes; replay immutable corrections rather than rewriting history. Adapt every existing caller before exposing the new account book.

**Tech Stack:** Existing Python, TypeScript/React, Cloudflare Workers/D1, node:test with node:sqlite, and Vitest. No new dependencies or infrastructure.

**Spec:** `docs/superpowers/specs/2026-10-08-tasi-portfolio-decision-support-design.md`, approved on 2026-10-08.

**Status:** Native execution approved on 2026-10-08. Tasks 1-4 implemented and verified. Task 5 documentation and local verification are complete; independent review returned concrete findings but stopped at a usage limit before its final verdict. Confirmed findings have regression fixes. The independent-review gate remains open.

## Scope and sequence

This is the first independently testable plan in the approved foundations-first sequence. It covers account records, explicit flows, manual transaction preview/confirmation, correction history, manual statement comparison, and the callers that could otherwise pool cash. It does not claim to deliver the entire decision-support design.

Later plans cover company-case/holding-policy alignment and qualified account sizing, then review routines and observation-only evaluation. Those plans need the relevant assessment, sizing, freshness, and evaluation decisions first. Actual broker-file parsers require examples; this plan accepts manual normalized records and manually entered statement totals, not unknown export files.

The first release remains **account foundations only**: new quantity suggestions stay unavailable, and the cockpit explicitly identifies company-case policy and rule evaluation as pending. Do not activate schedules, alerts, providers, ingestion, publication, or deployment through this plan.

## Global constraints

- “Al Rajhi and Al Ahli follow the same investment strategy but have separate cash, positions, transaction histories, reconciliation state, and suggestions.”
- “A combined view shows total value and exposure; it never pools spendable cash or recommends cross-account funding.”
- “Multiple variable contributions may occur in the same month.” No default SAR 500 deposit or monthly cash reset.
- “Ignored proposals never change cash or holdings.” Approval is not execution.
- “Account for each fee exactly once, whether attached to a trade or recorded separately.”
- “Unassigned legacy records remain visible with their provenance and an unresolved status.” No inferred broker mapping or opening quantities.
- “Missing company evidence means an incomplete assessment, never reassurance that holding is justified.”
- “Keep delayed market-pulse publication disabled and preserve existing provider, forecast, and release gates.”
- Preserve unrelated user files and machine-written JSON. Work locally; push, migration execution against production, Discord registration/delivery, and deployment are outside this plan.

## Review focus

1. Two requests read the same account balance: only one conflicting revision may commit, including a cash withdrawal racing a buy (Task 2).
2. A client retries an operation ID with different account/amount/fees: reject it instead of treating a different transaction as an idempotent success (Tasks 2 and 3).
3. A correction or backdated statement changes earlier facts: replay all affected transactions, retain the audit trail, and never leave an impossible historical cash or share balance (Tasks 1 and 2).
4. An account contains a stock also held at the other broker, with unknown opening cost: preserve both positions and show unknown performance rather than zero cost or duplicated P/L (Tasks 1 and 4).
5. One account or market quote is unavailable: keep the other account usable and label combined totals incomplete; retain last successful content with its original timestamps (Tasks 3 and 4).

## Execution base and file map

Planning inspected local `origin/main` at `284a15f`; portfolio/producer files matched the existing `c575992` evidence worktree. These are local source checks, not production verification. The documentation branch starts at older `ffe7d05`; do not implement on that old base.

At execution, inspect attached worktrees and fetch current refs. Reuse a suitable checkout if available; otherwise use `superpowers:using-git-worktrees` and the app's managed worktree tool from verified `origin/main`. Carry the spec and plan commits into that isolated checkout without copying unrelated untracked files. If relevant source has changed, adjust this plan against the new source before editing. Read `AGENTS.md` and RTK guidance there; use CodeGraph first if `.codegraph/` exists.

| Path | Responsibility |
|---|---|
| `app/lib/portfolio-core.mjs`, `.d.mts` | Existing money/position fold; new account-record projection and normalized preview types |
| `app/lib/evidence-types.ts` | Account book/view types alongside the existing snapshot `PortfolioView` |
| `db/schema.mjs` | Additive account-record table; retain legacy table unchanged |
| `app/lib/portfolio-store.ts` | Owner/account reads, atomic revision writes, idempotency, history |
| Existing `app/api/portfolio/{route.ts,events/route.ts,current/route.ts}` | Owner read/write and machine read contracts |
| New `app/api/portfolio/preview/route.ts` | Read-only server preview for manually entered events/corrections/reconciliation |
| `app/components/PortfolioAccounts.tsx` | Focused account panel, manual flows, statement comparison, audit history |
| `app/components/{ActionCockpit,CockpitDetails}.tsx`, `FriendlyCockpit.module.css` | Integrate account selection and executed-trade recording with existing UI |
| `app/lib/copilot-service.ts`, Discord parser/route | Prevent other entry points from inventing an account or spending combined cash |
| `main.py`, `artifacts.py`, `summary_contract.py`, `notify.py`, `.github/workflows/tasi.yml` | Read account-aware records, label unevaluated diagnostics, and abstain from actions/sizing without recording suggestions as spending |
| `app/lib/dashboard-{core.mjs,types.ts}`, `app/lib/decision-view.{mjs,d.mts}` | Preserve account-readiness metadata and avoid unsupported holding/P/L labels |
| Existing portfolio/core/schema/UI tests plus `tests/ui/portfolio-{store,api,accounts}.test.*` | Focused guarantees and integration checks |
| `README.md` | Account setup, manual reconciliation, limitations, and no deployment claim |

## Shared contracts

Define these in the named existing type files; do not add a generic ledger framework.

- `BrokerAccountId = 'al_rajhi' | 'al_ahli'`. Require it on every new write. No default broker and no user-configurable account CRUD in this slice.
- `AccountRecord` has `operationId`, `accountId`, `revision`, `recordedAt`, `kind`, and `payload`. Kinds are `event`, `correction`, and `reconciliation`. `AccountRecordInput` is the discriminated union `{ operationId, kind, payload }`; account identity comes from the validated envelope and revision/audit time are assigned by the server.
- `AccountEventPayload` uses the existing `PortfolioEvent` value fields, omitting `operationId` and `confirmedAt`, plus `occurredAt` and `provenance: { source: 'manual'; reference?: string }`. Event kinds add `withdrawal`, `dividend`, and `fee`; contribution is the explicit deposit kind. Direct `opening_position` payloads remain forbidden. Opening holdings may be empty and `avgCostSar` may be absent. During replay, derive the fold's operation ID from the original account record and its timestamp from `occurredAt`.
- A correction payload is `{ targetOperationId, replacement, reason }`, where replacement is a complete corrected event payload or null to void it. It may target only an original event in the same account, never a correction or reconciliation. A later correction of the same original event replaces the earlier correction's effective result. Preserve all original/correction records; require a nonempty reason. Corrections are records, not editable history.
- A reconciliation payload is `{ statementAsOf, cashSar, holdings: [{ code, shares }], reference }`. It compares against ledger facts effective at `statementAsOf`; it does not change cash or shares. Reference is a user-entered statement label, not an uploaded document.
- `PortfolioAccountView` exposes `accountId`, `revision`, `initialized`, `cashSar: number | null`, `holdings`, `confirmedAt: string | null`, `lastReconciledAt: string | null`, `reconciliationStatementAsOf: string | null`, `reconciliationStatus: 'unreconciled' | 'matched' | 'discrepancy' | 'needs_review'`, discrepancies, `historyComplete`, `quantityBlockers`, and `proposal: null`. Uninitialized cash is null; a confirmed zero is 0. Unknown cost basis stays absent/null; no invented zero-cost position. Audit confirmation time, statement date, and transaction date are distinct.
- `PortfolioBook` exposes `accounts` in Al Rajhi/Al Ahli order, `combined`, and `legacy: { status: 'unassigned'; events }`. Combined cash and exposure are explicitly reporting-only. `combined` includes `cashSar: number | null`, `spendable: false`, `complete`, and the account timestamps; uninitialized accounts make the full cash total null. Missing valuation inputs make affected value/exposure totals incomplete, without hiding confirmed account cash.
- `ReconciliationDifference = { field: 'cash' | 'shares'; code?: string; ledger: number; statement: number; difference: number }`, with difference equal to statement minus ledger. `AccountPreview = { record: AccountRecordInput; expectedRevision: number; projected: PortfolioAccountView; differences: ReconciliationDifference[] }`.
- All new account views carry `proposal: null` and the reason `Sizing policy and fee assumptions are not configured.` No numeric policy is introduced by this plan.

### Task 1: Account projection, explicit flows, and immutable corrections

**Files:** Modify `app/lib/portfolio-core.mjs`, `app/lib/portfolio-core.d.mts`, `app/lib/evidence-types.ts`; test `tests/portfolio-core.test.mjs`.

**Interfaces:** Consume existing `PortfolioEvent` and money validation. Produce `foldAccountRecords(records: AccountRecord[], accountId: BrokerAccountId): PortfolioAccountView`, `buildPortfolioBook(records: AccountRecord[], legacyEvents: PortfolioEvent[]): PortfolioBook`, and `previewAccountRecord(records: AccountRecord[], accountId: BrokerAccountId, input: AccountRecordInput, expectedRevision: number): AccountPreview`. Declare the shared contracts here for later tasks.

- [x] **1. Write failing tests** asserting: two openings at SAR 300 and SAR 400 produce separate balances and SAR 700 reporting-only total; two same-month contributions of SAR 125 and SAR 40 add SAR 165; a missing contribution amount throws; cash-only openings work; the same stock remains separate per broker. Use fixed timestamps.

```js
test('an empty account book does not invent confirmed cash', () => {
  const book = buildPortfolioBook([], []);
  assert.deepEqual(book.accounts.map(a => a.accountId), ['al_rajhi', 'al_ahli']);
  assert.equal(book.accounts[0].initialized, false);
  assert.equal(book.accounts[0].cashSar, null);
  assert.equal(book.combined.cashSar, null);
  assert.equal(book.combined.spendable, false);
});
```
- [x] **2. Run** `rtk node --test tests/portfolio-core.test.mjs`; verify the new account functions/guarantees fail before implementation.
- [x] **3. Implement the three interfaces** with the existing fold as the money/position calculator. Require a confirmed opening before regular account events and require explicit amounts; remove monthly uniqueness/default amount from the calculator. Add withdrawal/dividend/fee handling, preserve fee-on-trade exactly once, and allow unknown opening costs without making up P/L. Normalize timestamps; replay by effective event time with stable original revision order for ties, deriving the fold's timestamp from `occurredAt` while retaining `recordedAt` as audit time. An opening snapshot defines the history boundary; reject earlier effective transactions instead of double-counting them. `historyComplete` is false when opening positions lack prior history/cost, with the snapshot boundary shown.
- [x] **4. Add correction/reconciliation assertions:** SAR 100 opening, SAR 60 buy, then SAR 50 withdrawal must fail; a full exit retains known realised gain; unknown basis keeps gain unknown; voiding an earlier funding event must fail if later buys would overspend; a correction cannot change account; a later correction invalidates a prior matched reconciliation until rechecked. A SAR 299 statement against SAR 300 ledger yields a SAR -1 discrepancy without changing cash. A historical statement excludes later transactions. Same-time trades have deterministic order.
- [x] **5. Run** the focused suite to completion; existing valid arithmetic tests and new tests pass. Commit only these files with `feat: project independent broker account records`.

### Task 2: Additive D1 storage with serialized, idempotent writes

**Files:** Modify `db/schema.mjs`, `app/lib/portfolio-store.ts`; test `tests/portfolio-schema.test.mjs`; create `tests/ui/portfolio-store.test.ts`.

**Interfaces:** Consume Task 1 projections. Produce `PortfolioStore.book(ownerId: string): Promise<PortfolioBook>`, `accountRecords(ownerId: string, accountId: BrokerAccountId): Promise<AccountRecord[]>`, `preview(ownerId: string, accountId: BrokerAccountId, input: AccountRecordInput, expectedRevision: number): Promise<AccountPreview>`, and `appendAccountRecord(ownerId: string, accountId: BrokerAccountId, input: AccountRecordInput, expectedRevision: number): Promise<PortfolioBook>`.

- [x] **1. Write failing schema/store tests** for independent account records, untouched legacy rows, cross-owner isolation, exact retry success, changed-payload retry rejection, and two requests attempting the same next revision. Use `node:sqlite` to exercise actual SQL constraints; a store stub must not be the only concurrency proof.

```js
test('a stale second account revision cannot overwrite a committed record', () => {
  const db = database(); // Existing helper executes researchSchemaStatements.
  const insert = db.prepare(`INSERT INTO portfolio_account_records
    (operation_id,owner_id,account_id,revision,record_kind,recorded_at,payload_json)
    VALUES (?, 'owner', 'al_rajhi', 1, 'event', '2026-10-08T08:00:00Z', '{}')`);
  insert.run('first');
  assert.throws(() => insert.run('second'), /UNIQUE/i);
  assert.equal(db.prepare('SELECT count(*) AS n FROM portfolio_account_records').get().n, 1);
});
```
- [x] **2. Run** `rtk node --test tests/portfolio-schema.test.mjs` and `rtk npx vitest run tests/ui/portfolio-store.test.ts --no-file-parallelism`; verify the new cases fail.
- [x] **3. Add `portfolio_account_records`** with operation ID primary key, owner/account/revision/kind/recorded timestamp/payload JSON; `CHECK` account/kind/revision validity and `UNIQUE(owner_id, account_id, revision)`. Leave `portfolio_events`, its indexes/triggers, and its data unchanged. Schema initialization must work twice on both an empty database and one containing legacy rows. Update `PortfolioStore.soleOwnerId()` to take the union of owners from the legacy and new tables; zero owners stays unavailable and multiple owners is rejected. Test a new-table-only owner and different owners split across the tables.
- [x] **4. Implement store methods.** Read and validate the complete account projection, require `expectedRevision`, then insert exactly one immutable record at the next revision. The unique account revision makes a stale concurrent write fail atomically. Return a conflict requiring refresh; do not silently retry against changed cash. An existing operation is success only if owner, account, and normalized payload match. Never log payloads or bind secrets into diagnostics. A batch import is outside this slice.
- [x] **5. Assert** a withdrawal racing a buy cannot commit both from the same SAR 100 balance; separate brokers can each commit revision 1; malformed JSON or invalid replay fails visibly; corrections and reconciliation are subjected to the same revision guard. Run both focused suites; commit with `feat: persist broker records with account revision guards`.

### Task 3: Account-aware APIs and every non-UI caller

**Files:** Modify existing portfolio routes, `app/api/discord/interactions/route.ts`, `app/lib/discord-interactions.mjs`, `app/lib/copilot-service.ts`, `main.py`, `artifacts.py`, `summary_contract.py`, `notify.py`, `.github/workflows/tasi.yml`, `app/lib/evidence-types.ts`, `app/lib/dashboard-core.mjs`, and `app/lib/dashboard-types.ts`; create preview route and `tests/ui/portfolio-api.test.ts`; update `tests/{discord-interactions,producer-contract,dashboard-core}.test.mjs`, `tests/ui/{discord-interactions-api,copilot-api}.test.ts`, and `test_core.py`.

**Interfaces:** `GET /api/portfolio` returns `PortfolioBook`. `POST /api/portfolio/preview` accepts `{ accountId, record, expectedRevision }` and returns a server-validated preview without writes. `POST /api/portfolio/events` accepts the same envelope and commits it after explicit UI confirmation. Machine `GET /api/portfolio/current` returns `{ schemaVersion: 2, book, eventCount }` under the existing bearer boundary. Do not change authentication semantics.

Snapshot `portfolio` gains optional `policyStatus: 'unconfigured'`; account-book snapshots carry that value and may have `cashSar: null` for an incomplete combined cash total. Preserve and validate these in the existing parser/types; existing numeric-cash artifacts remain accepted. Each account-mode digest record also carries `policyStatus: 'unconfigured'` and diagnostic `originalAction`, with public `action: 'WATCH'`. These are readiness facts, not a new investment rule or an evaluation registry.

- [x] **1. Write failing route tests** for preview without append, missing/invalid account rejection, unauthorized owner rejection, stale revision HTTP 409, exact retry success, and unavailable DB vs empty/uninitialized book. Assert operation records never derive account IDs from request-supplied owner identity.

In the route test file, mock `getOwnerContext` to return owner `owner`, set the existing Workers stub's `env.DB`, and import the preview route's POST as `previewPost`. Add:

```ts
test('a missing broker cannot reach the ledger write boundary', async () => {
  const append = vi.spyOn(PortfolioStore.prototype, 'appendAccountRecord');
  const response = await previewPost(new Request('https://example.test/api/portfolio/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 0, record: { operationId: 'missing-account' } }),
  }));
  expect(response.status).toBe(400);
  expect(append).not.toHaveBeenCalled();
});
```
- [x] **2. Run** `rtk npx vitest run tests/ui/portfolio-api.test.ts tests/ui/discord-interactions-api.test.ts tests/ui/copilot-api.test.ts --no-file-parallelism`; confirm new assertions fail.
- [x] **3. Wire the endpoints** to Task 2, using HTTP 400 for invalid input, 409 for revision/payload conflicts, and the existing authentication/storage error statuses. Preview and confirmation each validate current account state. Historical records are returned under the same private owner boundary; other owners' records never enter legacy/history output.
- [x] **4. Adapt Discord and copilot.** `/portfolio` reports separate brokers and a labelled combined total. Until separately authorized command registration supplies account and actual fees, old `/bought` and `/sold` requests must direct the user to the cockpit without writing a record; do not infer a broker or zero fees. `/budget` reports configured sizing unavailable and confirmed cash per account, never a fixed monthly cap. Pass the complete book and explicit no-pooling/unconfigured-sizing instructions to the copilot. Keep existing provider limits and credentials unchanged; tests mock provider calls.
- [x] **5. Add producer tests** for the schema-2 book: confirmed empty accounts stay empty rather than restoring `config.HOLDINGS`; legacy records never become an account; same-stock holdings may be combined for company research only; unknown cost stays unknown. Missing book and zero initialized accounts are visibly unavailable, not a confirmed zero portfolio.
- [x] **6. Adapt `_portfolio_ledger()` and its callers** for schema 2. `_holdings()` may return reporting/research aggregation, with account provenance retained and no invented average cost. In `_collect_recs()`, account-book mode attaches the shared policy metadata and an unconfigured-sizing reason, with no proposed share quantity; it must not call `_budget_record()` or use the old SAR 500 cap for the book. `_movement_alerts()` must not return actionable alerts for these unevaluated records. Preserve legacy decoding for old artifacts with explicit limitations, but never downgrade a schema-2 error to legacy spendable cash. Update workflow response validation to accept schema 2 without changing schedules, executing a workflow, or changing secrets. Serialize unknown combined cash as null and omit unknown holding cost, with the policy status retained through the artifact/parser.
- [x] **7. Guard every presentation of the diagnostics.** In `artifacts.decision_record()` retain stale/missing-price precedence, then use `Company assessment pending` for an owned account-mode record instead of `Hold`, stop, or profit-taking labels. In `summary_contract.build_summary_v1()` return portfolio card state `evidence-pending` and text `Company assessment and signal evaluation are pending; no trade quantity is proposed.` when snapshot portfolio policy is unconfigured. `notify.py` renders this card and observation status, never a monthly reset or BUY size for that mode. Before modifying formatters, reread the required `llm.py` module docstring and `_fmt_news`/`_fmt_disclosures`; keep failed/empty/content separate. Add Python artifact/formatter assertions and a producer→JS parser test that the pending status survives, stale data still wins, and a threshold crossing cannot become a sell/buy instruction or actionable movement notification. Do not alter thresholds or claim they have been evaluated.
- [x] **8. Run** the focused Vitest suites, `rtk node --test tests/discord-interactions.test.mjs tests/producer-contract.test.mjs tests/dashboard-core.test.mjs`, and `rtk python -m pytest test_core.py -q`. Tests must exercise behavior, not merely regex source text. Commit with `feat: carry independent accounts through portfolio callers`.

### Task 4: Account panel, previews, executed trades, and manual reconciliation

**Files:** Create `app/components/PortfolioAccounts.tsx`, `tests/ui/portfolio-accounts.test.tsx`; modify `app/components/ActionCockpit.tsx`, `app/components/CockpitDetails.tsx`, `app/components/FriendlyCockpit.module.css`, `app/lib/decision-view.mjs`, `app/lib/decision-view.d.mts`, and existing decision-view/executed-trade/friendly-cockpit tests.

**Interfaces:** `PortfolioAccounts({ book, accountId, onAccountChange, onSaved }: { book: PortfolioBook; accountId: BrokerAccountId | null; onAccountChange: (id: BrokerAccountId | null) => void; onSaved: () => void })` owns manual ledger workflows; the parent holds account selection so the same account drives cards and forms. `ExecutedTradeForm` receives a selected `PortfolioAccountView`, its revision, and `onSaved`; it submits the Task 3 envelope. `buildDecisionView(snapshot, freshness, livePortfolio?: PortfolioView | PortfolioAccountView | null)` keeps the existing snapshot arguments and accepts the selected account. Add `Company assessment pending` to `StockDecision.label`. Combined view is read-only and has no trade-recording account default.

- [x] **1. Write failing UI tests** using SAR 300 and SAR 400 accounts: both balances remain visible; combined SAR 700 is labelled reporting-only; selecting Al Rajhi sends its ID/revision; preview makes no write; explicit confirmation makes one write; a failed save retains inputs; changing fields after an ambiguous failed request creates a new operation ID, while an unchanged retry retains the original ID.

```tsx
test('a combined view requires an explicit broker before recording activity', () => {
  render(<PortfolioAccounts book={buildPortfolioBook([], [])} accountId={null}
    onAccountChange={() => {}} onSaved={() => {}} />);
  expect(screen.getByText('Select a broker account to record activity.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm record' })).toBeNull();
});
```
- [x] **2. Run** `rtk npx vitest run tests/ui/portfolio-accounts.test.tsx tests/ui/executed-trade.test.tsx --no-file-parallelism`; confirm failure before implementation.
- [x] **3. Implement the panel** with native controls and existing dialog/styles. Initial selection is the combined read-only view with the prompt `Select a broker account to record activity.` Allow manual opening cash/positions, variable deposits, withdrawals, dividends, standalone fees, actual buys/sells, correction/void with reason, and manually entered statement cash/positions. No file picker or parser promise. Preview shows account, before/after records, fees and discrepancies; confirmation uses a separate `Confirm record` button. Actual trade fees must be explicitly entered, including an intentional zero. User supplies transaction time explicitly as Riyadh time; normalize with the +03:00 offset rather than the computer's timezone. Stored audit time is server assigned. Test a month-boundary transaction to keep its reporting month consistent with Riyadh.
- [x] **4. Show readiness honestly:** per-account confirmation/reconciliation dates, unresolved differences, unassigned legacy history, unknown cost/performance, and unconfigured quantity reason. Opening confirmation is explicit, never prefilled from old config. Show combined valued exposure only where dated quotes support it; missing quotes make totals incomplete. Do not introduce concentration limits or a portfolio return formula. `buildDecisionView` uses the shared policy metadata for `Company assessment pending`, with stale/missing data taking precedence. For a selected account, use its known average cost and a usable dated quote for P/L; never reuse aggregate `record.unrealized_pct`. Unknown cost gives null P/L. Company-level charts remain reusable across accounts.
- [x] **5. Decouple ledger loading from dashboard success:** initialized accounts and manual records remain available when the market snapshot fetch fails. Keep the last successful book after a refresh failure with its old timestamps and a failed-refresh notice. No stale account response may overwrite a newer revision. Preserve dialog focus, field labels, keyboard controls, and existing broker-price warnings.
- [x] **6. Assert** unknown cost displays unavailable P/L, same-stock broker positions do not borrow each other's gains, one-account discrepancy leaves the other account available, stale/empty/failed states differ, and revision conflict preserves the draft while requiring a new preview. Run focused tests plus `rtk npx vitest run tests/ui/friendly-cockpit.test.tsx --no-file-parallelism`; commit with `feat: review and reconcile broker accounts in the cockpit`.

### Task 5: Verify the slice and document its limits

**Files:** Modify `README.md`; add `docs/research/2026-10-08-tasi-portfolio-foundations-verification.md` during execution; update this plan's completed checkboxes only after evidence exists.

**Interfaces:** Consume completed Tasks 1–4. Produce a reviewable local branch and a verification record listing commands, outcomes, preserved user files, and deferred features.

- [x] **1. Update documentation** for independent account setup, legacy uncertainty, manual previews/corrections/reconciliation, concurrency conflicts, missing sizing rules, and temporary Discord trade-command restrictions. Remove fixed-monthly-contribution instructions from the new account workflow; keep unrelated historical documentation intact.
- [x] **2. Run the documented Python checks:** `rtk pip install -r requirements.txt` if needed; `rtk python -m compileall -q main.py movement.py session_gate.py runtime research`; `rtk python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q`.
- [x] **3. Run the documented web checks:** `rtk npm ci` if needed; `rtk npm run lint`; `rtk npm run typecheck`; `rtk npm test`; `rtk git diff --check`. `npm test` builds first. Record complete exit summaries; if the bundled/runtime environment needs an adjustment, report it instead of treating a partial run as success.
- [x] **4. Review offline scenarios** with synthetic account data: two account openings, two deposits in one month, buy and sale with fees, withdrawal, dividend, exact retry, conflicting retry, historical correction, discrepancy then matched statement, missing market snapshot, and unavailable broker quote. Run no network-backed market collection or notification smoke test.
- [ ] **5. Obtain the selected method's code review**, fix actionable findings, and rerun only checks justified by those changes. Verify staged paths and commit documentation. Report account foundations implemented only; list the remaining spec sections below. Do not merge, push, migrate production D1, or deploy without separate authorization.

  Review dispatched to a fresh reviewer against `781ab64..9a44c5b`.
  Its arithmetic, date, storage isolation, refresh, and producer-history findings
  were reproduced and fixed in one local pass. It hit a usage limit before
  delivering a complete graded review. This checkbox remains open to distinguish
  passing local verification from a completed independent review.

## Coverage and remaining decisions

| Spec requirement | This plan | Follow-on work |
|---|---|---|
| Independent accounts, variable cash flows, manual execution records, correction history | Tasks 1–4 | Confirm the user's real opening data after implementation; no invented balances |
| Statement preview/dedupe/confirmation and unsupported formats | Manual record preview, exact retries, and statement comparison in Tasks 2–4 | Broker-file adapters and batch import after actual examples; transaction matching across formats is not promised |
| Company suitability, entry qualification, holding/selling scenarios | Tasks 3–4 enforce pending status/abstention throughout producer and UI; no claim that legacy rules satisfy the new strategy | Separate policy plan after assessment/entry criteria and relevant loss-tolerance questions |
| Fee-aware quantity suggestions and concentration warnings | Tasks 1–4 block quantities and show dated exposure without invented thresholds | Reviewed sizing/fee policies and concentration thresholds; before/after proposal exposure |
| Daily/weekly/monthly summaries and performance | Account reconciliation and data needed for later performance in Tasks 1–4 | Separate routine plan, selected delivery times, explicit performance methodology, flow attribution |
| Observation-only rules and evaluation | Existing forecast/pulse gates preserved; no new actionable signal enabled | Rule registry/evaluation criteria, hypothetical outcomes, and exclusion from actionable alerts |
| Failed/empty/content, stale preservation, account safety and delivery honesty | Tasks 1–5 for affected account paths; existing delivery-state contract retained | End-to-end analysis/routine/Discord qualification and live coverage evidence |

**Self-review:** Task interfaces share the contracts above; no numeric investment settings or broker formats were filled in. The five review-focus risks are covered by explicit tests. This is a complete plan for the first account-foundation slice, with the rest of the approved specification tracked above rather than silently omitted.

**Recommended execution:** Native in this session, followed by independent branch review. The account model and callers share one contract, so keeping implementation in one context avoids repeated interface handoffs. Subagent-driven execution remains available if the user prefers it. Written-plan review and execution-method selection precede code changes.
