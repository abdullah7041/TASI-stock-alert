# TASI Action Cockpit Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a private, deployable Action Cockpit preview and the typed Python decision contract it will consume.

**Architecture:** The Sites-hosted vinext frontend renders an action-first dashboard from a local fixture. A small Python `cockpit` package converts the existing recommendation dictionaries into stable decision snapshots. The fixture follows that public snapshot shape, so replacing it with Cloud Run/FastAPI later does not redesign the UI.

**Tech Stack:** vinext, Next.js 16, React 19, TypeScript, Node test runner, Python 3.12+, pytest, existing TASI engine, Sites private hosting.

## Global Constraints

- Preserve the existing Python engine and its 196-test baseline.
- Treat all displayed price values as delayed/daily fixture data until a live API is configured.
- Home renders at most three `qualified` scanner cards; one-condition names remain research-only.
- No portfolio write, chat API call, or live market call exists in this foundation slice.
- Store only the opaque Sites `project_id` plus optional D1/R2 bindings in `.openai/hosting.json`.

---

### Task 1: Establish the deployable Site shell

**Files:**
- Create: `package.json`, `package-lock.json`, `next.config.ts`, `vite.config.ts`, `worker/index.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`
- Create: `app/layout.tsx`, `app/globals.css`, `tests/action-cockpit.test.mjs`

**Interfaces:**
- Produces: `npm run build` emits `dist/server/index.js`.
- Produces: `renderDashboard()` test helper returns server-rendered HTML for `/`.

- [ ] **Step 1: Write the failing render test**

```js
test("renders an action-first cockpit instead of a generic loading page", async () => {
  const response = await renderDashboard();
  const html = await response.text();
  assert.match(html, /TASI Action Cockpit/i);
  assert.doesNotMatch(html, /Your site is taking shape/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: FAIL because no vinext application or rendered cockpit exists.

- [ ] **Step 3: Add the vinext starter configuration**

Copy the bundled vinext starter configuration into the repository root, preserve
`.openai/hosting.json`, and set these scripts:

```json
{
  "dev": "WRANGLER_LOG_PATH=.wrangler/wrangler.log vinext dev",
  "build": "WRANGLER_LOG_PATH=.wrangler/wrangler.log vinext build",
  "test": "npm run build && node --test tests/action-cockpit.test.mjs",
  "lint": "eslint . --ignore-pattern dist --ignore-pattern .next"
}
```

- [ ] **Step 4: Add a minimal semantic application shell**

```tsx
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
```

Add a minimal `app/page.tsx` that renders `<main><h1>TASI Action Cockpit</h1></main>`;
Task 2 replaces this placeholder with the tested dashboard hierarchy.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`

Expected: PASS with the product shell replacing the starter preview.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts vite.config.ts worker tsconfig.json eslint.config.mjs postcss.config.mjs app/layout.tsx app/globals.css tests/action-cockpit.test.mjs
git commit -m "feat: add TASI cockpit site shell"
```

### Task 2: Build the action-first cockpit preview

**Files:**
- Create: `app/fixtures/dashboard.ts`
- Create: `app/components/ActionCockpit.tsx`
- Create: `app/components/ActionCockpit.module.css`
- Modify: `app/page.tsx`, `tests/action-cockpit.test.mjs`

**Interfaces:**
- Consumes: `DashboardFixture` from `app/fixtures/dashboard.ts`.
- Produces: `<ActionCockpit dashboard={fixture} />`.
- Produces: action cards with `data-state="urgent" | "changed" | "qualified"`.

- [ ] **Step 1: Write the failing behavior test**

```js
test("limits Home scanner cards to qualified names and labels preview data", async () => {
  const response = await renderDashboard();
  const html = await response.text();
  assert.match(html, /Preview data — delayed\/daily/i);
  assert.match(html, /Al-Babtain/i);
  assert.match(html, /Why this action\?/i);
  assert.equal((html.match(/data-state="qualified"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Tabuk Agricultural/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: FAIL because the fixture and action hierarchy do not exist.

- [ ] **Step 3: Add the stable fixture shape**

```ts
export type DashboardFixture = {
  asOf: string;
  dataStatus: "preview-delayed";
  urgent: Array<{ code: string; name: string; action: string; price: number; reason: string; pnlPct: number }>;
  changed: Array<{ code: string; name: string; status: string; reason: string }>;
  qualified: Array<{ code: string; name: string; relativeStrengthPct: number; squeeze: boolean }>;
  researchCount: number;
};
```

- [ ] **Step 4: Render the cockpit hierarchy**

Render `urgent` before `changed`, render only `qualified.slice(0, 3)`, and show
one compact `Scanner research` link with the withheld count. Every urgent card
includes `Review sale` and `Why this action?`; both are disabled preview controls
with an accessible `aria-label` describing the future action.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS with one qualified scanner card and no research-only name on Home.

- [ ] **Step 6: Commit**

```bash
git add app/fixtures/dashboard.ts app/components/ActionCockpit.tsx app/components/ActionCockpit.module.css app/page.tsx tests/action-cockpit.test.mjs
git commit -m "feat: add action-first cockpit preview"
```

### Task 3: Add typed engine-to-cockpit decision snapshots

**Files:**
- Create: `cockpit/__init__.py`, `cockpit/contracts.py`, `cockpit/dashboard.py`
- Create: `test_cockpit.py`

**Interfaces:**
- Consumes: the existing recommendation dictionaries returned by `main._collect_recs` and scanner candidate dictionaries.
- Produces: `build_dashboard_snapshot(recs: list[dict], candidates: list[dict], as_of: str) -> dict`.
- Produces: keys `urgent`, `changed`, `qualified`, and `research_count` matching the TypeScript fixture contract.

- [ ] **Step 1: Write the failing Python contract test**

```python
def test_dashboard_snapshot_hides_one_condition_scanner_candidates_from_home():
    snapshot = build_dashboard_snapshot(
        recs=[{"code": "2320", "name": "Al-Babtain", "action": "SELL (STOP)", "price": 55.7, "reason": ["stop breached"]}],
        candidates=[
            {"code": "6040", "conditions_met": 1, "rel_strength": 60.7},
            {"code": "9999", "conditions_met": 2, "rel_strength": 20.0},
        ],
        as_of="2026-08-03T09:40:00+03:00",
    )
    assert [card["code"] for card in snapshot["urgent"]] == ["2320"]
    assert [card["code"] for card in snapshot["qualified"]] == ["9999"]
    assert snapshot["research_count"] == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest test_cockpit.py -v`

Expected: FAIL because `cockpit.dashboard` does not exist.

- [ ] **Step 3: Add dataclass-backed snapshot builders**

`contracts.py` defines frozen `ActionCard`, `ScannerCard`, and `DashboardSnapshot`
dataclasses with `to_dict()` methods. `dashboard.py` classifies non-HOLD/WATCH
recommendations as urgent, sorts fully qualified candidates by relative strength,
and counts one-condition candidates as research-only.

- [ ] **Step 4: Run focused and baseline tests**

Run: `python -m pytest test_cockpit.py test_core.py research/test_base_rate.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cockpit test_cockpit.py
git commit -m "feat: add cockpit decision snapshot contract"
```

### Task 4: Publish the private cockpit preview

**Files:**
- Modify: `.openai/hosting.json`

**Interfaces:**
- Consumes: the validated `dist/` output and exact pushed source commit.
- Produces: an owner-only Sites deployment URL.

- [ ] **Step 1: Run final frontend and Python verification**

Run: `npm test && npm run lint && python -m pytest test_cockpit.py test_core.py research/test_base_rate.py -q && git diff --check`

Expected: every command exits 0.

- [ ] **Step 2: Push the exact source commit to the Sites source repository**

Use the short-lived Sites credential as a per-command HTTP header. Do not persist
the token in a URL, Git remote, configuration file, or terminal output.

- [ ] **Step 3: Package and save the version**

Run the bundled `package-site.sh` for this repository, save the version using the
exact pushed commit SHA, then deploy it with the private deployment connector.

- [ ] **Step 4: Verify deployment status**

Poll the deployment connector until it reports `succeeded`; open the returned
private URL in the app browser. Do not publish a shared or public URL.

- [ ] **Step 5: Commit no generated output**

Keep `dist/`, `.wrangler/`, and archives untracked; only source and lockfiles
belong in the repository.

## Deferred plans

The following independent work starts only after this foundation is verified:

1. FastAPI, Firestore ledger, Google identity, and Cloud Run API/job deployment.
2. OpenAI-backed cited research, tool authorization, and confirmation-gated transactions.
3. Point-in-time forecast dataset, validation pipeline, shadow display, and evidence-gated sizing.
