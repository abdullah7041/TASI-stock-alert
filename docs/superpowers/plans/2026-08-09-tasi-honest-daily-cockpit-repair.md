# TASI Honest Daily Cockpit Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty and fixture-backed cockpit with an authenticated, delayed/daily pre-open snapshot that is retained and visibly stale after a missed refresh.

**Architecture:** The Python digest will use one structured scanner result for both Discord and the dashboard snapshot. The Sites application validates and stores that snapshot, calculates Riyadh freshness server-side, and uses the stored current snapshot for dashboard and research authorization.

**Tech Stack:** Python 3.12 and pytest; React 19 and TypeScript; Vinext/Cloudflare Workers; D1; Node test runner; GitHub Actions; Sites.

## Global Constraints

- Delayed/daily data is never labelled live or real-time.
- Only the Sunday-through-Thursday pre-open digest updates the dashboard.
- Invalid or failed replacement data never deletes the prior valid snapshot.
- Freshness is calculated server-side in Asia/Riyadh; Friday and Saturday preserve Thursday's snapshot.
- Research and chat accept only current two-condition candidates in the stored snapshot.
- The site stays owner-only; private automation uses a Sites credential and a distinct ingestion secret.

---

### Task 1: Share Scanner Output and Generate Complete Snapshots

**Files:**

- Modify: `main.py:154-353`
- Modify: `test_core.py:1419-1475`

**Interfaces:** `_scanner_result() -> dict` returns `candidates`, `names`, `indexUnavailable`, and `warning`; `_dashboard_snapshot(regime, recs, budget, scanner_result) -> dict` returns a versioned daily snapshot.

- [ ] **Step 1: Write failing producer tests**

```python
def test_dashboard_snapshot_includes_real_scanner_candidates():
    snapshot = m._dashboard_snapshot("breakdown", [], {"monthly_cap": 500.0}, {
        "candidates": [{"code": "1150", "conditions_met": 2, "rel_strength": 10.4, "squeeze_met": True}],
        "names": {"1150": "Alinma Bank"}, "indexUnavailable": False, "warning": None,
    }, as_of="2026-08-09T06:45:00Z")
    assert snapshot["qualified"][0]["code"] == "1150"
    assert snapshot["tradeDate"] == "2026-08-09"
```

- [ ] **Step 2: Run red test**

Run: `python -m pytest test_core.py -k dashboard_snapshot -v`

Expected: FAIL because the current snapshot receives `None` for the scanner result and has no date/schema metadata.

- [ ] **Step 3: Implement the smallest shared scanner-result path**

```python
scanner_result = _scanner_result()
msg = msg + "\n\n" + nt.format_scanner_block(scanner_result["candidates"], scanner_result["names"], index_unavailable=scanner_result["indexUnavailable"])
_save(DASHBOARD_FILE, _dashboard_snapshot(regime, recs, budget, scanner_result))
```

Return an explicit warning from `_scanner_result()` on scanner failure and copy it into the snapshot rather than representing failure as an empty successful scan.

- [ ] **Step 4: Run green test**

Run: `python -m pytest test_core.py -k 'dashboard_snapshot or mode_digest' -v`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add main.py test_core.py && git commit -m "fix: preserve real scanner data in cockpit snapshots"`

### Task 2: Validate Snapshots and Calculate Riyadh Freshness

**Files:**

- Modify: `app/lib/dashboard-core.mjs:1-13`
- Modify: `app/lib/dashboard-store.ts:1-20`
- Modify: `app/api/dashboard/route.ts:1-9`
- Modify: `tests/dashboard-core.test.mjs:1-13`

**Interfaces:** `parseDashboardSnapshot(value)` validates schema version, trade date, delayed/daily status, warnings, and list entries. `dashboardFreshness(snapshot, now) -> "current" | "stale"` is pure and server-consumed.

- [ ] **Step 1: Write failing snapshot tests**

```javascript
test("accepts a versioned delayed daily snapshot", () => {
  const snapshot = parseDashboardSnapshot({ ...validSnapshot, schemaVersion: 1, tradeDate: "2026-08-09", dataStatus: "delayed-daily", warnings: [] });
  assert.equal(snapshot.dataStatus, "delayed-daily");
});

test("keeps Thursday current during the Riyadh weekend", () => {
  assert.equal(dashboardFreshness(thursdaySnapshot, new Date("2026-08-14T09:00:00Z")), "current");
});
```

- [ ] **Step 2: Run red test**

Run: `node --test tests/dashboard-core.test.mjs`

Expected: FAIL because the metadata and freshness export do not exist.

- [ ] **Step 3: Implement contract and calendar logic**

```javascript
export function dashboardFreshness(snapshot, now = new Date()) {
  return snapshot.tradeDate >= expectedSnapshotDateInRiyadh(now) ? "current" : "stale";
}
```

Set the expected deadline to 10:15 Riyadh. GET returns `{ snapshot, freshness }` for stored data and 404 only when no snapshot exists.

- [ ] **Step 4: Run green test**

Run: `node --test tests/dashboard-core.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add app/lib/dashboard-core.mjs app/lib/dashboard-store.ts app/api/dashboard/route.ts tests/dashboard-core.test.mjs && git commit -m "fix: validate and age daily cockpit snapshots"`

### Task 3: Use Stored Current Data for Research and Chat

**Files:**

- Create: `app/lib/dashboard-access.ts`
- Modify: `app/api/research/report/route.ts:1-14`
- Modify: `app/api/research/chat/route.ts:1-14`
- Modify: `app/lib/research-agent.ts:72-113`
- Modify: `app/lib/research-core.mjs:1-50`
- Modify: `tests/research-core.test.mjs:1-100`

**Interfaces:** `currentQualifiedCandidate(snapshot, symbol, freshness)` returns one current two-condition candidate or throws; `loadCurrentResearchCandidate(symbol)` maps it to explicit HTTP errors.

- [ ] **Step 1: Write failing pure authorization tests**

```javascript
test("rejects research from a stale dashboard snapshot", () => {
  assert.throws(() => currentQualifiedCandidate(staleSnapshot, "1150", "stale"), /fresh daily snapshot/i);
});

test("returns a current stored candidate", () => {
  assert.equal(currentQualifiedCandidate(currentSnapshot, "1150", "current").code, "1150");
});
```

- [ ] **Step 2: Run red test**

Run: `node --test tests/research-core.test.mjs`

Expected: FAIL with missing export.

- [ ] **Step 3: Implement the access boundary**

```javascript
export function currentQualifiedCandidate(snapshot, symbol, freshness) {
  if (freshness !== "current") throw new Error("Research requires a fresh daily snapshot.");
  const candidate = snapshot.qualified.find((item) => item.code === symbol);
  if (!candidate || candidate.conditionsMet !== 2) throw new Error("This symbol is not available for research.");
  return candidate;
}
```

Load D1 in `dashboard-access.ts`; both routes use it rather than `dashboardFixture`. Update research-agent snapshot typing to use `delayed-daily`.

- [ ] **Step 4: Run green test**

Run: `node --test tests/research-core.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add app/lib/dashboard-access.ts app/api/research/report/route.ts app/api/research/chat/route.ts app/lib/research-agent.ts app/lib/research-core.mjs tests/research-core.test.mjs && git commit -m "fix: base cockpit research on current stored data"`

### Task 4: Render Explicit Honest Cockpit States

**Files:**

- Create: `app/lib/dashboard-types.ts`
- Modify: `app/components/ActionCockpit.tsx:1-145`
- Modify: `app/components/ResearchWorkspace.tsx:1-120`
- Modify: `app/components/ActionCockpit.module.css`
- Modify: `tests/action-cockpit.test.mjs:1-55`

**Interfaces:** Dashboard GET provides `{ snapshot, freshness }`. The client holds `loading`, `ready`, and `unavailable` state while stored snapshot freshness determines research availability.

- [ ] **Step 1: Write failing rendered-output tests**

```javascript
test("renders an unavailable state instead of endless loading", async () => {
  const html = await renderDashboard();
  assert.match(html, /No verified daily snapshot is available/i);
});

test("does not import the preview fixture into the cockpit", () => {
  assert.doesNotMatch(readFileSync(new URL("../app/components/ActionCockpit.tsx", import.meta.url), "utf8"), /fixtures\/dashboard/);
});
```

- [ ] **Step 2: Run red test**

Run: `npm run build && node --test tests/action-cockpit.test.mjs`

Expected: FAIL because the current component renders a perpetual loading paragraph and imports fixture types.

- [ ] **Step 3: Implement unconditional hooks and state rendering**

```tsx
const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
const [state, setState] = useState<DashboardState>({ kind: "loading" });

if (state.kind === "unavailable") return <UnavailableCockpit />;
if (state.kind === "loading") return <LoadingCockpit />;
const researchEnabled = state.freshness === "current" && import.meta.env.VITE_AGENT_ENABLED !== "false";
```

Move dashboard types out of the fixture, show timestamp/status/warnings, display a stale warning, disable stale research, and render neutral empty lists.

- [ ] **Step 4: Run green test**

Run: `npm run build && node --test tests/action-cockpit.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add app/lib/dashboard-types.ts app/components/ActionCockpit.tsx app/components/ResearchWorkspace.tsx app/components/ActionCockpit.module.css tests/action-cockpit.test.mjs && git commit -m "fix: show honest daily cockpit states"`

### Task 5: Authenticate the Private Scheduled Upload and Verify Production

**Files:**

- Modify: `.github/workflows/tasi.yml:61-69`
- Modify: `tests/action-cockpit.test.mjs`

**Interfaces:** GitHub secrets `COCKPIT_SIWC_BYPASS_TOKEN` and `COCKPIT_INGEST_TOKEN` become distinct `OAI-Sites-Authorization` and `Authorization` request headers.

- [ ] **Step 1: Write failing workflow contract test**

```javascript
test("uses separate Sites and app credentials for ingestion", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tasi.yml", import.meta.url), "utf8");
  assert.match(workflow, /COCKPIT_SIWC_BYPASS_TOKEN/);
  assert.match(workflow, /OAI-Sites-Authorization: Bearer/);
});
```

- [ ] **Step 2: Run red test**

Run: `node --test tests/action-cockpit.test.mjs`

Expected: FAIL because the bypass header is absent.

- [ ] **Step 3: Implement private automation access**

```yaml
env:
  COCKPIT_SIWC_BYPASS_TOKEN: ${{ secrets.COCKPIT_SIWC_BYPASS_TOKEN }}
  COCKPIT_INGEST_TOKEN: ${{ secrets.COCKPIT_INGEST_TOKEN }}
```

Add `OAI-Sites-Authorization: Bearer $COCKPIT_SIWC_BYPASS_TOKEN` to the upload request. Configure the existing Sites automation credential as the GitHub secret without printing it; do not weaken custom site access.

- [ ] **Step 4: Run all local verification**

Run: `python -m pytest test_core.py research/test_base_rate.py -v && npm test && npm run lint && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 5: Publish and prove one real snapshot**

Run: privately deploy the validated Sites version, dispatch `mode=digest`, then inspect the workflow, dashboard API response, and Sites worker logs.

Expected: ingest returns 200 and dashboard returns a current `delayed-daily` snapshot with no 401/404 in the relevant logs.

- [ ] **Step 6: Commit**

Run: `git add .github/workflows/tasi.yml tests/action-cockpit.test.mjs && git commit -m "fix: authenticate daily cockpit ingestion"`

## Final Verification Checklist

- [ ] `python -m pytest test_core.py research/test_base_rate.py -v` passes.
- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] `git diff --check` passes.
- [ ] The private deployment returns a saved delayed/daily snapshot.
- [ ] Stale data remains visible but research is disabled.
- [ ] Current stored candidates work for research; stale and unknown candidates are rejected.
