# TASI Managed Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Run validated rules with Cloud Scheduler, Cloud Run, and Firestore so scheduled state and delivery do not depend on GitHub Actions commits.

**Architecture:** Keep the pure modules from the reliability-core plan. Add a Firestore-backed RuntimeStore behind a small protocol, package main.py as a Cloud Run job, and invoke explicit preopen, monitor, and reconcile modes from Cloud Scheduler. GitHub Actions remains tests, manual smoke, and deployment only.

**Tech Stack:** Python 3.12, Google Cloud Run Jobs, Cloud Scheduler, Cloud Firestore Standard, google-cloud-firestore, pytest, GitHub Actions.

## Global Constraints

- Complete 2026-08-02-tasi-reliability-core.md first.
- Use the selected ten-minute cadence: 30 session runs × 3 holdings = 90 SAHMK Free requests/day.
- Scheduler cron only wakes the job; market_session.py suppresses closed/holiday runs.
- Firestore transactions perform database work only. Provider calls and Discord posts happen outside transactions.
- Secrets are Secret Manager values, never repository files or logs.
- Remove GitHub scheduled runs and state commits only after a test-channel canary succeeds.

---

## File structure

- Create: runtime_store.py — RuntimeStore protocol and MemoryRuntimeStore.
- Create: firestore_store.py — Firestore implementation and transaction-safe event claims.
- Create: market_session.py — Riyadh regular-session and configured-closure gate.
- Create: Dockerfile, .dockerignore, deploy/cloud-run-job.yaml, deploy/scheduler-jobs.yaml.
- Modify: main.py, config.py, requirements.txt, .github/workflows/tasi.yml, test_core.py, README.md.

### Task 1: Runtime store and transactional event claim

**Files:**
- Create: runtime_store.py, firestore_store.py
- Modify: requirements.txt
- Test: test_core.py

**Interfaces:**
- RuntimeStore.claim_event(event_id: str, payload: dict, now: datetime) -> bool
- RuntimeStore.mark_delivery(event_id: str, status: str, now: datetime, error: str | None = None) -> None
- RuntimeStore.record_snapshot(code: str, session_date: str, snapshot: dict) -> None
- RuntimeStore.load_symbols() -> dict and RuntimeStore.save_symbols(symbols: dict) -> None
- RuntimeStore.remaining_budget(month: str, monthly_cap: float) -> float and RuntimeStore.record_budget(month: str, allocations: list[dict]) -> None
- RuntimeStore.record_health(key: str, state: str, detail: str, now: datetime) -> bool

- [ ] **Step 1: Write a failing memory-store test**

~~~
def test_event_claim_is_atomic_from_callers_perspective():
    store = MemoryRuntimeStore()
    assert store.claim_event("abc", {"code": "2320"}, fixed_now())
    assert not store.claim_event("abc", {"code": "2320"}, fixed_now())
~~~

- [ ] **Step 2: Run the test**

Run: python -m pytest test_core.py -k event_claim -v

Expected: FAIL because runtime_store.py does not exist.

- [ ] **Step 3: Implement protocol and Firestore adapter**

Add google-cloud-firestore>=2.0 to requirements.txt. Put events at events/{event_id} with payload, state, created_at, updated_at, and attempts. Firestore claim_event opens a transaction, reads the event document, and creates state="pending" only when absent; it returns False for any existing event. Keep MemoryRuntimeStore deterministic for unit tests.

~~~
@firestore.transactional
def _claim(transaction, ref, payload, now):
    if ref.get(transaction=transaction).exists:
        return False
    transaction.set(ref, {"payload": payload, "state": "pending", "created_at": now})
    return True
~~~

- [ ] **Step 4: Verify transaction seam**

Mock the transaction and assert read occurs before set. Assert claim_event cannot call requests.post or data.get_quote.

Run: python -m pytest test_core.py -k "event_claim or firestore" -v

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add runtime_store.py firestore_store.py requirements.txt test_core.py
git commit -m "feat: add transactional runtime event store"
~~~

### Task 2: Runtime modes, Firestore artifacts, and session gate

**Files:**
- Create: market_session.py
- Modify: main.py:38-150, 195-365
- Modify: config.py, test_core.py

**Interfaces:**
- is_regular_session(now: datetime, closures: set[date]) -> bool
- build_runtime_store() -> RuntimeStore
- mode_preopen(now=None), mode_monitor(now=None), mode_reconcile(now=None) -> int

- [ ] **Step 1: Write failing mode tests**

~~~
def test_monitor_does_not_fetch_quotes_outside_session(monkeypatch):
    monkeypatch.setattr(m, "is_regular_session", lambda now, closures: False)
    monkeypatch.setattr(m.dat, "get_quote", pytest.fail)
    assert m.mode_monitor(now=fixed_friday()) == 0

def test_digest_records_snapshot_through_store(monkeypatch):
    store = MemoryRuntimeStore()
    monkeypatch.setattr(m, "build_runtime_store", lambda: store)
    m.mode_preopen(now=fixed_now())
    assert store.snapshots
~~~

- [ ] **Step 2: Run the tests**

Run: python -m pytest test_core.py -k "regular_session or snapshot_through_store" -v

Expected: FAIL because the modes and store seam are absent.

- [ ] **Step 3: Implement controlled runtime state**

Set RUNTIME["state_backend"] = "firestore" and RUNTIME["holiday_dates"] = []. market_session returns false Friday/Saturday, outside 10:00–15:00 Asia/Riyadh, and on configured closure dates. Implement Firestore collections symbols/{code}, budget/{month}, snapshots/{code}_{session_date}, and health/{key} through the RuntimeStore methods. Replace scheduled direct writes of STATE_FILE, HISTORY_FILE, BUDGET_FILE, and SYMBOLS_FILE with those methods; retain levels.json because it is reviewed configuration. Add mode aliases digest -> preopen and run -> monitor for manual compatibility.

- [ ] **Step 4: Verify regressions**

Run: python -m pytest test_core.py research/test_base_rate.py -v

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add market_session.py main.py config.py test_core.py
git commit -m "feat: add managed runtime modes and session gate"
~~~

### Task 3: Container, scheduler manifests, and GitHub CI change

**Files:**
- Create: Dockerfile, .dockerignore, deploy/cloud-run-job.yaml, deploy/scheduler-jobs.yaml
- Modify: .github/workflows/tasi.yml, README.md
- Test: test_core.py

- [ ] **Step 1: Write the failing deployment-file test**

~~~
def test_scheduler_manifest_has_explicit_modes_and_timezone():
    manifest = Path("deploy/scheduler-jobs.yaml").read_text(encoding="utf-8")
    assert "preopen" in manifest and "monitor" in manifest and "reconcile" in manifest
    assert "Asia/Riyadh" in manifest
~~~

- [ ] **Step 2: Run it**

Run: python -m pytest test_core.py -k scheduler_manifest -v

Expected: FAIL with FileNotFoundError.

- [ ] **Step 3: Create deployable artifacts**

Use python:3.12-slim, install requirements, copy application files, and set ENTRYPOINT ["python", "main.py"]. Define Cloud Scheduler jobs: 40 9 * * 0-4 -> preopen, */10 10-14 * * 0-4 -> monitor, and 10 15 * * 0-4 -> reconcile, all Asia/Riyadh with authenticated Cloud Run invocation. The application session gate remains authoritative for holidays.

Replace GitHub schedule with push/pull-request test triggers and a manual workflow_dispatch smoke mode. Delete the state-commit step and set permissions to contents: read.

- [ ] **Step 4: Verify and canary**

Run: python -m pytest test_core.py research/test_base_rate.py -v

Run: docker build -t tasi-alert:test .

Expected: both succeed. Deploy only with user-provided GCP project and Secret Manager values, run preopen and monitor against a test Discord webhook, and confirm complete cards, Firestore event documents, no state commit, and quote-age fields.

- [ ] **Step 5: Commit**

~~~
git add Dockerfile .dockerignore deploy .github/workflows/tasi.yml README.md test_core.py
git commit -m "feat: deploy TASI runtime as managed job"
~~~

### Task 4: Health transitions and operational telemetry

**Files:**
- Modify: main.py, runtime_store.py, firestore_store.py, notify.py, test_core.py, README.md

**Interfaces:**
- RuntimeStore.record_health(key, state, detail, now) returns True only when the visible state changes.
- emit_health_notice(store, key, state, detail, now) -> bool posts one degradation or recovery card.

- [ ] **Step 1: Write failing health-state tests**

~~~
def test_health_notice_is_deduplicated_until_recovery(monkeypatch):
    store = MemoryRuntimeStore()
    sent = []
    monkeypatch.setattr(m.nt, "send_discord", lambda cards: sent.append(cards) or True)
    assert m.emit_health_notice(store, "quote:2320", "degraded", "stale quote", fixed_now())
    assert not m.emit_health_notice(store, "quote:2320", "degraded", "stale quote", fixed_now())
    assert m.emit_health_notice(store, "quote:2320", "recovered", "fresh quote", fixed_now())
    assert len(sent) == 2
~~~

- [ ] **Step 2: Run the test**

Run: python -m pytest test_core.py -k health_notice -v

Expected: FAIL because emit_health_notice is absent.

- [ ] **Step 3: Implement stateful notices and structured logs**

Record scheduled-versus-start latency, execution duration, quote age, rejected observations, created/suppressed events, delivery attempts, and forecast abstentions as JSON log records. Store the most recent health state in health/{key}. emit_health_notice sends exactly one complete degraded card when a state first changes and one recovered card when it clears; it does not post repeated identical faults.

- [ ] **Step 4: Verify health behavior and full runtime verification**

Run: python -m pytest test_core.py research/test_base_rate.py -v

Expected: PASS.

Use the Cloud Run test-channel canary to confirm a stale quote emits one degraded notice and the next fresh quote emits one recovery notice.

- [ ] **Step 5: Commit telemetry**

~~~
git add main.py runtime_store.py firestore_store.py notify.py test_core.py README.md
git commit -m "feat: add runtime health transitions"
~~~
