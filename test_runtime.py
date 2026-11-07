"""Managed-runtime behaviour: session gating, idempotent claims, shadow mode.

Offline by design. No Google Cloud client is imported, no credentials are
needed, and no network call is made, so these run in the same CI job as the
rest of the Python tests.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

import session_gate
from runtime.job import deliver_alerts, ingest_alerts, ingest_market_pulse, quote_age_seconds, run
from runtime.state import InMemoryStateStore, event_id

RIYADH = timezone(timedelta(hours=3))
SCHEDULER = yaml.safe_load(Path("deploy/cloud-scheduler.yaml").read_text(encoding="utf-8"))


def riyadh(year, month, day, hour, minute=0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=RIYADH)


def alert(index: int = 0, **overrides) -> dict:
    # The event ID buckets by hour, so distinct events need distinct hours.
    observed = f"2026-08-19T{10 + index:02d}:10:00Z"
    return {
        "alertId": event_id("4164", "upside", observed),
        "code": "4164",
        "name": "Nahdi Medical",
        "direction": "upside",
        "observedAt": observed,
        "receivedAt": observed,
        "latency": "delayed-intraday",
        "excessMovePct": 2.4,
        "robustZ": 4.6,
        "reason": "Delayed bot confirmation of statistically unusual price movement.",
        **overrides,
    }


# --- session gate -----------------------------------------------------------
@pytest.mark.parametrize('first_kind', ['opening_balance','contribution'])
def test_the_actual_workflow_portfolio_loader_accepts_the_new_saved_contract(tmp_path,monkeypatch,first_kind):
    """Exercise the deployed shell step's Python, not just main's private reader."""
    import json
    import main  # load before changing cwd, exactly as the workflow does
    workflow=yaml.safe_load(Path('.github/workflows/tasi.yml').read_text(encoding='utf-8'))
    steps=[step for job in workflow['jobs'].values() for step in job.get('steps',[])]
    loader=next(step['run'] for step in steps if '.portfolio-current.json' in step.get('run',''))
    script=loader.split("python - <<'PY'\n",1)[1].split('\nPY',1)[0]
    payload={"schemaVersion":3,"status":"saved","eventCount":1,"events":[{"operationId":"open","kind":"opening_balance","cashSar":0,"confirmedAt":"2026-09-07T00:00:00Z"}],"view":{"policyStatus":"unconfigured","proposal":None,"cashSar":0,"holdings":[],"confirmedAt":"2026-09-07T00:00:00Z"}}
    if first_kind=='contribution':
        payload['events'][0].update(kind='contribution',cashSar=500,month='2026-09')
        payload['view'].update(cashSar=500,contributionMonth='2026-09')
    monkeypatch.chdir(tmp_path)
    Path('.portfolio-current.json').write_text(json.dumps(payload),encoding='utf-8')
    exec(compile(script,'workflow-portfolio-loader','exec'),{'__name__':'workflow_contract'})
    assert json.loads(Path('portfolio_active.json').read_text(encoding='utf-8'))==payload


def test_sunday_session_is_open_and_friday_is_not():
    # 2026-08-16 is a Sunday, 2026-08-21 a Friday.
    assert session_gate.is_session_open(riyadh(2026, 8, 16, 11), holidays=set())
    assert not session_gate.is_trading_day(riyadh(2026, 8, 21, 11), holidays=set())


def test_a_recorded_holiday_closes_an_otherwise_normal_trading_day():
    assert not session_gate.is_trading_day(riyadh(2026, 8, 16, 11), holidays={"2026-08-16"})
    assert session_gate.gate_reason("session", riyadh(2026, 8, 16, 11), holidays={"2026-08-16"})


def test_each_mode_has_its_own_window():
    assert session_gate.gate_reason("digest", riyadh(2026, 8, 16, 9, 40), holidays=set()) is None
    assert session_gate.gate_reason("digest", riyadh(2026, 8, 16, 11), holidays=set())
    assert session_gate.gate_reason("session", riyadh(2026, 8, 16, 14, 50), holidays=set()) is None
    assert session_gate.gate_reason("session", riyadh(2026, 8, 16, 15, 10), holidays=set())
    assert session_gate.gate_reason("reconcile", riyadh(2026, 8, 16, 15, 10), holidays=set()) is None
    assert session_gate.gate_reason("reconcile", riyadh(2026, 8, 16, 14), holidays=set())


def test_a_closed_day_invocation_decides_and_sends_nothing(monkeypatch):
    store = InMemoryStateStore()
    monkeypatch.setattr(session_gate, "load_holidays", lambda path=None: {"2026-08-16"})

    assert run("session", store, riyadh(2026, 8, 16, 11)) == 0
    assert store.health[-1]["status"] == "skipped"
    assert store.events == {}


def test_an_unknown_mode_is_rejected_rather_than_guessed():
    assert run("everything", InMemoryStateStore(), riyadh(2026, 8, 16, 11)) == 2


# --- claims and delivery ----------------------------------------------------
def test_the_same_observation_is_claimed_once_across_overlapping_runs():
    store = InMemoryStateStore()
    sent = []

    first = deliver_alerts([alert()], store, lambda owned: sent.append(owned) or True, enabled=True)
    second = deliver_alerts([alert()], store, lambda owned: sent.append(owned) or True, enabled=True)

    assert first["delivered"] == 1
    assert second["delivered"] == 0 and second["skipped"] == 1
    assert len(sent) == 1


def test_a_failed_delivery_releases_the_claim_so_a_retry_can_send():
    store = InMemoryStateStore()

    failed = deliver_alerts([alert()], store, lambda _owned: False, enabled=True)
    assert failed["ok"] is False and failed["delivered"] == 0
    assert store.events == {}

    retried = deliver_alerts([alert()], store, lambda _owned: True, enabled=True)
    assert retried["delivered"] == 1


def test_a_raised_transport_error_is_a_failed_delivery_not_a_crash():
    store = InMemoryStateStore()

    def explode(_owned):
        raise ConnectionError("webhook unreachable")

    result = deliver_alerts([alert()], store, explode, enabled=True)

    assert result["ok"] is False
    assert "ConnectionError" in result["reason"]
    assert store.events == {}


def test_shadow_mode_claims_the_event_but_sends_nothing():
    store = InMemoryStateStore()

    result = deliver_alerts([alert()], store, lambda _owned: pytest.fail("shadow mode must not send"), enabled=False)

    assert result["shadowed"] == 1 and result["delivered"] == 0
    assert store.events, "the event is still claimed, so a later run cannot duplicate it"
    assert not store.delivery_succeeded(alert()["alertId"], "discord")


def test_delivery_is_disabled_unless_explicitly_enabled(monkeypatch):
    from runtime import job

    monkeypatch.delenv("TASI_DELIVERY_ENABLED", raising=False)
    assert job.delivery_enabled() is False
    # Literal expectations, not a re-implementation of the parsing rule: a
    # change to that rule has to fail here rather than move both sides.
    for value, expected in (("", False), ("false", False), ("0", False), ("yes", False), ("no", False),
                            ("true", True), ("TRUE ", True), (" True", True)):
        monkeypatch.setenv("TASI_DELIVERY_ENABLED", value)
        assert job.delivery_enabled() is expected, value


def test_shadow_mode_never_reaches_cockpit_ingestion(monkeypatch):
    monkeypatch.setenv("COCKPIT_ALERT_INGEST_URL", "https://example.invalid/api/alerts/ingest")
    monkeypatch.setenv("COCKPIT_SIWC_BYPASS_TOKEN", "sites")
    monkeypatch.setenv("COCKPIT_INGEST_TOKEN", "app")
    monkeypatch.delenv("TASI_DELIVERY_ENABLED", raising=False)

    assert ingest_alerts([alert()]) == {"ok": True, "status": "skipped: delivery disabled (shadow mode)"}


def test_market_pulse_cannot_reach_the_cockpit_without_its_own_explicit_opt_in(monkeypatch):
    """Pulse ingest has a separate switch, so delivery cutover cannot enable it by accident."""
    monkeypatch.setenv("COCKPIT_PULSE_INGEST_URL", "https://example.invalid/api/market-pulse/ingest")
    monkeypatch.setenv("COCKPIT_SIWC_BYPASS_TOKEN", "sites")
    monkeypatch.setenv("COCKPIT_INGEST_TOKEN", "app")
    monkeypatch.setenv("TASI_DELIVERY_ENABLED", "true")
    monkeypatch.delenv("TASI_PULSE_INGEST_ENABLED", raising=False)

    assert ingest_market_pulse({"status": "current"}) == {"ok": True, "status": "skipped: pulse ingest disabled (shadow mode)"}


def test_a_job_that_owns_nothing_ingests_nothing(monkeypatch):
    monkeypatch.setenv("COCKPIT_ALERT_INGEST_URL", "https://example.invalid/api/alerts/ingest")
    monkeypatch.setenv("COCKPIT_SIWC_BYPASS_TOKEN", "sites")
    monkeypatch.setenv("COCKPIT_INGEST_TOKEN", "app")
    monkeypatch.setenv("TASI_DELIVERY_ENABLED", "true")
    store = InMemoryStateStore()

    deliver_alerts([alert()], store, lambda _owned: True, enabled=True)
    losing_run = deliver_alerts([alert()], store, lambda _owned: True, enabled=True)

    assert losing_run["owned"] == []
    assert ingest_alerts(losing_run["owned"]) == {"ok": True, "status": "skipped: no owned alerts"}


def test_distinct_observations_are_separate_events():
    store = InMemoryStateStore()
    sent = []

    result = deliver_alerts([alert(0), alert(1)], store, lambda owned: sent.append(owned) or True, enabled=True)

    assert result["delivered"] == 2
    assert len(store.events) == 2


def test_quote_age_is_reported_in_seconds():
    assert quote_age_seconds("2026-08-19T10:00:00Z", "2026-08-19T10:15:00Z") == 900.0
    assert quote_age_seconds("not a timestamp", "2026-08-19T10:15:00Z") is None


def test_movement_state_survives_a_container_that_keeps_no_disk():
    store = InMemoryStateStore()
    store.save_movement_state({"4164:upside": {"armed": False}})

    assert store.load_movement_state() == {"4164:upside": {"armed": False}}


# --- scheduler definitions --------------------------------------------------
def test_every_schedule_runs_in_riyadh_time():
    assert SCHEDULER["timezone"] == "Asia/Riyadh"
    assert all(entry["timezone"] == "Asia/Riyadh" for entry in SCHEDULER["schedules"])


def test_the_scheduled_modes_and_times_match_the_agreed_plan():
    by_mode = {entry["mode"]: entry for entry in SCHEDULER["schedules"]}

    assert set(by_mode) == {"digest", "session", "reconcile"}
    assert by_mode["digest"]["schedule"] == "40 9 * * 0,1,2,3,4"
    assert by_mode["session"]["schedule"] == "0,10,20,30,40,50 10-14 * * 0,1,2,3,4"
    assert by_mode["reconcile"]["schedule"] == "10 15 * * 0,1,2,3,4"


def test_the_managed_runtime_ships_in_shadow_mode():
    assert SCHEDULER["job"]["env"]["TASI_DELIVERY_ENABLED"] == "false"
    assert SCHEDULER["job"]["env"]["TASI_PULSE_INGEST_ENABLED"] == "false"


def test_managed_runtime_records_market_pulse_health_without_delivery(monkeypatch):
    """A five-minute pulse is observation-only even when the managed runner owns it."""
    import main
    from runtime import job

    called = []
    store = InMemoryStateStore()
    monkeypatch.setattr(main, "mode_market_pulse", lambda *, prior=None: called.append(prior) or 0)

    now = datetime(2026, 9, 20, 7, 15, tzinfo=timezone.utc)  # Sunday 10:15 Riyadh
    assert job.run("market-pulse", store=store, now=now) == 0
    assert called == [None]
    assert store.health[-1]["mode"] == "market-pulse"
    assert store.health[-1]["deliveryEnabled"] is False


def test_managed_pulse_reads_and_saves_durable_shadow_attempts(monkeypatch, tmp_path):
    """Ephemeral containers must not lose the valid pulse or two-day audit trail."""
    import main
    from runtime import job

    store = InMemoryStateStore()
    observed = []
    pulses = [
        {"status": "current", "fetchedAt": "2026-09-20T07:15:00Z"},
        {"status": "stale", "fetchedAt": "2026-09-20T07:20:00Z", "lastValidAt": "2026-09-20T07:15:00Z"},
    ]
    monkeypatch.setattr(main, "MARKET_PULSE_V1_FILE", tmp_path / "market_pulse_v1.json")

    def collect(*, prior=None):
        observed.append(prior)
        main._save(main.MARKET_PULSE_V1_FILE, pulses.pop(0))
        return 0

    monkeypatch.setattr(main, "mode_market_pulse", collect)
    now = datetime(2026, 9, 20, 7, 15, tzinfo=timezone.utc)
    assert job.run("market-pulse", store=store, now=now) == 0
    assert job.run("market-pulse", store=store, now=now) == 0
    assert observed[0] is None
    assert observed[1]["status"] == "current"
    assert store.latest_market_pulse()["status"] == "stale"
    assert len(store.pulse_attempts) == 2


def test_managed_pulse_entrypoint_selects_firestore_without_changing_other_modes(monkeypatch):
    """The container entrypoint must not silently fall back to process memory."""
    from runtime import job

    store = InMemoryStateStore()
    calls = []
    monkeypatch.setattr(job, "FirestoreStateStore", lambda: store)
    monkeypatch.setattr(job, "run", lambda mode, store=None: calls.append((mode, store)) or 0)
    assert job.main_entry(["market-pulse"]) == 0
    assert job.main_entry(["digest"]) == 0
    assert calls == [("market-pulse", store), ("digest", None)]


def test_secrets_are_referenced_not_embedded():
    secrets = SCHEDULER["job"]["secrets"]

    assert set(secrets) == {"SAHMK_API_KEY", "DISCORD_WEBHOOK_URL", "COCKPIT_SIWC_BYPASS_TOKEN", "COCKPIT_INGEST_TOKEN"}
    assert all(value.startswith("projects/") and "/secrets/" in value for value in secrets.values())


def test_google_cloud_dependencies_stay_out_of_the_github_fallback():
    base = Path("requirements.txt").read_text(encoding="utf-8")

    assert "google-cloud" not in base
    assert "google-cloud-firestore" in Path("requirements-runtime.txt").read_text(encoding="utf-8")
    assert "from google.cloud import firestore" not in Path("runtime/job.py").read_text(encoding="utf-8")


# --- workflow split ---------------------------------------------------------
def test_ci_runs_event_outcome_validation_tests():
    """The release gate is unsafe if its point-in-time tests never run in CI."""
    workflow = yaml.safe_load(Path(".github/workflows/ci.yml").read_text(encoding="utf-8"))
    commands = [
        step.get("run", "")
        for step in workflow["jobs"]["python"]["steps"]
        if isinstance(step, dict)
    ]
    pytest_command = next(command for command in commands if "python -m pytest" in command)

    assert "research/test_event_study.py" in pytest_command.split()
    assert "research/test_entry_forecast.py" in pytest_command.split()
    assert "research/test_official_sources.py" in pytest_command.split()


def test_discord_smoke_is_manual_only_and_cannot_be_scheduled():
    manual = yaml.safe_load(Path(".github/workflows/manual-operations.yml").read_text(encoding="utf-8"))
    # PyYAML reads the bare `on:` key as the boolean True.
    triggers = manual.get("on", manual.get(True))

    assert set(triggers) == {"workflow_dispatch"}
    assert "discord-smoke" in triggers["workflow_dispatch"]["inputs"]["operation"]["description"]


def test_the_scheduled_workflow_never_runs_the_smoke_test():
    scheduled = Path(".github/workflows/tasi.yml").read_text(encoding="utf-8")

    assert "mode=discord-smoke" not in scheduled

    manual = yaml.safe_load(Path(".github/workflows/manual-operations.yml").read_text(encoding="utf-8"))
    # A tolerated failure would make the smoke run green whatever Discord did.
    assert all("continue-on-error" not in step for job in manual["jobs"].values() for step in job["steps"])


def test_production_smoke_accepts_the_current_schema_advertised_by_health():
    from scripts.verify_production_smoke import verify_production_smoke

    verify_production_smoke(
        {
            "ok": True,
            "database": "ready",
            "deployedCommit": "abc123",
            "acceptedSchemaVersions": [1, 2, 3],
        },
        {
            "snapshot": {
                "schemaVersion": 3,
                "dataStatus": "delayed-daily",
                "tradeDate": "2026-09-03",
            },
            "freshness": "current",
            "alerts": [],
        },
        "abc123",
    )


def test_production_smoke_verifies_the_alert_ingest_accepted_count():
    from scripts.verify_production_smoke import verify_alert_ingest

    verify_alert_ingest(
        {"ok": True, "accepted": 0, "artifactId": "sha256:" + "a" * 64},
        {"alerts": [], "artifactId": "sha256:" + "a" * 64},
    )


def test_github_keeps_the_digest_and_session_cron_until_the_canary_passes():
    """The cutover disables these deliberately, after a passing canary — not here."""
    scheduled = Path(".github/workflows/tasi.yml").read_text(encoding="utf-8")

    # 05:30 UTC since 2026-08-25 (was 06:45). The point of this test is that the
    # GitHub digest and session cron still EXIST -- the Cloud Run cutover removes
    # them deliberately, after a passing canary, and not by accident here.
    assert 'cron: "30 5 * * 0,1,2,3,4"' in scheduled
    assert 'cron: "10 6 * * 0,1,2,3,4"' in scheduled
    assert 'cron: "*/15 7-11 * * 0,1,2,3,4"' in scheduled


def test_evidence_jobs_use_the_same_configured_origin_and_auth_as_the_portfolio():
    """A retired Sites URL made successful draft jobs silently lose reviewed evidence."""
    workflow = yaml.safe_load(Path(".github/workflows/tasi.yml").read_text(encoding="utf-8"))
    steps = {step.get("name"): step for step in workflow["jobs"]["watch"]["steps"]}
    for name, endpoint in [("Load reviewed evidence for Top 10 drafting", "current"),
                           ("Persist official evidence review queue", "queue/ingest")]:
        step = steps[name]
        assert step["env"]["COCKPIT_ORIGIN"] == "${{ vars.COCKPIT_ORIGIN }}"
        assert "COCKPIT_ACCESS_CLIENT_ID" in step["env"]
        assert "COCKPIT_ACCESS_CLIENT_SECRET" in step["env"]
        assert "source .github/cockpit-auth.sh" in step["run"]
        assert "cockpit_auth_ready" in step["run"]
        assert '${COCKPIT_AUTH_HEADERS[@]}' in step["run"]
        assert f'"$COCKPIT_ORIGIN/api/evidence/{endpoint}"' in step["run"]
        assert "chatgpt.site" not in step["run"]
