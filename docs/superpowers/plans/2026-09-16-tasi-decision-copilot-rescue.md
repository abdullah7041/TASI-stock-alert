# TASI Decision Copilot Rescue Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan must be executed inline; the owner explicitly prohibited subagents.

**Goal:** Deliver the first working vertical slice of the approved cockpit: freshness first, verified event evidence second, unexplained anomalies kept separate, and the persistent copilot rail visibly reserved without pretending the assistant is configured.

**Architecture:** Keep the existing Python producer, Cloudflare Worker, D1, React cockpit, and Discord interaction endpoint. Add small canonical artifacts and pure projection functions at trust boundaries, then let the cockpit and Discord consume the same stored evidence and assistant service. Probabilities remain gated behind offline validation.

**Tech Stack:** Python 3.13, yfinance/pandas, TypeScript, React 19, Vinext, Cloudflare Workers, D1, Discord interactions, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-tasi-decision-copilot-rescue-design.md`

## Global Constraints

- Preserve three-way honesty: failed, valid-empty, and available data render differently.
- Keep the cockpit owner-only and never expose machine origins or credentials.
- Never save a decision without explicit owner confirmation; never send an order.
- Social accounts are discovery leads only; verification requires an official or trusted source.
- Do not expose probabilities unless an out-of-sample report beats the relevant base rate.
- Reuse existing dependencies and platform services; add no package unless the current stack cannot perform the task.
- Tests receive explicit clocks and unique data-cache periods.

---

### Task 1: Deterministic event and anomaly intelligence

**Files:**
- Create: `app/lib/market-intelligence.mjs`
- Create: `app/lib/market-intelligence.d.mts`
- Test: `tests/market-intelligence.test.mjs`

**Interfaces:**
- Consumes: `DashboardPayload['snapshot']` and `MovementAlert[]`.
- Produces: `buildMarketIntelligence(snapshot, alerts)` returning `{events, anomalies}` with verified-source status, observed reactions, and explicit causation language.

- [x] **Step 1: Write failing grouping and honesty tests**

```js
test('groups one verified headline across related stocks without claiming causation', () => {
  const view = buildMarketIntelligence(snapshotWithSharedOfficialHeadline(), []);
  assert.equal(view.events[0].related.length, 2);
  assert.equal(view.events[0].causation, 'not-proven');
});

test('keeps an unusual move with no timely verified news unexplained', () => {
  const view = buildMarketIntelligence(snapshotWithoutNews(), [movementAlert]);
  assert.equal(view.anomalies[0].status, 'unexplained');
});
```

- [x] **Step 2: Run the focused test and observe the missing-module failure**

Run: `node --test tests/market-intelligence.test.mjs`

- [x] **Step 3: Implement the smallest pure projection**

Recognize official/trusted HTTPS hosts, group duplicate headline URLs/titles, copy only finite observed changes, and never infer a sector or cause that is absent from the artifact.

- [x] **Step 4: Run focused and parser tests**

Run: `node --test tests/market-intelligence.test.mjs tests/dashboard-core.test.mjs`

### Task 2: Approved dashboard hierarchy

**Files:**
- Create: `app/components/IntelligenceBoard.tsx`
- Modify: `app/components/ActionCockpit.tsx`
- Modify: `app/components/FriendlyCockpit.module.css`
- Test: `tests/ui/friendly-cockpit.test.tsx`

**Interfaces:**
- Consumes: `buildMarketIntelligence(snapshot, alerts)` from Task 1.
- Produces: visible freshness summary, verified-event cards, separate unexplained-anomaly cards, and a persistent assistant rail container.

- [x] **Step 1: Add a failing UI test for hierarchy and evidence wording**

```tsx
test('shows freshness then verified events then unexplained anomalies with the assistant rail', () => {
  render(<ActionCockpit dashboard={payloadWithEvidence}/>);
  expect(screen.getByRole('region', {name:'Market intelligence'})).toBeTruthy();
  expect(screen.getByText(/causation is not proven/i)).toBeTruthy();
  expect(screen.getByRole('complementary', {name:'TASI copilot'})).toBeTruthy();
});
```

- [x] **Step 2: Run the UI test and observe the missing regions**

Run: `npx vitest run tests/ui/friendly-cockpit.test.tsx`

- [x] **Step 3: Implement the compact responsive layout**

Keep holdings and current controls intact. Put primary content in the left column and a sticky rail in the right column; collapse to one column on narrow screens.

- [x] **Step 4: Run the focused UI suite**

Run: `npx vitest run tests/ui/friendly-cockpit.test.tsx tests/ui/action-cockpit.test.tsx`

### Task 3: Phase 1 verification and checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-09-16-tasi-decision-copilot-rescue.md`
- Test: `tests/market-intelligence.test.mjs`
- Test: `tests/ui/friendly-cockpit.test.tsx`
- Test: existing CI suites

**Interfaces:**
- Produces a reviewed Phase 1 diff and records completed checkboxes in this plan.

- [x] **Step 1: Run focused evidence and UI tests**

Run: `node --test tests/market-intelligence.test.mjs && npx vitest run tests/ui/friendly-cockpit.test.tsx tests/ui/action-cockpit.test.tsx`

- [x] **Step 2: Run the exact Python and web CI commands from `AGENTS.md`**

Run: `python -m compileall -q main.py movement.py session_gate.py runtime research`

Run: `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q`

Run: `npm run lint && npm run typecheck && npm test`

- [x] **Step 3: Review the approved hierarchy against the rendered semantics**

Confirm freshness precedes market intelligence, verified evidence states that causation is not proven, unexplained anomalies do not acquire news, holdings remain visible, and the assistant rail says when configuration is still pending.

- [x] **Step 4: Run `git diff --check` and review every changed path**

Run: `git diff --check && git status --short`

- [x] **Step 5: Commit the isolated Phase 1 checkpoint**

```bash
git add app/components/ActionCockpit.tsx app/components/FriendlyCockpit.module.css app/components/IntelligenceBoard.tsx app/lib/market-intelligence.mjs app/lib/market-intelligence.d.mts tests/market-intelligence.test.mjs tests/ui/friendly-cockpit.test.tsx docs/superpowers/specs/2026-09-16-tasi-decision-copilot-rescue-design.md docs/superpowers/plans/2026-09-16-tasi-decision-copilot-rescue.md
git commit -m "feat: add evidence-first cockpit hierarchy"
```
