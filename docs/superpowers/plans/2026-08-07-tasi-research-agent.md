# TASI Research Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a private, deployable beta in which qualified TASI scanner
cards open a cited bilingual research workspace with grounded chat and
comparison, without changing deterministic investment decisions.

**Architecture:** The existing Python scanner produces read-only deterministic
snapshots. A FastAPI Cloud Run service performs report orchestration, signed
request validation, Firestore persistence, and OpenAI calls. The Sites-hosted
React cockpit calls same-origin proxy routes and renders a split research/chat
workspace.

**Tech Stack:** Python 3.13, FastAPI, Pydantic, OpenAI Responses API, Google
Cloud Run, Firestore, React 19, Vinext 0.0.50, Node test runner, pytest.

## Global Constraints

- Only `conditions_met >= 2` symbols can be researched or compared.
- Preserve all deterministic scanner, action-card, portfolio, and delayed-data
  behaviour. The agent cannot change entries, stops, targets, sizing, trades,
  or ledger records.
- `RESEARCH`, `WAIT`, and `SKIP` are the only agent verdicts; no `BUY` output.
- A report uses Terra plus web search; chat/comparison use Luna with saved
  evidence only. Source citations must be clickable in the UI.
- Enforce a 45 SAR application cap with Firestore reservations; display the 50
  SAR user budget and remaining amount.
- API keys and proxy secrets stay server-side. Owner allowlisting and identity
  checks occur in server code, never in the browser.
- Test-first: every production behavior begins with a focused failing test.

### Task 1: Agent domain contracts and deterministic report sections

**Files:**
- Create: `cockpit/research_contracts.py`, `cockpit/research_service.py`, `tests/test_research_service.py`
- Modify: `requirements.txt`

**Interfaces:**
- Produce `ResearchVerdict`, `Citation`, `ReportSection`, `ResearchReport`,
  `BudgetState`, and `ResearchRequest` Pydantic/dataclass contracts.
- Produce `ResearchService.start_report(request, snapshot)` and
  `ResearchService.compare(symbols, snapshot)`.
- `start_report` rejects unqualified symbols, returns deterministic Technical
  Setup and Entry Plan before research, and returns a same-date cache result
  without a new reservation.

- [ ] **Step 1: Write failing focused tests**

  Add tests proving an unqualified symbol is rejected, a qualified symbol emits
  deterministic sections with a delayed-data label, a same-date request reuses
  its report, and a 45-SAR cap prevents a new reservation.

- [ ] **Step 2: Run the focused tests**

  Run: `pytest tests/test_research_service.py -q`

  Expected: failure because the research contracts and service do not exist.

- [ ] **Step 3: Implement the smallest service boundary**

  Add explicit in-memory ports for deterministic snapshot lookup, report cache,
  and budget reservation. Keep Firestore and OpenAI out of this task; depend on
  typed protocols so later adapters are replaceable.

- [ ] **Step 4: Re-run focused and Python suites**

  Run: `pytest tests/test_research_service.py -q` and `pytest -q`

- [ ] **Step 5: Commit**

  Commit only Task 1 source, tests, and dependency manifest with message:
  `feat: add research agent domain contracts`.

### Task 2: FastAPI research service, secure proxy protocol, and durable adapters

**Files:**
- Create: `services/research_api/app.py`, `services/research_api/auth.py`, `services/research_api/firestore_store.py`, `services/research_api/openai_provider.py`, `services/research_api/requirements.txt`, `services/research_api/Dockerfile`, `tests/test_research_api.py`
- Modify: `requirements.txt`

**Interfaces:**
- `POST /v1/reports`, `GET /v1/reports/{report_id}/events`,
  `POST /v1/stocks/{symbol}/messages`, `POST /v1/comparisons`, and
  `GET /v1/budget` require a valid owner-signed proxy assertion.
- Report events use `section.ready`, `run.completed`, and `run.failed` with a
  complete `ResearchReport` payload. Duplicate user/symbol/date work reuses an
  active or completed report.
- Firestore adapters implement Task 1 ports with transaction-based budget
  reservation; OpenAI adapter returns typed sections and citation metadata.

- [ ] **Step 1: Write failing API tests**

  Add tests proving missing/expired signatures receive 401, unqualified report
  requests receive 403, valid report requests stream deterministic sections,
  chat returns saved citations without invoking web research, and an exhausted
  budget receives 429.

- [ ] **Step 2: Run focused API tests**

  Run: `pytest tests/test_research_api.py -q`

  Expected: failure because the FastAPI application does not exist.

- [ ] **Step 3: Implement minimum API and adapters**

  Verify an HMAC-signed `sub`, `email`, `exp`, and `request_id` assertion. Use
  bounded, structured Responses calls: report prompts require web search and
  preserve URL annotations; chat/comparison prompts have no web-search tool.
  Implement local fake adapters for tests and lazy Firestore/OpenAI clients so
  unit tests need no credentials.

- [ ] **Step 4: Re-run focused and Python suites**

  Run: `pytest tests/test_research_api.py -q` and `pytest -q`

- [ ] **Step 5: Commit**

  Commit only Task 2 files with message: `feat: add secure research API`.

### Task 3: Private Sites proxy routes and typed browser client

**Files:**
- Create: `app/api/agent/[...path]/route.ts`, `app/lib/agent-client.ts`, `app/lib/agent-types.ts`, `tests/agent-proxy.test.mjs`
- Modify: `.env.example`, `app/page.tsx`

**Interfaces:**
- The route reads `oai-authenticated-user-id` and
  `oai-authenticated-user-email`, rejects non-owner requests, signs the
  FastAPI assertion, and streams an upstream event response unchanged.
- `agent-client.ts` exposes `startReport`, `openReportEvents`, `sendMessage`,
  `compareQualified`, and `getBudget`; browser callers cannot supply identity
  or arbitrary backend URLs.

- [ ] **Step 1: Write failing proxy tests**

  Add tests proving absent identity is rejected, a non-owner identity is
  rejected, the proxy forwards only whitelisted paths, and an event stream
  preserves section event text.

- [ ] **Step 2: Run focused proxy tests**

  Run: `node --test tests/agent-proxy.test.mjs`

  Expected: failure because proxy helpers and routes do not exist.

- [ ] **Step 3: Implement proxy and client**

  Use server-only environment variables for the Cloud Run URL, owner email,
  and HMAC secret. Add an explicit preview-safe unavailable response when
  hosted configuration is missing. Do not add browser persistence for report
  history.

- [ ] **Step 4: Run focused and frontend suites**

  Run: `node --test tests/agent-proxy.test.mjs` and `npm test`

- [ ] **Step 5: Commit**

  Commit only Task 3 files with message: `feat: proxy private agent requests`.

### Task 4: Research workspace and qualified-candidate comparison

**Files:**
- Create: `app/components/ResearchWorkspace.tsx`, `app/components/ResearchWorkspace.module.css`, `tests/research-workspace.test.mjs`
- Modify: `app/components/ActionCockpit.tsx`, `app/components/ActionCockpit.module.css`, `app/fixtures/dashboard.ts`

**Interfaces:**
- The workspace renders Company & News, Technical Setup, Risks, Entry Plan,
  citations, report age, delayed status, verdict, budget, manual-price label,
  thread messages, and a comparison of qualified names.
- It handles `section.ready`, `run.completed`, and `run.failed` events without
  removing completed sections. Refresh requires confirmation and client state
  does not mutate the deterministic dashboard fixture.

- [ ] **Step 1: Write failing UI tests**

  Add tests proving a qualified card opens the split workspace, deterministic
  sections render before research results, citations are links, a manual price
  is labelled user-supplied, an unavailable section preserves the rest of the
  report, and comparison includes no withheld scanner names.

- [ ] **Step 2: Run focused UI tests**

  Run: `node --test tests/research-workspace.test.mjs`

  Expected: failure because the workspace does not exist.

- [ ] **Step 3: Implement the workspace**

  Preserve the current action-first cockpit. Add a responsive layout-A panel,
  English/Arabic reply control, per-stock conversation, refresh confirmation,
  and comparison view. The only primary action is research; no trade action is
  added.

- [ ] **Step 4: Run focused and frontend suites**

  Run: `node --test tests/research-workspace.test.mjs` and `npm test`

- [ ] **Step 5: Commit**

  Commit only Task 4 files with message: `feat: add cited research workspace`.

### Task 5: Deployment configuration and private-beta verification

**Files:**
- Create: `docs/deployment/tasi-research-agent.md`, `tests/test_openai_provider.py`
- Modify: `.github/workflows/tasi.yml`

**Interfaces:**
- Deployment documentation defines Cloud Run environment names, Secret Manager
  bindings, Firestore indexes, Site environment names, owner allowlisting,
  feature flag default, and a rollback that disables only the agent surface.
- Provider tests prove report prompts require web search with citation capture,
  chat/comparison requests omit browsing, and malformed provider output fails
  as a visible report failure rather than a deterministic scanner failure.

- [ ] **Step 1: Write failing provider/deployment-contract tests**

  Add tests proving report calls request web search and preserve citations;
  chat requests have no tool list; malformed structured output produces a
  typed failure event.

- [ ] **Step 2: Run focused provider tests**

  Run: `pytest tests/test_openai_provider.py -q`

  Expected: failure until the Task 2 provider is completed to the contract.

- [ ] **Step 3: Complete deployable configuration**

  Add Cloud Run container instructions and release workflow checks without
  placing credentials in the repository. Keep the feature flag disabled by
  default until Cloud Run, Firestore, and Sites environment values are present.

- [ ] **Step 4: Run all verification**

  Run: `pytest -q`, `npm test`, `npm run lint`, and `git diff --check`.

- [ ] **Step 5: Commit**

  Commit only Task 5 files with message: `chore: prepare research agent beta`.

## Completion Gate

After all tasks pass, deploy only after interactive Google Cloud authentication,
a billing-enabled project, and Secret Manager values are available. Smoke test
one qualified stock report, grounded chat, cached reopen, comparison, budget
rejection, unauthorized rejection, and disabled-feature fallback before merging
and publishing.
