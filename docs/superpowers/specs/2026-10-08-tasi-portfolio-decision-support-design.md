# TASI personal portfolio decision-support design

**Date:** 2026-10-08, Asia/Riyadh

**Status:** Written specification approved by the user's “Implement” instruction on 2026-10-08. Implementation planning is the current stage; the written implementation plan still requires review before execution.

**Source conversation:** `01a10d71-a147-71a0-ab0d-d8ae699affd5` and its new-chat handoff.

**Selected approach:** Portfolio foundations first.

## 1. Purpose and scope

Help the user grow personal wealth over the long term through Saudi Main Market individual stocks. Three to five years is a progress review point, not a withdrawal deadline; investing may continue longer. The system supplies evidence, conditional opportunities, account-specific trade proposals where justified, and holding-review scenarios. The user makes every investment decision and executes every trade manually.

The investment universe excludes funds, ETFs, REITs, and international investments. There is no Sharia screen. Growth takes priority over smaller temporary declines in principle, but practical drawdown tolerance is untested and no numerical risk tolerance is agreed.

The portfolio, including investment cash, is under SAR 5,000. Contributions are usually below SAR 500 per month, sometimes SAR 500–1,000, with no assumed minimum, fixed contribution, or mandatory monthly purchase. The user has less than one month of essential-expense savings outside the portfolio and may occasionally withdraw investment cash unexpectedly. Emergency-fund decisions remain outside this project's scope: the user decides what money is available for investing.

The accepted working holdings baseline is Al-Babtain (2320) and Rasan (8313); EIC has been sold. This is contextual information, not a verified account ledger. Current quantities, values, weights, cost bases, cash, and broker assignments must not be inferred from old configuration or this baseline.

Success means trustworthy account records, clear evidence and uncertainty, proposals that respect each account's confirmed resources, and useful review routines. Software tests cannot establish investment profitability. Paid data, automated execution, new forecast claims, and emergency-fund management are outside scope.

## 2. Accounts, cash, and transactions

### Independent accounts

Al Rajhi and Al Ahli follow the same investment strategy but have separate cash, positions, transaction histories, reconciliation state, and suggestions. A combined view shows total value and exposure; it never pools spendable cash or recommends cross-account funding.

The user confirms opening positions and cash for each broker. Unassigned legacy records remain visible with their provenance and an unresolved status. They cannot silently become records of either broker or support affected account sizing. Existing access controls must continue to protect portfolio records.

### Confirmed ledger

Record opening cash and positions, deposits/contributions, withdrawals, buys, sells, dividends, and fees explicitly. Each confirmed record identifies its broker account, effective date, amounts or whole-share quantities as applicable, and manual/import provenance. Preserve correction history rather than silently overwriting past records.

Multiple variable contributions may occur in the same month. Contributions add cash only when confirmed; a monthly review, expected contribution, approval, or ignored suggestion does not. Cash carries forward without a monthly reset. Withdrawals reduce cash, actual buys consume execution cost plus fees, and actual sells return proceeds less fees. Recorded cash dividends add cash and count as investment income. Account for each fee exactly once, whether attached to a trade or recorded separately.

The ledger must reject changes that would spend unavailable confirmed cash or sell shares the account does not own. Corrections and imports must preserve the same guarantees. Reconciliation must expose discrepancies rather than invent balancing transactions.

### Manual execution and suggestions

A proposal contains the broker account, stock, reason, whole-share quantity and estimated cost/fees when the inputs permit sizing, plus the data timestamps and broker checks required before execution. Approval is not proof of execution. Record the actual account, quantity, price, fees, and execution date after the user trades. Ignored proposals never change cash or holdings.

Sizing uses that account's confirmed cash and holdings, valid fee assumptions, and an explicitly configured sizing policy. Recheck account state before recording a trade. Separate proposals must not misleadingly promise the same cash twice: label alternatives or show a jointly affordable set. Pending proposals do not reserve or consume ledger cash.

For example, SAR 300 in Al Rajhi and SAR 400 in Al Ahli is SAR 700 overall, but neither account can receive a SAR 700 buy proposal. No purchase quantity is issued if fees, relevant balances, or sizing policy are unresolved. Research and conditional candidates remain available.

### Broker-statement reconciliation

Support manual transactions and periodic reconciliation against each broker's statement. The import workflow is preview → identify duplicates and ambiguities → user confirmation → ledger changes. Re-importing a confirmed record must not duplicate it. Unsupported formats and ambiguous records remain unresolved and visible; do not guess their account, transaction type, or amount.

Show each account's last reconciliation date and unresolved cash/position differences. Differences block affected quantity suggestions, not research or the other independent account when its records are sound. Actual broker export examples are required before promising or designing a format-specific parser. Manual entry and reconciliation provide the initial usable path.

## 3. Evidence to decisions

Keep three assessments separate so a strong chart cannot stand in for a supported company case, and a supported company cannot stand in for affordable execution.

| Assessment | Inputs | Visible result |
|---|---|---|
| Company suitability | Dated results, cash flow, debt, valuation, and official disclosures, with sector-appropriate interpretation | Supported, weakened, or insufficient investment case, with supporting and contrary evidence |
| Entry timing | Charts, tradability, source coverage, observation age, and qualified entry criteria | Candidate, wait, or broker verification required |
| Account fit | Confirmed account cash/holdings, fees, sizing policy, and concentration | Whole-share quantity/cost when justified; otherwise a specific blocker and warnings |

Evidence records retain report period, publication date, retrieval date, and original source links where applicable. Each decision card explains what changed, evidence for and against the interpretation, relevant dates, and conditions that would invalidate it. Missing company evidence means an incomplete assessment, never reassurance that holding is justified.

### Buying or adding

Purchases need both company suitability and favorable entry qualification. Daily analysis selects companies; delayed within-session observations may help timing when their coverage and freshness have been verified. Cash may remain uninvested for months when no purchase qualifies.

Use free data only. Stale, incomplete, or unknown-freshness observations can support a conditional candidate with explicit broker checks, not a claim that entry conditions are currently met. The user verifies current price, tradability, and the stated conditions in the broker app before placing an order. Being able to review and trade within an hour during market hours is a user workflow preference, not a data-latency or delivery guarantee.

### Holding, reducing, or selling

The long-term company case drives the holding review. Temporary price weakness, a price target, or existing concentration alone must not automatically produce a sell decision. Price changes can prompt review or change the timing of new money.

If the company case weakens, present hold versus reduce/sell scenarios, the evidence, counter-evidence, trade-offs, and quantities where account records and configured rules permit. Do not select a scenario for the user. If evidence is insufficient, report that gap without declaring the case sound or inventing a loss threshold.

### Concentration

Show current and proposed concentration per account and in the combined summary, with valuation timestamps and limitations. Warning thresholds have not been chosen. Until configured, show exposure without declaring it within an agreed limit. Once configured, warnings remain informational and overridable; concentration alone never mandates selling.

### Rule evaluation

New or undocumented rules remain observation-only. Existing code does not establish that a rule has been evaluated. Record the rule version, input evidence and timestamps, hypothetical suggestion, and subsequent outcome in the cockpit. Observation-only suggestions are visibly separate and excluded from actionable Discord alerts.

Define evaluation criteria before looking at outcomes. Evaluation must account for costs, missing data, and simple comparison baselines. Exact criteria, sample requirements, and promotion conditions remain unresolved; do not invent them or promote a rule merely because retrospective examples look favorable. Preserve existing forecast abstention and release gates. No new prediction probability or real-time claim follows from this design.

## 4. Cockpit and review routine

Use short decision cards with expandable charts, results, valuation, disclosures, original sources, counter-evidence, and explanations. Account identity, action/conditional status, relevant dates, blockers, and warnings must be visible without opening all the detail. Discord notifications link to the corresponding cockpit detail.

| Routine | Required content |
|---|---|
| Daily | Material changes, entry candidates, holding concerns, and data gaps, with detail links |
| Within session | Only new material events or meaningful changes; suppress duplicate notifications |
| Weekly | Company-case changes, eligible candidates, concentration, and unresolved records |
| Monthly | Reconcile each broker, confirm available cash, review performance, and compare qualifying purchases with retaining cash |

Delivery times are configurable and have not been selected. This specification does not create or alter a schedule. A summary distinguishes a completed check with nothing actionable, an assessment prevented by insufficient data, and a failed check.

Per-account performance separates investment gains from external deposits and withdrawals, includes recorded dividends and fees, and labels incomplete history or unknown cost basis. The combined summary preserves those limitations. Do not show an unqualified return when the necessary history or valuation is missing; a precise performance calculation method belongs in the reviewed implementation plan.

## 5. Reliability and data honesty

Prices, company reports, portfolio confirmations, and reconciliation each carry their own timestamps. One recent fetch must not make an old filing or unconfirmed holding look current. Freshness limits remain unconfigured until reviewed.

Preserve the last successful content after a failed refresh, visibly labelled with its age and stale/unknown status. Failed retrieval, a successful empty result, and actual content must remain distinguishable. Preserve retrieval errors and source limitations without converting them to neutral scores or a reassuring absence of events.

Track analysis completion, cockpit update, and Discord delivery separately. A missing notification does not establish that no event occurred. A successful delivery does not establish that analysis was complete or data was fresh. Retain failures for review and suppress duplicate delivery without suppressing genuinely new material changes.

Account isolation, fee-aware affordability, owned-share limits, import confirmation/idempotency, and correction history are release requirements. Live ingestion, delivery, and operational coverage require their own verification and authorization. Keep delayed market-pulse publication disabled and preserve existing provider, forecast, and release gates.

## 6. Architecture and reuse

Retain the existing Python producer for analysis and artifact generation, and the TypeScript/React cockpit on Cloudflare Workers/D1 for records, review, and history. Use their authenticated HTTP boundary. Extend existing dated evidence, charts, manual-trade records, and freshness handling instead of introducing another backend or data provider.

The intended flow is:

1. Confirmed broker records establish separate account cash and holdings.
2. Dated company and market evidence produces suitability and timing assessments.
3. Validated account state and configured policies determine whether a quantity can be shown.
4. Cockpit cards expose the evidence, alternatives, and blockers; qualified notifications link to them.
5. Manual execution records change the ledger; statement reconciliation checks it.

Producer and cockpit must express the same holding policy and qualification state. Changing visible labels alone is insufficient if the producer still emits a price-triggered sell decision. Reuse existing modules where their behavior fits; these are product-policy gaps to address in a later plan, not authorization for unrelated refactoring.

### Repository context and limits of verification

On 2026-10-08 the main checkout was locally verified at `ffe7d05`, with existing user changes in `top10_draft.json` and untracked guidance/research files. The newer existing evidence worktree was verified at `c575992`, with unrelated untracked research and handoff documents. Neither checkout had `.codegraph/`. This document is authored on a local documentation branch from the main checkout; that older code revision is not selected as the implementation base. Preserve all unrelated files and generated JSON.

The earlier read-only review reported these planning touchpoints in the newer worktree. Their internals were not re-reviewed for this documentation task, and no production behavior is inferred:

- `analyze.py:evaluate_holding` emits threshold-based sell/trim decisions; `app/lib/decision-view.mjs` softens visible labels but does not by itself align producer policy.
- `app/lib/portfolio-store.ts` and `db/schema.mjs` scope records to an owner without independent broker accounts. Legacy opening records require explicit mapping.
- `app/lib/portfolio-core.mjs` has single-month contribution assumptions, a default contribution, and proposal sizing without a demonstrated fee allowance. Its monthly proposal helper had no production caller found in that scoped review.
- `app/lib/portfolio-core.d.mts` lacks distinct withdrawal/dividend and broker-provenance semantics. The existing producer `reconcile` mode grades a prior lean; it is not statement reconciliation.
- Existing daily modes, delayed intraday history, evidence schemas, pulse freshness gates, and offline forecast evaluation provide reusable pieces; their presence does not prove the agreed weekly/monthly routine or qualified live coverage.

The 2026-08-12 evidence-cockpit design is superseded where it conflicts with this specification: the 1–3 month swing objective, fixed SAR 500 monthly contribution, and maximum-two-sector-names rule must not be inherited as this user's investment settings. Other historical scores, targets, stops, and alert thresholds are not automatically approved or evaluated portfolio rules. Preserve useful source provenance and reliability contracts.

## 7. Open decisions and safe behavior

These are accepted open decisions, not blank fields to fill with guessed defaults. They do not reopen settled scope.

| Unresolved item | Input needed | Behavior until resolved |
|---|---|---|
| Broker export formats | Actual examples and field meanings for each broker | Manual entry/reconciliation; unsupported imports remain unresolved |
| Opening balances and broker mapping | User-confirmed cash, quantities, account assignment, and available cost history | Show unassigned records; block affected quantity suggestions and qualify performance |
| Fees and sizing | Broker fee assumptions and reviewed allocation/quantity rules | Research and conditional candidates only where sizing depends on missing inputs |
| Concentration warnings | Reviewed thresholds and exposure definitions | Show exposure; do not claim compliance with an agreed limit |
| Freshness and coverage limits | Reviewed limits by data family and intended use | Show timestamps and uncertainty; do not assert currently met entry conditions without qualification |
| Company/entry rules and signal evaluation | Explicit assessment/entry criteria, baselines, costs, sample requirements, and promotion criteria | Unvalidated rules remain observation-only; no actionable alert from those rules |
| Practical loss tolerance | User assessment when needed for a proposed risk-dependent policy | No numerical drawdown limit, stop-loss policy, or tolerance claim |
| Delivery times | User-selected Riyadh times and cadence settings | Do not activate or change schedules on the basis of this document |

The written scope is approved; the full investment-decision engine is not implementation-ready. Planning can detail account foundations and explicitly unconfigured states. Resolve only the open decisions needed by the slice being planned before finalizing its dependent behavior. A broker parser or actionable sizing/rule slice needs its additional inputs and review first.

## 8. Verification and acceptance

The later implementation must demonstrate the following guarantees with deterministic checks and representative manual review:

1. SAR 300 and SAR 400 in separate accounts remain independently spendable; unassigned legacy records cannot enlarge either balance.
2. Multiple confirmed contributions in one month are accepted, cash carries forward, and a missing contribution never becomes SAR 500 automatically.
3. Withdrawals, dividends, trades, fees, and corrections produce consistent cash/position history without double-counting; overspending and selling unowned shares are rejected.
4. Approval or an ignored suggestion changes no ledger balance; actual execution is recorded once with its real account, quantities, price, and fees.
5. Import preview changes nothing, confirmed imports are idempotent, ambiguity stays unresolved, and discrepancies block only affected sizing.
6. Temporary weakness alone does not choose a sale; a weakened case exposes alternatives; missing evidence does not produce a supported-case label.
7. Purchase qualification requires both company and entry assessments; unresolved fees, sizing, or account state prevents a quantity proposal. Concentration warnings remain overridable.
8. Failed, empty, and populated sources render distinctly; stale retained content shows its original dates; broker checks remain explicit.
9. Observation-only rules appear in cockpit history but cannot produce actionable Discord alerts. Evaluation criteria predate outcome assessment.
10. Performance separates external flows from investment results, accounts for recorded dividends/fees, and labels incomplete history. Analysis, cockpit ingestion, and notification delivery have separate outcomes.

Run applicable checks from `AGENTS.md` for implementation: Python compile and documented pytest suite; web lint, typecheck, and `npm test` (which builds first); and `git diff --check`. Data-layer tests must avoid shared cache keys and time-dependent tests must supply explicit clocks. Live readiness requires evidence beyond software tests; no such validation is claimed here.

## 9. Review and authorization boundary

The selected delivery order remains: independent reconciled accounts → aligned holding/selling and account-specific sizing → review routines and observation-only evaluation. This is a design sequence, not the written implementation plan or an execution approval.

Current authorization permits implementation planning following written-spec approval. No product code, machine-written state, market validation, provider configuration, publication flag, ingestion, Discord delivery, scheduler, or deployment has been changed by this documentation work. The user reviews the written implementation plan and selects execution before implementation begins.
