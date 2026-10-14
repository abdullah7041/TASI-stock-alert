# TASI Cockpit Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.
> User approved implementation in this chat; execute continuously.

**Goal:** Deliver the approved light card cockpit, reliable data states and concise Discord.
**Architecture:** Keep the producer artifact as shared truth. Add a backward-compatible
expected quote date, normalize stock states, then compose four frontend views from
existing stores and APIs. Retain the private canonical Cloudflare deployment.
**Tech Stack:** Python, React/TypeScript, CSS modules, vinext, Workers/D1.
**Spec:** ../specs/2026-10-14-cockpit-refresh-design.md

## Global Constraints

English; light cards; free/delayed data; manual execution; separate broker cash;
no new investment policy; no new dependencies; no hand-edited generated state;
unchanged credentials, schedules and experimental publication gates.

## Review Focus

- Account refresh failures cannot silently substitute legacy or zero balances.
- Holidays and stale watchlist quotes cannot imply current entry conditions.
- Provider failure cannot become no-news/no-review reassurance.
- Older artifact contracts and authenticated ingestion must remain compatible.
- Daily briefs cannot leak internal context or turn observation into an order.

### Task 1: Quote freshness contract

**Files:** session_gate.py, main.py, artifacts.py,
app/lib/dashboard-types.ts, app/lib/dashboard-core.mjs,
app/lib/decision-view.mjs, app/lib/decision-view.d.mts, test_core.py,
tests/decision-view.test.mjs, tests/dashboard-core.test.mjs.
**Interfaces:** optional expectedPriceDate: YYYY-MM-DD; existing stock view gains
quote state; existing buildDecisionView signature stays compatible.
- [ ] Add red tests: old watchlist quote is unavailable; missing quote date is
  unavailable; priceDates includes watchlist with no holdings; explicit expected
  date supports recorded holidays; parser round-trip preserves the field.
- [ ] Run targeted Node/pytest tests and observe the intended failures.
- [ ] Compute expected price date using the existing calendar and job cutoff;
  preserve artifact identity and v1/v2/v3 parsing. Suppress current-condition
  reassurance for stale/missing quotes; retain dated historical values.
- [ ] Run targeted suites, compile and patch check; commit the change.

### Task 2: Concise shared brief and notification relevance

**Files:** summary_contract.py, notify.py, main.py, runtime/job.py,
app/lib/discord-interactions.mjs, test_core.py, test_runtime.py,
tests/discord-interactions.test.mjs.
**Interfaces:** preserve summaryV1 card kinds and version; concise Discord renderer
consumes the canonical artifact. Additional update identity uses existing state.
- [ ] Add red cases for <=900-character normal brief with three changes, long
  Unicode content, missing/stale sources, unconfigured account state, unrelated
  companies and repeat event/status transitions.
- [ ] Observe failures; produce one brief without routine chart attachments.
  Keep full chart data in artifact. Scope permitted updates to tracked companies;
  retain existing publication gates and dedup/failure semantics.
- [ ] Keep command replies short and link unsupported recording to the Portfolio view.
- [ ] Verify Python/Node notification and producer contracts; commit.

### Task 3: Four light card views and usable forms

**Files:** app/components/ActionCockpit.tsx, FriendlyCockpit.module.css,
PortfolioAccounts.tsx, EvidenceReviewForm.tsx, CockpitDetails.tsx, app/globals.css,
tests/ui/friendly-cockpit.test.tsx, portfolio-accounts.test.tsx,
tests/ui/cockpit-refresh.test.tsx.
**Interfaces:** four client views controlled by view query parameter, preserving
the existing root route and API endpoints; accountId selects an independent broker.
- [ ] Add red UI tests for navigation, setup instead of false zero count, dated
  watchlist data, status failures, readable account activity, structured evidence
  validation and dialog return/focus behavior.
- [ ] Observe failures; compose Overview/Portfolio/Research/Assistant from retained
  components, light tokens and accessible cards. Use existing backend validation.
- [ ] Remove unused duplicate visual code after searching callers; retain stored
  history and keep technical diagnostics out of primary flows.
- [ ] Run UI suite, lint/typecheck, npm test and patch check; commit.

### Task 4: Feature audit, browser QA and release preview

**Files:** docs/research/2026-10-14-cockpit-refresh-verification.md.
**Interfaces:** no production mutation during preview; canonical Worker build.
- [ ] Run documented Python compile/tests and current CI research/producer tests.
  Run npm lint/typecheck/test and production build/package dry-run.
- [ ] Use Browser/IAB to exercise four views, details, accounts, forms and retries at
  desktop/mobile sizes with a clearly labeled local fixture, not fake live results.
- [ ] Fix reproduced defects with regression tests; capture preview screenshots.
- [ ] Obtain one independent whole-branch review; resolve important findings.
- [ ] Commit verification report and prepare a concrete release approval request.
