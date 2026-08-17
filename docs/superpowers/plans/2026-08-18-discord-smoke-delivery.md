# Discord Smoke Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual Discord delivery smoke test and make failed unusual-movement Discord deliveries fail the workflow.

**Architecture:** `main.py` owns mode-specific behavior. A new `discord-smoke` mode sends one labelled delivery-only message and returns the notifier result as the process status. The existing `run` mode stays alert-only, but propagates a failed notifier result when it has an alert to deliver. `.github/workflows/tasi.yml` exposes the manual mode while leaving existing ingest conditions unchanged.

**Tech Stack:** Python 3.12, pytest, GitHub Actions YAML, Discord webhook via `notify.send_discord`.

## Global Constraints

- `discord-smoke` is manual-only and sends one actual Discord message.
- Its message contains no market prices and states that no market data, dashboard update, alert, or order was created.
- The smoke mode must not call market-data collection, write state files, or call cockpit ingestion.
- `run` remains silent and successful when no new unusual movement exists.
- A required Discord delivery failure must exit non-zero.
- The broker app remains responsible for real-time price protection; the cockpit never places orders.
- Do not add dependencies or change scheduled cron timing, movement thresholds, dashboard schemas, or portfolio behavior.

---

## File Structure

- `main.py` — defines the new manual mode, adds it to `MODES`, and propagates a real alert-send failure.
- `test_core.py` — offline pytest coverage for smoke-message isolation, delivery success/failure, and `run` behavior.
- `.github/workflows/tasi.yml` — makes `discord-smoke` visible in the manual workflow input description; existing ingest allowlists deliberately omit it.

### Task 1: Lock down offline notification-mode behavior

**Files:**
- Modify: `test_core.py:80-127`

**Interfaces:**
- Consumes: `main.mode_discord_smoke() -> int`, `main.mode_run() -> int`, and `main.nt.send_discord(content: str) -> bool`.
- Produces: deterministic regression tests that make the new mode and delivery-failure contract executable without network access.

- [ ] **Step 1: Write the failing smoke-success test**

Add near the existing cockpit and session-mode tests:

```python
def test_discord_smoke_sends_one_labelled_delivery_only_message(monkeypatch):
    sent = []
    monkeypatch.setattr(main.nt, "send_discord", lambda content: sent.append(content) or True)
    monkeypatch.setattr(main, "_collect_recs", lambda **_: (_ for _ in ()).throw(AssertionError("smoke must not collect market data")))
    monkeypatch.setattr(main, "_save", lambda *_: (_ for _ in ()).throw(AssertionError("smoke must not write state")))

    assert main.mode_discord_smoke() == 0
    assert len(sent) == 1
    assert "TASI Discord delivery smoke test" in sent[0]
    assert "No market data, dashboard update, alert, or order was created." in sent[0]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest test_core.py -q -k discord_smoke_sends_one_labelled_delivery_only_message`

Expected: FAIL because `main.mode_discord_smoke` does not exist.

- [ ] **Step 3: Write the failing smoke-delivery-failure test**

```python
def test_discord_smoke_returns_failure_when_delivery_fails(monkeypatch):
    monkeypatch.setattr(main.nt, "send_discord", lambda _content: False)

    assert main.mode_discord_smoke() == 1
```

- [ ] **Step 4: Write the failing `run` delivery-contract tests**

```python
def test_session_mode_is_silent_and_successful_without_new_movement(monkeypatch):
    saved = {}
    monkeypatch.setattr(main, "_collect_recs", lambda **_: ("range", [], {"monthly_cap": 500.0}))
    monkeypatch.setattr(main, "_movement_alerts", lambda _recs: [])
    monkeypatch.setattr(main, "_save", lambda path, value: saved.setdefault(path, value))
    monkeypatch.setattr(main.nt, "send_discord", lambda *_: (_ for _ in ()).throw(AssertionError("no movement must not post")))

    assert main.mode_run() == 0
    assert saved[main.ALERTS_FILE] == {"alerts": []}


def test_session_mode_fails_when_movement_delivery_fails(monkeypatch):
    alert = {"alertId": "m-1303", "code": "1303", "direction": "upside", "observedAt": "2026-08-17T10:15:00Z", "receivedAt": "2026-08-17T10:18:00Z", "latency": "delayed-intraday", "excessMovePct": 2.4, "robustZ": 3.2, "reason": "Move exceeded delayed baseline."}
    monkeypatch.setattr(main, "_collect_recs", lambda **_: ("range", [{"code": "1303", "action": "BUY"}], {"monthly_cap": 500.0}))
    monkeypatch.setattr(main, "_movement_alerts", lambda _recs: [alert])
    monkeypatch.setattr(main, "_save", lambda *_: None)
    monkeypatch.setattr(main.nt, "send_discord", lambda _content: False)

    assert main.mode_run() == 1
```

- [ ] **Step 5: Run the focused tests to verify the pre-implementation failures**

Run: `python -m pytest test_core.py -q -k "discord_smoke or session_mode_is_silent_and_successful_without_new_movement or session_mode_fails_when_movement_delivery_fails"`

Expected: the smoke tests fail because the mode is absent; the movement-delivery failure test fails because `mode_run()` currently returns zero.

- [ ] **Step 6: Commit the test contract**

```bash
git add test_core.py
git commit -m "test: define Discord smoke delivery contract"
```

### Task 2: Implement the isolated smoke mode and truthful alert delivery status

**Files:**
- Modify: `main.py:261-264`
- Modify: `main.py:534-544`
- Modify: `main.py:645-657`

**Interfaces:**
- Consumes: `notify.send_discord(content: str) -> bool`.
- Produces: `mode_discord_smoke() -> int`; a `MODES["discord-smoke"]` entry; and `mode_run() -> int` that returns one only after a failed attempted alert delivery.

- [ ] **Step 1: Write the minimal smoke-mode implementation**

Insert directly below `mode_heartbeat`:

```python
def mode_discord_smoke() -> int:
    as_of = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    message = (
        "__**TASI Discord delivery smoke test**__\n"
        f"Executed {as_of}. No market data, dashboard update, alert, or order was created."
    )
    ok = nt.send_discord(message)
    print("discord smoke sent:", ok)
    return 0 if ok else 1
```

- [ ] **Step 2: Propagate a failed required alert delivery**

Replace `mode_run`'s unconditional final return with:

```python
    if movement_alerts:
        as_of = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        msg = nt.build_movement_alert_message(movement_alerts, as_of)
        ok = nt.send_discord(msg)
        print("movement alert sent:", ok, "| alerts:", len(movement_alerts))
        return 0 if ok else 1
    print("no new unusual movement; nothing sent.")
    return 0
```

- [ ] **Step 3: Register the manual mode**

Insert the mapping alongside the existing heartbeat entry:

```python
    "heartbeat": mode_heartbeat,
    "discord-smoke": mode_discord_smoke,
```

- [ ] **Step 4: Run the focused offline behavior tests**

Run: `python -m pytest test_core.py -q -k "discord_smoke or session_mode_is_silent_and_successful_without_new_movement or session_mode_fails_when_movement_delivery_fails or session_mode_sends_only_new_delayed_movement_cards"`

Expected: PASS. No network request occurs because every notifier call is mocked.

- [ ] **Step 5: Run the full Python gate**

Run: `python -m pytest test_core.py research/test_base_rate.py -q`

Expected: PASS.

- [ ] **Step 6: Commit the implementation**

```bash
git add main.py test_core.py
git commit -m "feat: add Discord delivery smoke mode"
```

### Task 3: Expose the mode safely in GitHub Actions

**Files:**
- Modify: `.github/workflows/tasi.yml:7-11`
- Modify: `test_core.py:145-157`

**Interfaces:**
- Consumes: the `MODES["discord-smoke"]` entry from Task 2 and the existing workflow mode passthrough.
- Produces: a discoverable manual Actions option that is excluded from dashboard and delayed-alert ingestion.

- [ ] **Step 1: Write the failing workflow-boundary test**

```python
def test_workflow_exposes_manual_discord_smoke_without_cockpit_ingest():
    workflow = Path(".github/workflows/tasi.yml").read_text(encoding="utf-8")

    assert "discord-smoke" in workflow.split("schedule:", 1)[0]
    assert "contains('digest,top10-draft,cockpit-refresh', steps.mode.outputs.mode)" in workflow
    assert "steps.mode.outputs.mode == 'run'" in workflow
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest test_core.py -q -k workflow_exposes_manual_discord_smoke_without_cockpit_ingest`

Expected: FAIL because `discord-smoke` is absent from the dispatch input description.

- [ ] **Step 3: Add the manual-mode label only**

Change the workflow input description to:

```yaml
description: "heartbeat | discord-smoke | suggest | autolevels | digest | run | top10-draft | cockpit-refresh | research-evidence"
```

Do not add a cron entry, do not add `discord-smoke` to either `Update private cockpit` or `Update delayed movement alerts`, and do not change permissions or secrets.

- [ ] **Step 4: Run static and Python workflow verification**

Run: `python -m pytest test_core.py research/test_base_rate.py -q`

Expected: PASS.

Run: `python -m compileall -q main.py movement.py research`

Expected: PASS with no output.

Run: `git diff --check`

Expected: PASS with no output.

- [ ] **Step 5: Commit the workflow discovery change**

```bash
git add .github/workflows/tasi.yml test_core.py
git commit -m "ci: expose Discord delivery smoke mode"
```

### Task 4: Verify the release candidate without sending a production message

**Files:**
- Verify: `main.py`
- Verify: `test_core.py`
- Verify: `.github/workflows/tasi.yml`

**Interfaces:**
- Consumes: all completed task changes.
- Produces: local evidence that the branch is ready for code review; it does not dispatch GitHub Actions or contact Discord.

- [ ] **Step 1: Run the exact CI-equivalent Python test command**

Run: `python -m pytest test_core.py research/test_base_rate.py -q`

Expected: PASS.

- [ ] **Step 2: Run static Python and repository-integrity checks**

Run: `python -m compileall -q main.py movement.py research`

Expected: PASS with no output.

Run: `git diff --check origin/main...HEAD`

Expected: PASS with no output.

- [ ] **Step 3: Inspect the intended branch-only change set**

Run: `git diff --name-status origin/main...HEAD`

Expected: only `main.py`, `test_core.py`, `.github/workflows/tasi.yml`, and this plan/spec documentation according to their commits.

- [ ] **Step 4: Request code review before merge**

Provide the completed change summary, the test outputs, and the explicit statement that no GitHub dispatch or Discord webhook was invoked during verification.
