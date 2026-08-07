# TASI Research Agent Lean Beta Implementation Plan

> **For agentic workers:** Use test-driven development; keep this release inside the existing private Sites app.

**Goal:** Deliver a private, cited research workspace and per-stock chat for
qualified scanner ideas without a separate backend platform.

**Architecture:** Vinext route handlers authenticate the private Sites user,
own the OpenAI request, and use D1 `DB` for report, thread, and budget state.
The existing deterministic dashboard remains read-only input.

## Constraints

- No Cloud Run, FastAPI, Firestore, broker integration, prediction, trade,
  ledger, portfolio, or scanner-rule changes.
- Qualified cards only; deterministic technical/entry sections are never
  model-authored; verdicts are only RESEARCH/WAIT/SKIP.
- Server-only key, owner allowlist, D1 transaction for budget and same-day run
  creation, 45-SAR stop, citations from URL annotations only.

### Task 1: Lean research server and D1 store

Create `db/schema.ts`, `app/lib/research-store.ts`,
`app/lib/research-agent.ts`, and private route handlers under `app/api/research`.
Modify `.openai/hosting.json`, `vite.config.ts`, and add Node tests.

1. Write failing tests for absent/non-owner identity, unqualified-symbol
rejection, deterministic sections, one same-day report, failed-report retry,
45-SAR rejection, and annotation-only citations.
2. Implement the smallest D1 schema and transactional store: reports, messages,
and monthly budget. The route derives fixed server-side operation estimates;
the client cannot supply cost or identity.
3. Implement report creation with required web search and saved annotations;
implement no-browse chat against saved evidence; use a fake provider in tests.
4. Run focused tests, `npm test`, `npm run lint`, and `git diff --check`.

### Task 2: Research workspace and rollout

Create `app/components/ResearchWorkspace.tsx` and its stylesheet. Modify
`ActionCockpit`, fixtures, and frontend tests.

1. Write failing tests for opening Research from a qualified card, immediate
deterministic sections, clickable citations, cached reopen, manual-price
labelling, error state, budget display, and no withheld-name comparison.
2. Implement the responsive split workspace, bilingual reply choice, per-stock
chat, refresh confirmation, and feature-flag fallback. Do not add trade UI.
3. Run focused UI tests, full frontend/Python tests, build, lint, and diff
check. Deploy through Sites only after the private environment values are set;
smoke test one report, chat, cache hit, budget stop, and disabled flag.
