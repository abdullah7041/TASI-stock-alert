# TASI Evidence Cockpit, Top 10, and Unusual-Movement Alerts Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in one agent. Do not dispatch subagents unless the user later reverses that instruction. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an evidence-first private TASI cockpit that tracks confirmed holdings and cash, maintains an approval-gated Top 10, records genuinely unusual delayed-price alerts, and displays only validated target-before-stop forecasts.

**Architecture:** Extend the existing Python producer and private Sites/D1 application instead of replacing them. Python owns point-in-time market analysis, sector-aware company scoring, unusual-movement detection, and forecast research; D1 owns durable proposals, approvals, portfolio events, and alert history; the React cockpit composes those records into the approved action-first layout. The broker application remains the real-time safety and execution layer.

**Tech Stack:** Python 3.12, pandas, numpy, scipy, scikit-learn, pytest, TypeScript 5.9, React 19, vinext/Vite, Cloudflare Workers/D1, Node test runner, GitHub Actions, Codex recurring automation.

## Global Constraints

- Do not describe bot observations or alerts as real time; use `delayed-intraday`, `delayed-daily`, `official-filing`, or `manual`.
- Keep the last valid snapshot and last approved Top 10 visible when a refresh fails.
- The user confirms every trade and every Top 10 approval; no order or approval is automatic.
- Any TASI company may qualify, but require a verified symbol, sector, at least 130 daily bars, and median 60-session traded value of at least 50,000 SAR.
- Use sector-specific evidence forms for operating companies, banks, insurers, and REITs.
- Limit the approved Top 10 to two companies per sector.
- Replace an eligible incumbent only when a challenger scores at least 5.0 points higher.
- Add at most one 500 SAR external contribution per calendar month; confirmed unspent cash and sale proceeds carry forward.
- TASI shares are whole shares; a proposal cannot exceed confirmed available cash.
- Price unusualness is required for an alert. Volume and news can explain an alert but cannot create one.
- Version-1 movement thresholds are 1.5% absolute excess move, robust z-score 4.0, 20 comparable observations, 60-minute cooldown, and z-score below 2.0 to rearm.
- A forecast is unavailable unless it beats the constant base rate on untouched data, has expected calibration error at most 0.05, positive after-cost expectancy, and stable out-of-sample skill.
- News is a dated evidence overlay in this release and cannot change the numerical score or forecast.
- Preserve unrelated `.agents/`, `.tmp/`, `docs/research/`, `skills-lock.json`, and user-owned working-tree changes.
- Execute implementation in an isolated worktree created with `superpowers:using-git-worktrees`.
- Do not use subagents; execute inline with checkpoints unless the user explicitly changes this constraint.

---

## File structure

- Create `app/lib/evidence-types.ts` — shared source/freshness, score, Top 10, portfolio, alert, and forecast types.
- Create `app/lib/portfolio-core.mjs` and `app/lib/portfolio-core.d.mts` — pure ledger folding and monthly allocation proposal.
- Create `app/lib/portfolio-store.ts` — D1 portfolio event persistence.
- Create `app/lib/top10-store.ts` — D1 proposal and approval persistence.
- Create `app/lib/alert-store.ts` — D1 alert-history persistence.
- Create `app/api/portfolio/route.ts` and `app/api/portfolio/events/route.ts` — read state and confirm idempotent events.
- Create `app/api/top10/route.ts` and `app/api/top10/approve/route.ts` — read approved/draft lists and approve or reject drafts.
- Create `app/api/alerts/route.ts` — read paginated delayed alert history.
- Create `research/company_evidence.py` — validate dated sector-specific research records.
- Create `research/top10.py` — calculate transparent scores and controlled Top 10 selection.
- Create `research/company_evidence.json` — monthly skill-produced primary-source evidence records.
- Create `movement.py` — adaptive market/sector-adjusted unusual-price detector.
- Create `movement_state.json` — committed baseline/cooldown state seeded as an empty versioned document.
- Create `research/entry_outcomes.py`, `research/entry_forecast.py`, and `research/test_entry_forecast.py` — abstaining target-before-stop research pipeline.
- Create `tests/portfolio-core.test.mjs` — ledger and allocation tests.
- Create `tests/evidence-cockpit.test.mjs` — UI and protected mutation-route tests.
- Modify `db/schema.ts` — declare durable D1 tables.
- Modify `app/lib/dashboard-types.ts`, `app/lib/dashboard-core.mjs`, and `app/lib/dashboard-core.d.mts` — admit schema version 2 and its evidence sections.
- Modify `app/lib/dashboard-store.ts` and `app/api/dashboard/ingest/route.ts` — atomically retain latest snapshot while appending proposal and alert history.
- Modify `app/components/ActionCockpit.tsx` and `app/components/ActionCockpit.module.css` — implement Option A.
- Modify `main.py`, `scanner.py`, `notify.py`, `config.py`, `test_core.py`, and `requirements.txt` — produce the new evidence, alerts, and forecast state.
- Modify `.github/workflows/tasi.yml` and `.github/workflows/ci.yml` — run the correct delayed checks and verification without claiming dependable real-time scheduling.
- Modify `README.md` — document the operating and approval runbook.

### Task 1: Introduce the version-2 evidence contract

**Files:**
- Create: `app/lib/evidence-types.ts`
- Modify: `app/lib/dashboard-types.ts`
- Modify: `app/lib/dashboard-core.mjs`
- Modify: `app/lib/dashboard-core.d.mts`
- Test: `tests/dashboard-core.test.mjs`

**Interfaces:**
- Produces: `SourceStamp`, `Top10Entry`, `Top10Proposal`, `PortfolioView`, `MovementAlert`, `ForecastView`.
- Produces: `parseDashboardSnapshot(value: unknown): DashboardSnapshotV1 | DashboardSnapshotV2`.
- Preserves: schema-version-1 parsing during the migration.

- [ ] **Step 1: Write the failing version-2 parser test**

```js
test("accepts separately dated market, research, portfolio, alert, and forecast evidence", () => {
  const snapshot = parseDashboardSnapshot({
    schemaVersion: 2,
    tradeDate: "2026-08-12",
    asOf: "2026-08-12T12:00:00Z",
    regime: "ok",
    dataStatus: "delayed-daily",
    warnings: [], urgent: [], changed: [], qualified: [], researchCount: 0,
    monthlyBudgetSar: 500,
    summary: ["No confirmed trade requires action."],
    top10: { proposalId: "top10-2026-08-12", status: "draft", researchedAt: "2026-08-12T17:00:00Z", entries: [] },
    portfolio: { confirmedAt: "2026-08-12T17:05:00Z", cashSar: 500, contributionMonth: "2026-08", holdings: [], proposal: null },
    alerts: [],
    forecast: { status: "unavailable", asOf: "2026-08-12", reason: "Validation gates not passed." },
  });
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.top10.researchedAt, "2026-08-12T17:00:00Z");
  assert.equal(snapshot.forecast.status, "unavailable");
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `node --test tests/dashboard-core.test.mjs`

Expected: FAIL with `Unsupported dashboard snapshot version.`

- [ ] **Step 3: Add exact source and evidence types**

```ts
export type SourceStamp = {
  source: string;
  observedAt: string;
  receivedAt: string;
  latency: "delayed-intraday" | "delayed-daily" | "official-filing" | "manual";
  freshness: "current" | "stale" | "unknown";
  url?: string;
};

export type ForecastView =
  | { status: "unavailable"; asOf: string; reason: string }
  | { status: "available"; asOf: string; target: number; stop: number; horizonSessions: 60; targetFirstPct: number; confidence: "low" | "medium" | "high"; modelVersion: string };
```

Define all remaining shapes in the same file and make every date/source field required at its boundary. Implement reusable `object`, `enumValue`, `isoTimestamp`, `nonNegativeNumber`, and `optionalUrl` parser helpers. Admit both schema versions, but return the version-1 shape unchanged for existing stored snapshots.

- [ ] **Step 4: Verify parser compatibility and types**

Run: `node --test tests/dashboard-core.test.mjs`

Run: `npm run typecheck`

Expected: all dashboard parser tests PASS; typecheck PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add app/lib/evidence-types.ts app/lib/dashboard-types.ts app/lib/dashboard-core.mjs app/lib/dashboard-core.d.mts tests/dashboard-core.test.mjs
git commit -m "feat: add dated evidence dashboard contract"
```

### Task 2: Build the append-only portfolio and monthly cash ledger

**Files:**
- Create: `app/lib/portfolio-core.mjs`
- Create: `app/lib/portfolio-core.d.mts`
- Create: `app/lib/portfolio-store.ts`
- Create: `app/api/portfolio/route.ts`
- Create: `app/api/portfolio/events/route.ts`
- Create: `tests/portfolio-core.test.mjs`
- Modify: `db/schema.ts`
- Modify: `app/lib/cloudflare-env.d.ts`

**Interfaces:**
- Consumes: D1 `DB`, authenticated owner identity from `requireDashboardOwner(request)`.
- Produces: `foldPortfolio(events) -> { cashSar, holdings, contributionMonth, confirmedAt }`.
- Produces: `PortfolioStore.append(event)` with idempotent `operationId`.
- Endpoint: `GET /api/portfolio`.
- Endpoint: `POST /api/portfolio/events` with `contribution | buy | sell | cash_adjustment`.

- [ ] **Step 1: Write failing ledger tests**

```js
test("one monthly contribution and confirmed sale proceeds carry forward", () => {
  const events = [
    { operationId: "c-2026-08", kind: "contribution", month: "2026-08", cashSar: 500, confirmedAt: "2026-08-01T08:00:00Z" },
    { operationId: "b-1", kind: "buy", code: "1303", shares: 10, priceSar: 12, feesSar: 0, confirmedAt: "2026-08-02T08:00:00Z" },
    { operationId: "s-1", kind: "sell", code: "1303", shares: 4, priceSar: 13, feesSar: 0, confirmedAt: "2026-09-02T08:00:00Z" },
  ];
  const state = foldPortfolio(events);
  assert.equal(state.cashSar, 432);
  assert.equal(state.holdings[0].shares, 6);
  assert.throws(() => foldPortfolio([...events, events[0]]), /duplicate operation/i);
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `node --test tests/portfolio-core.test.mjs`

Expected: FAIL because `portfolio-core.mjs` does not exist.

- [ ] **Step 3: Implement the ledger and D1 transaction boundary**

Add these tables to `researchSchemaStatements`:

```sql
CREATE TABLE IF NOT EXISTS portfolio_events (
  operation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  month_key TEXT,
  symbol TEXT,
  shares INTEGER,
  price_sar REAL,
  cash_sar REAL,
  fees_sar REAL NOT NULL DEFAULT 0,
  reason TEXT,
  confirmed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_contribution_per_owner_month
ON portfolio_events(owner_id, month_key) WHERE event_kind = 'contribution';
```

Validate positive whole shares, non-negative prices and fees, sale quantity not exceeding confirmed holdings, contribution exactly `500`, and a required reason for cash adjustments. Insert by `operation_id`; return the existing event for an exact retry and `409` for conflicting payload reuse.

- [ ] **Step 4: Verify ledger invariants and route compilation**

Run: `node --test tests/portfolio-core.test.mjs`

Run: `npm run typecheck`

Expected: PASS, including duplicate contribution, oversell, overspend, event retry, and cash carry-forward cases.

- [ ] **Step 5: Commit the portfolio ledger**

```bash
git add app/lib/portfolio-core.mjs app/lib/portfolio-core.d.mts app/lib/portfolio-store.ts app/api/portfolio app/lib/cloudflare-env.d.ts db/schema.ts tests/portfolio-core.test.mjs
git commit -m "feat: add confirmed portfolio cash ledger"
```

### Task 3: Validate sector-specific company evidence

**Files:**
- Create: `research/company_evidence.py`
- Create: `research/company_evidence.json`
- Create: `research/test_company_evidence.py`
- Modify: `requirements.txt`

**Interfaces:**
- Produces: `EvidenceRecord.from_dict(value: dict) -> EvidenceRecord`.
- Produces: `load_evidence(path, as_of) -> dict[str, EvidenceRecord]`.
- Sector kinds: `operating`, `bank`, `insurer`, `reit`.

- [ ] **Step 1: Write failing sector-form and point-in-time tests**

```python
def test_bank_requires_asset_quality_and_capital_fields():
    record = valid_record("bank")
    del record["metrics"]["capital_adequacy_pct"]
    with pytest.raises(ValueError, match="capital_adequacy_pct"):
        EvidenceRecord.from_dict(record)

def test_future_filing_is_not_visible_to_an_earlier_score_date():
    record = valid_record("operating", published_at="2026-08-12T12:00:00Z")
    with pytest.raises(ValueError, match="after score date"):
        load_evidence_records([record], as_of=date(2026, 8, 11))
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `python -m pytest research/test_company_evidence.py -v`

Expected: FAIL because `research.company_evidence` does not exist.

- [ ] **Step 3: Implement strict dated forms**

Use dataclasses with these required metric keys:

```python
REQUIRED_METRICS = {
    "operating": {"profitability_direction", "cash_conversion", "leverage_resilience", "earnings_stability"},
    "bank": {"roe_direction", "income_direction", "cost_efficiency", "asset_quality", "impairment_coverage", "capital_adequacy_pct", "liquidity"},
    "insurer": {"insurance_revenue_direction", "service_result_direction", "claims_quality", "csm_direction", "investment_quality", "solvency"},
    "reit": {"occupancy_pct", "rental_income_direction", "distribution_coverage", "leverage", "refinancing_risk", "concentration_risk", "nav_discount_pct"},
}
```

Each metric is a structured observation, not a bare analyst number:

```python
@dataclass(frozen=True)
class MetricEvidence:
    raw_value: str
    prior_value: str
    grade: int  # 0 failed, 1 weakening, 2 stable, 3 improving, 4 strongly improving
    explanation: str
    source_url: str
```

Add the common keys `valuation_context`, `downside_risk`, and `official_catalyst` to every sector form. Require `symbol`, `companyName`, `sector`, `sectorKind`, `reportPeriod`, `publishedAt`, `retrievedAt`, `sourceName`, `sourceUrl`, `metrics`, `riskFlags`, and `analystNotes`. Validate every grade is an integer from 0 through 4 and every grade has current/prior raw values and an explanation. Reject future-dated use, unsupported sectors, duplicate symbol/report-period records, non-HTTPS evidence links, and empty explanations for substituted metrics. Seed `company_evidence.json` as `{"schemaVersion":1,"records":[]}`; do not fabricate company facts.

- [ ] **Step 4: Verify evidence validation**

Run: `python -m pytest research/test_company_evidence.py -v`

Expected: PASS for all four sector forms, future-date exclusion, duplicate rejection, and empty seed loading.

- [ ] **Step 5: Commit the evidence schema**

```bash
git add research/company_evidence.py research/company_evidence.json research/test_company_evidence.py requirements.txt
git commit -m "feat: validate sector-specific company evidence"
```

### Task 4: Score and select an approval-gated Top 10

**Files:**
- Create: `research/top10.py`
- Create: `research/test_top10.py`
- Modify: `scanner.py`
- Modify: `main.py`
- Modify: `config.py`
- Test: `test_core.py`

**Interfaces:**
- Consumes: scanner rows, evidence records, prior approved entries, owned symbols.
- Produces: `score_company(market, evidence) -> ScoreBreakdown`.
- Produces: `select_top10(scored, incumbents, owned, max_per_sector=2, replacement_buffer=5.0) -> list[Top10Entry]`.
- Produces: version-2 `top10` draft in `dashboard.json`.

- [ ] **Step 1: Write failing scoring and controlled-turnover tests**

```python
def test_top10_caps_each_sector_at_two_and_labels_holdings():
    chosen = select_top10(scored_companies(), incumbents=[], owned={"1303"})
    assert max(Counter(item.sector for item in chosen).values()) <= 2
    assert next(item for item in chosen if item.symbol == "1303").owned is True

def test_challenger_needs_five_point_buffer_to_replace_eligible_incumbent():
    incumbent = scored("1150", 80.0, sector="Banks")
    challenger = scored("1180", 84.9, sector="Banks")
    assert select_top10([incumbent, challenger], [incumbent], set())[0].symbol == "1150"
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `python -m pytest research/test_top10.py -v`

Expected: FAIL because `research.top10` does not exist.

- [ ] **Step 3: Implement transparent scoring and abstention**

```python
WEIGHTS = {
    "fundamental_direction": 30.0,
    "quality_resilience": 25.0,
    "swing_timing": 25.0,
    "valuation_downside": 10.0,
    "official_catalyst": 10.0,
}
HARD_EXCLUSIONS = {"auditor_qualification", "restatement", "trading_suspension", "severe_liquidity", "material_governance"}
```

Use these exact component formulas so the result is reproducible:

```python
def grade_mean(metrics, keys):
    return sum(metrics[key].grade for key in keys) / (4.0 * len(keys))

fundamental_direction = grade_mean(metrics, SECTOR_DIRECTION_KEYS[sector_kind])
quality_resilience = grade_mean(metrics, SECTOR_QUALITY_KEYS[sector_kind])
swing_timing = 0.50 * clamp(relative_strength_pct / 25.0, 0.0, 1.0) + 0.30 * float(trend_up) + 0.20 * clamp(reward_risk / 2.0, 0.0, 1.0)
valuation_downside = 0.50 * metrics["valuation_context"].grade / 4.0 + 0.50 * metrics["downside_risk"].grade / 4.0
official_catalyst = metrics["official_catalyst"].grade / 4.0
```

Define `SECTOR_DIRECTION_KEYS` and `SECTOR_QUALITY_KEYS` from the required keys in Task 3 with no key appearing in both groups. General news must not be an input. Require the Stage-A history/liquidity/symbol/sector gates before scoring. Update `scanner.scan` to expose broad eligible rows rather than treating the current two-condition result as the final Top 10. In `_dashboard_snapshot`, emit the new proposal as `draft` with deterministic ID `top10-<tradeDate>-<evidenceHash>`.

- [ ] **Step 4: Verify selection and current behavior**

Run: `python -m pytest research/test_top10.py test_core.py -k "top10 or dashboard_snapshot or scanner" -v`

Expected: PASS for weights summing to 100, hard exclusion, two-per-sector, incumbent buffer, owned labels, no-evidence abstention, and deterministic proposal ID.

- [ ] **Step 5: Commit Top 10 generation**

```bash
git add research/top10.py research/test_top10.py scanner.py main.py config.py test_core.py
git commit -m "feat: generate evidence-ranked Top 10 drafts"
```

### Task 5: Persist, approve, and reject Top 10 proposals

**Files:**
- Create: `app/lib/top10-store.ts`
- Create: `app/api/top10/route.ts`
- Create: `app/api/top10/approve/route.ts`
- Modify: `app/api/dashboard/ingest/route.ts`
- Modify: `db/schema.ts`
- Test: `tests/evidence-cockpit.test.mjs`

**Interfaces:**
- Consumes: version-2 `Top10Proposal` from dashboard ingestion.
- Produces: `Top10Store.saveDraft`, `latestDraft`, `latestApproved`, `decide`.
- Endpoint: `GET /api/top10` returns `{ approved, draft }`.
- Endpoint: `POST /api/top10/approve` accepts `{ proposalId, decision: "approved" | "rejected", decidedAt }`.

- [ ] **Step 1: Write failing approval-boundary tests**

```js
test("ingestion saves a draft without replacing the approved list", async () => {
  await store.saveDraft(draft("p-2"));
  const view = await store.current();
  assert.equal(view.approved.proposalId, "p-1");
  assert.equal(view.draft.proposalId, "p-2");
});

test("approval is idempotent and a conflicting second decision is rejected", async () => {
  await store.decide("p-2", "approved", "2026-08-12T18:00:00Z");
  await store.decide("p-2", "approved", "2026-08-12T18:00:00Z");
  await assert.rejects(store.decide("p-2", "rejected", "2026-08-12T18:01:00Z"), /already decided/i);
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `npm run build && node --test tests/evidence-cockpit.test.mjs`

Expected: FAIL because Top 10 storage and routes do not exist.

- [ ] **Step 3: Add proposal and decision tables**

```sql
CREATE TABLE IF NOT EXISTS top10_proposals (
  proposal_id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  researched_at TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected')),
  decided_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_approved_top10
ON top10_proposals(status) WHERE status = 'approved';
```

When approving inside a D1 batch, demote the old approved row to `rejected`, then approve the selected draft. Require the same private owner boundary used by research routes. Dashboard ingestion may insert a draft but must never call `decide`.

- [ ] **Step 4: Verify mutation safety and readback**

Run: `npm run typecheck`

Run: `npm run build && node --test tests/evidence-cockpit.test.mjs`

Expected: PASS for unauthorized request, draft ingestion, approval, rejection, idempotent retry, and old-approved preservation.

- [ ] **Step 5: Commit Top 10 persistence**

```bash
git add app/lib/top10-store.ts app/api/top10 app/api/dashboard/ingest/route.ts db/schema.ts tests/evidence-cockpit.test.mjs
git commit -m "feat: add approval-gated Top 10 storage"
```

### Task 6: Produce cash-aware monthly action proposals

**Files:**
- Modify: `app/lib/portfolio-core.mjs`
- Modify: `app/lib/portfolio-core.d.mts`
- Modify: `app/api/portfolio/route.ts`
- Test: `tests/portfolio-core.test.mjs`

**Interfaces:**
- Consumes: folded portfolio, approved Top 10, latest delayed prices, material holding risks.
- Produces: `proposeMonthlyAction(input) -> buy | add | hold | trim | sell | hold_cash`.
- A proposal never mutates the ledger.

- [ ] **Step 1: Write failing whole-share and hold-cash tests**

```js
test("uses confirmed cash and can prefer adding to an owned Top 10 name", () => {
  const result = proposeMonthlyAction({
    cashSar: 620,
    holdings: [{ code: "1303", shares: 10 }],
    approved: [candidate("1303", 88, 12), candidate("1150", 82, 40)],
    materialRisks: [],
  });
  assert.deepEqual(result, { action: "add", code: "1303", shares: 51, estimatedSpendSar: 612, cashAfterSar: 8 });
});

test("holds cash when no whole share clears the evidence gate", () => {
  assert.equal(proposeMonthlyAction({ cashSar: 500, holdings: [], approved: [], materialRisks: [] }).action, "hold_cash");
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `node --test tests/portfolio-core.test.mjs`

Expected: FAIL because `proposeMonthlyAction` is absent.

- [ ] **Step 3: Implement deterministic proposal priority**

First propose `sell` or `trim` for owned symbols with a material hard-exclusion flag. Otherwise rank approved candidates by `totalScore / max(stopDistancePct, 0.01)`, prefer the higher value regardless of owned/new status, size the maximum affordable whole shares, and return `hold_cash` if none is affordable. Include `evidenceAsOf`, `priceAsOf`, `reason`, and `requiresConfirmation: true`. Never deduct proposed spend.

- [ ] **Step 4: Verify proposal isolation and affordability**

Run: `node --test tests/portfolio-core.test.mjs`

Expected: PASS for add, new buy, sell, trim, hold, hold cash, price above cash, and no mutation before confirmation.

- [ ] **Step 5: Commit monthly proposals**

```bash
git add app/lib/portfolio-core.mjs app/lib/portfolio-core.d.mts app/api/portfolio/route.ts tests/portfolio-core.test.mjs
git commit -m "feat: propose cash-aware monthly portfolio actions"
```

### Task 7: Detect and persist only unusual delayed price movement

**Files:**
- Create: `movement.py`
- Create: `movement_state.json`
- Create: `app/lib/alert-store.ts`
- Create: `app/api/alerts/route.ts`
- Modify: `main.py`
- Modify: `notify.py`
- Modify: `app/api/dashboard/ingest/route.ts`
- Modify: `db/schema.ts`
- Test: `test_core.py`
- Test: `tests/evidence-cockpit.test.mjs`

**Interfaces:**
- Produces: `detect_unusual_movement(observation, baseline, state, evidence) -> AlertDecision`.
- Produces: `MovementAlert` with deterministic `alertId`.
- Produces: `AlertStore.appendMany` and paginated `GET /api/alerts`.

- [ ] **Step 1: Write failing price-gate tests**

```python
def test_volume_without_unusual_price_never_alerts():
    decision = detect_unusual_movement(obs(excess_move_pct=0.4, volume_ratio=4.0), baseline(), empty_state(), [])
    assert decision.alert is None
    assert decision.suppressed_reason == "price gate not met"

def test_unusual_price_alert_is_delayed_and_rearms_only_below_two_z():
    first = detect_unusual_movement(obs(excess_move_pct=-2.1, robust_z=-4.8), baseline(), empty_state(), [])
    assert first.alert["latency"] == "delayed-intraday"
    assert detect_unusual_movement(obs(robust_z=-4.2), baseline(), first.state, []).alert is None
    rearmed = detect_unusual_movement(obs(robust_z=-1.8), baseline(), first.state, [])
    assert rearmed.state["armed"] is True
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `python -m pytest test_core.py -k unusual_movement -v`

Expected: FAIL because `movement.py` does not exist.

- [ ] **Step 3: Implement market/sector residual and robust baseline**

```python
MIN_EXCESS_MOVE_PCT = 1.5
MIN_ROBUST_Z = 4.0
MIN_COMPARABLE_OBSERVATIONS = 20
COOLDOWN_MINUTES = 60
REARM_Z = 2.0
VOLUME_CONFIRMATION_RATIO = 2.0
```

Calculate `excess = stock_return - beta_market * tasi_return - beta_sector * sector_return`; calculate robust z from same-symbol, same-15-minute-bucket residual history using `0.67448975 * (excess - median) / MAD`. Require both thresholds and acceptable freshness. Limit downside evaluation to holdings and upside evaluation to approved Top 10 symbols. Link official evidence published within the prior three trading days. Render `Delayed bot confirmation` and source/observed/received times in Discord.

Persist alerts during dashboard ingestion in `movement_alerts(alert_id PRIMARY KEY, symbol, direction, observed_at, alert_json, delivery_state)`. `INSERT OR IGNORE` exact retries. Do not replace the last dashboard snapshot if alert append fails; return a non-2xx response so the workflow retries the whole idempotent ingestion.

- [ ] **Step 4: Verify detector, deduplication, and delivery copy**

Run: `python -m pytest test_core.py -k "unusual_movement or alert" -v`

Run: `npm run build && node --test tests/evidence-cockpit.test.mjs`

Expected: PASS for volume-only suppression, stale suppression, both directions, cooldown, rearm, deterministic ID, D1 retry, and delayed wording.

- [ ] **Step 5: Commit delayed unusual-movement alerts**

```bash
git add movement.py movement_state.json main.py notify.py app/lib/alert-store.ts app/api/alerts app/api/dashboard/ingest/route.ts db/schema.ts test_core.py tests/evidence-cockpit.test.mjs
git commit -m "feat: add adaptive delayed movement alerts"
```

### Task 8: Add an abstaining target-before-stop forecast

**Files:**
- Create: `research/entry_outcomes.py`
- Create: `research/entry_forecast.py`
- Create: `research/test_entry_forecast.py`
- Modify: `requirements.txt`
- Modify: `main.py`
- Modify: `notify.py`
- Test: `test_core.py`

**Interfaces:**
- Produces: `label_entry_outcome(df, decision_index, atr, max_hold=60)`.
- Produces: `purged_time_splits(frame, gap_sessions=60)`.
- Produces: `release_gate(metrics, survivorship_limited) -> tuple[bool, list[str]]`.
- Produces: `ForecastView`; never consumed by `analyze.buy_decision` or budget sizing.

- [ ] **Step 1: Write failing collision and abstention tests**

```python
def test_same_daily_bar_touching_target_and_stop_counts_as_stop():
    assert label_entry_outcome(frame_with_collision(), 0, atr=1.0)["outcome"] == "stop"

def test_release_gate_rejects_model_that_does_not_beat_base_rate():
    ok, reasons = release_gate({"brier_skill": -0.01, "log_loss_skill": 0.02, "ece": 0.03, "expectancy": 0.5, "stable": True}, False)
    assert not ok
    assert "Brier" in " ".join(reasons)
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `python -m pytest research/test_entry_forecast.py -v`

Expected: FAIL because forecast modules do not exist.

- [ ] **Step 3: Implement point-in-time labels, baseline, model, and exact gates**

Use entry at the next session open, 3 ATR target, 1.5 ATR stop, 60-session maximum, and stop-first collision. Features are lagged relative strength, 5/20/60/120-session momentum, moving-average distances/slopes, RSI, ATR/price, squeeze percentile, liquidity, and market regime. Exclude news. Use a constant empirical-rate baseline followed by a standardized multinomial logistic regression. Split by unique decision date with a 60-session purge and untouched final period.

Reject publication if Brier skill or log-loss skill is not positive, ECE exceeds `0.05`, after-cost expectancy is not positive, skill is unstable by year/regime, bootstrap uncertainty includes zero, sample size is inadequate, or leakage remains. Serialize all reasons into the unavailable view.

- [ ] **Step 4: Verify isolation from trading decisions**

Run: `python -m pytest research/test_entry_forecast.py test_core.py -k "forecast or buy_decision or allocate_budget" -v`

Run: `rtk rg -n "forecast" analyze.py`

Expected: tests PASS; the search returns no forecast consumption in `analyze.py`.

- [ ] **Step 5: Commit forecast shadow mode**

```bash
git add research/entry_outcomes.py research/entry_forecast.py research/test_entry_forecast.py requirements.txt main.py notify.py test_core.py
git commit -m "feat: add abstaining target-before-stop forecast"
```

### Task 9: Compose the Option A action-first cockpit

**Files:**
- Modify: `app/components/ActionCockpit.tsx`
- Modify: `app/components/ActionCockpit.module.css`
- Modify: `app/page.tsx`
- Modify: `tests/action-cockpit.test.mjs`
- Modify: `tests/evidence-cockpit.test.mjs`

**Interfaces:**
- Consumes: dashboard v2, `GET /api/portfolio`, `GET /api/top10`, and `GET /api/alerts`.
- Produces: summary, alerts, portfolio, approved/draft Top 10, evidence, and confirmation controls.

- [ ] **Step 1: Write failing information-hierarchy tests**

```js
test("cockpit keeps dates and delayed boundary visible", () => {
  const source = readFileSync(new URL("../app/components/ActionCockpit.tsx", import.meta.url), "utf8");
  assert.match(source, /Today.s summary/i);
  assert.match(source, /Market observed/i);
  assert.match(source, /Evidence reviewed/i);
  assert.match(source, /Delayed bot confirmation/i);
  assert.match(source, /Broker app.*real-time/i);
});

test("draft Top 10 and trade proposals require explicit confirmation", () => {
  const source = readFileSync(new URL("../app/components/ActionCockpit.tsx", import.meta.url), "utf8");
  assert.match(source, /Approve Top 10/i);
  assert.match(source, /Confirm trade/i);
});
```

- [ ] **Step 2: Run the UI tests and verify the red state**

Run: `npm run build && node --test tests/action-cockpit.test.mjs tests/evidence-cockpit.test.mjs`

Expected: FAIL because the approved sections and controls are absent.

- [ ] **Step 3: Implement Option A in the approved order**

Render: header/date/freshness; `Today's summary`; delayed unusual alerts; portfolio and confirmed cash; approved Top 10; separate draft diff; score/evidence/forecast detail; safety footer. Use `<time dateTime>` for all dates. Label owned entries, proposal state, evidence age, data latency, and forecast abstention. Require a confirmation dialog that repeats symbol, shares, observed price/date, estimated cash effect, and the statement that no broker order will be sent.

Do not render `+` before negative relative strength. Do not hide stale sections; visually preserve them with disabled mutations and a reason. Keep research available only against current approved evidence.

- [ ] **Step 4: Verify responsive UI and accessibility**

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm test`

Expected: typecheck, lint, build, and all Node tests PASS; no fixture import returns.

- [ ] **Step 5: Commit the cockpit**

```bash
git add app/components/ActionCockpit.tsx app/components/ActionCockpit.module.css app/page.tsx tests/action-cockpit.test.mjs tests/evidence-cockpit.test.mjs
git commit -m "feat: build evidence-first TASI cockpit"
```

### Task 10: Schedule delayed refreshes and make production proof explicit

**Files:**
- Modify: `.github/workflows/tasi.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Test: `test_core.py`
- Test: `tests/action-cockpit.test.mjs`

**Interfaces:**
- Daily digest remains at 09:45 Riyadh through the existing best-effort workflow.
- Session checks remain 15-minute delayed checks, never exchange-crossing claims.
- Weekly Thursday-close run emits a Top 10 draft.
- Production verification reads `/api/dashboard`, `/api/top10`, `/api/portfolio`, and `/api/alerts` after ingestion.

- [ ] **Step 1: Write failing workflow-contract tests**

```python
def test_workflow_has_separate_weekly_top10_draft_mode():
    workflow = Path(".github/workflows/tasi.yml").read_text(encoding="utf-8")
    assert "mode=top10-draft" in workflow
    assert "Delayed bot confirmation" in Path("notify.py").read_text(encoding="utf-8")
```

- [ ] **Step 2: Run the focused tests and verify the red state**

Run: `python -m pytest test_core.py -k workflow -v`

Expected: FAIL because `top10-draft` is not scheduled.

- [ ] **Step 3: Add the weekly draft and readback checks**

Add a Thursday 15:30 Riyadh best-effort schedule that runs `MODE=top10-draft`, generates a version-2 snapshot, and ingests it with existing private Sites credentials. Keep production schedules and secrets in `tasi.yml`; keep Python/web read-only checks in `ci.yml`. After upload, call the four GET endpoints with private Sites authorization and assert:

- dashboard `snapshot.schemaVersion == 2` and returned `asOf` equals the uploaded snapshot;
- Top 10 approved state is unchanged while the new draft ID is present;
- portfolio cash and holdings are readable;
- newest alert ID, when uploaded, is present exactly once.

Update README with the broker/bot boundary, dates, monthly contribution, approval flow, evidence refresh, alert thresholds, forecast abstention, and recovery steps.

- [ ] **Step 4: Run the full local release gate**

Run: `python -m pytest test_core.py research/test_base_rate.py research/test_company_evidence.py research/test_top10.py research/test_entry_forecast.py -q`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm test`

Run: `git diff --check`

Expected: all commands PASS.

- [ ] **Step 5: Commit scheduling and runbook changes**

```bash
git add .github/workflows/tasi.yml .github/workflows/ci.yml README.md test_core.py tests/action-cockpit.test.mjs
git commit -m "chore: schedule evidence drafts and production proof"
```

### Task 11: Create the monthly evidence-refresh automation

**Files:**
- No application source changes.
- Runtime configuration: Codex recurring automation attached to this project.

**Interfaces:**
- Consumes: repository-local `research` skill, `docs/research/2026-08-12-tasi-top10-screening-standards.md`, current approved Top 10, holdings, and `research/company_evidence.json`.
- Produces: a dated Markdown research note and validated evidence-file draft; never an approval or confirmed trade.

- [ ] **Step 1: Verify the implementation prerequisite**

Run the complete Task 10 release gate and confirm the monthly evidence loader, draft generator, and approval UI exist. Do not create the automation before these consumers are available.

- [ ] **Step 2: Inspect existing automations and project identity**

Use the Codex automation tool to list or inspect matching automations and resolve the local project ID for `C:\Users\NoteBook Pc\Desktop\tasi-alert-system`. Reuse an existing `TASI monthly evidence refresh` automation if present; do not create a duplicate.

- [ ] **Step 3: Create the monthly project automation**

Configure a standalone local project run for the first Friday of each month at 18:00 Asia/Riyadh, using the lower-cost model selected at execution time and low reasoning. Its prompt must require the repository-local `research` skill, primary sources, explicit `publishedAt`/`retrievedAt`/URL fields, all four sector forms, validation tests, a dated note, and an approval request. It must explicitly prohibit auto-approval, trade confirmation, list replacement, outreach, or claims of currentness when retrieval fails.

- [ ] **Step 4: Read back and verify the automation**

Use the automation tool's view mode and confirm: correct project, monthly schedule, enabled status, local execution, research prompt, and no mutation authority beyond research artifacts and draft evidence.

- [ ] **Step 5: Record the operational handoff**

Add the automation name, human approval boundary, and failure-recovery instructions to the implementation handoff message. Do not store tool-generated automation identifiers or notification preferences in repository source.

### Task 12: Replay, production-verify, and stop before autonomous use

**Files:**
- No new feature files.
- Verification evidence is captured in the task handoff and, if requested, a dated report under `docs/superpowers/plans/`.

**Interfaces:**
- Consumes: completed Tasks 1-11.
- Produces: evidence that the end-to-end slice works without enabling automatic approval or trading.

- [ ] **Step 1: Replay fixed non-production fixtures**

Replay one volume-only suppressed observation, one upside approved-Top-10 alert, one downside holding alert, one duplicate alert, one stale observation, one Top 10 draft, and one confirmed portfolio event. Assert exact suppression/deduplication and cash results.

- [ ] **Step 2: Run the complete local verification suite**

Run the five Task 10 release-gate commands again from a clean isolated worktree and record exact pass counts and tool versions.

- [ ] **Step 3: Deploy privately and trigger one manual digest**

Publish only after explicit user authorization. Trigger `MODE=digest`, wait for completion, verify the ingest response, and read the four production endpoints. A successful deployment or green workflow without endpoint state is insufficient.

- [ ] **Step 4: Exercise approval and confirmation with non-production data**

Approve a seeded draft and confirm a seeded trade against a non-production D1/database. Read back the approved proposal, event ID, holdings, and cash; retry the same requests and prove idempotency. Do not create a real broker order.

- [ ] **Step 5: Present the final evidence and remaining boundaries**

Report local verification separately from production/API verification. State the exact market/evidence dates, delayed status, approved/draft Top 10 IDs, portfolio confirmation timestamp, alert replay results, forecast gate result, and monthly automation status. Keep automatic approval, real-time alert claims, and trading disabled.
