"""Cloud Run Job entrypoint for the delayed TASI producer.

One container, three modes, chosen by Cloud Scheduler through MODE:

  digest     09:40 Riyadh, Sunday-Thursday  - pre-open summary
  session    every 10 minutes, 10:00-14:50  - delayed movement checks
  reconcile  15:10 Riyadh                   - close-out and health summary

Cloud Scheduler fires on wall-clock time and knows nothing about holidays, so
session_gate stays authoritative and a run on a closed day exits 0 having
decided and sent nothing.

Delivery is off unless TASI_DELIVERY_ENABLED is explicitly "true". That is the
shadow mode the cutover depends on: the managed runtime can run beside the
GitHub schedule for two trading days, claiming events and writing telemetry,
without any chance of a duplicate Discord message.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone

from runtime.state import InMemoryStateStore, StateStore, event_id

DISCORD = "discord"
SITES = "sites"
MODES = ("digest", "session", "market-pulse", "reconcile")


def delivery_enabled() -> bool:
    """Explicit opt-in only. Any other value, including unset, means shadow mode."""
    return os.environ.get("TASI_DELIVERY_ENABLED", "").strip().lower() == "true"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log_event(**fields) -> dict:
    """One structured line per run. Secrets are never fields, only their names."""
    record = {"component": "tasi-producer", **fields}
    print(json.dumps(record, ensure_ascii=False, sort_keys=True), flush=True)
    return record


def quote_age_seconds(observed_at: str, now: str | None = None) -> float | None:
    """How stale the newest observation is, in seconds; None when unparseable."""
    try:
        observed = datetime.strptime(observed_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        current = datetime.strptime(now or _now(), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return (current - observed).total_seconds()


def deliver_alerts(alerts: list[dict], store: StateStore, send, *, enabled: bool | None = None) -> dict:
    """Claim each alert before sending it, so overlapping jobs cannot double-post.

    `send` receives the alerts that this job actually owns and returns True on
    a successful delivery. A failed send releases the claims, because an event
    nobody delivered must stay deliverable.
    """
    enabled = delivery_enabled() if enabled is None else enabled
    claimed, skipped, shadowed = [], [], []
    for alert in alerts:
        identifier = alert.get("alertId") or event_id(alert["code"], alert["direction"], alert["observedAt"])
        if store.delivery_succeeded(identifier, DISCORD) or not store.claim_event(identifier, {
            "code": alert.get("code"), "name": alert.get("name"), "direction": alert.get("direction"),
            "observedAt": alert.get("observedAt"),
        }):
            skipped.append(identifier)
            continue
        if not enabled:
            store.record_delivery(identifier, DISCORD, False, "delivery disabled (shadow mode)")
            shadowed.append(identifier)
            continue
        claimed.append((identifier, alert))

    if not claimed:
        return {"delivered": 0, "skipped": len(skipped), "shadowed": len(shadowed), "ok": True, "reason": None, "owned": []}

    try:
        ok = bool(send([alert for _identifier, alert in claimed]))
        reason = None if ok else "discord delivery reported failure"
    except Exception as exc:  # a raised transport error is still a failed delivery
        ok, reason = False, f"discord delivery raised {type(exc).__name__}"

    for identifier, _alert in claimed:
        store.record_delivery(identifier, DISCORD, ok, reason or "")
        if not ok:
            store.release_event(identifier)
    return {"delivered": len(claimed) if ok else 0, "skipped": len(skipped), "shadowed": len(shadowed), "ok": ok,
            "reason": reason, "owned": [alert for _identifier, alert in claimed] if ok else []}


def run(mode: str, store: StateStore | None = None, now: datetime | None = None) -> int:
    """Gate, then hand off to the existing producer modes in main.py."""
    import main
    import session_gate

    started = _now()
    scheduled_for = os.environ.get("SCHEDULED_FOR", "unspecified")
    store = store or InMemoryStateStore()
    if mode not in MODES:
        log_event(mode=mode, status="rejected", reason="unknown mode", scheduledFor=scheduled_for, startedAt=started)
        return 2

    blocked = session_gate.gate_reason("session" if mode == "market-pulse" else mode, now)
    if blocked:
        store.record_health(mode, "skipped", {"reason": blocked, "scheduledFor": scheduled_for})
        log_event(mode=mode, status="skipped", reason=blocked, scheduledFor=scheduled_for, startedAt=started,
                  completedAt=_now(), deliveryEnabled=delivery_enabled())
        return 0

    started_monotonic = time.monotonic()
    try:
        exit_code = _MODE_HANDLERS[mode](main, store)
        status, reason = ("ok", None) if exit_code == 0 else ("failed", f"{mode} returned {exit_code}")
    except Exception as exc:
        exit_code, status, reason = 1, "failed", f"{mode} raised {type(exc).__name__}: {exc}"

    detail = {
        "scheduledFor": scheduled_for, "startedAt": started, "completedAt": _now(),
        "durationSeconds": round(time.monotonic() - started_monotonic, 3),
        "deliveryEnabled": delivery_enabled(),
    }
    store.record_health(mode, status, {**detail, "reason": reason})
    log_event(mode=mode, status=status, reason=reason, **detail)
    return exit_code


def _run_digest(main, store: StateStore) -> int:
    code = main.mode_digest()
    snapshot = main._load(main.DASHBOARD_FILE, None)
    if snapshot:
        store.save_snapshot(snapshot.get("tradeDate", _now()[:10]), snapshot)
    return code


def _run_session(main, store: StateStore) -> int:
    """Detect, claim, then deliver. Never the other way round.

    mode_run in main.py posts to Discord as soon as it has alerts, which is
    correct for a single scheduled runner and wrong here: two overlapping
    Cloud Run executions would both post. This path keeps detection but routes
    delivery through the durable claim.
    """
    _regime, recs, _budget = main._collect_recs(include_news=False, record_history=False)
    movement_state = store.load_movement_state()
    alerts = main._movement_alerts(recs, state=movement_state, save_state=store.save_movement_state)
    as_of = _now()
    result = deliver_alerts(alerts, store, lambda owned: main.nt.send_discord(main.nt.build_movement_alert_message(owned, as_of)))
    ingest = ingest_alerts(result["owned"])
    log_event(mode="session", status="detected", alertCount=len(alerts), delivered=result["delivered"],
              skipped=result["skipped"], shadowed=result["shadowed"], discordOk=result["ok"],
              discordReason=result["reason"], ingestResult=ingest["status"],
              quoteAgeSeconds=quote_age_seconds(alerts[0]["observedAt"], as_of) if alerts else None)
    return 0 if result["ok"] and ingest["ok"] else 1


def _run_market_pulse(main, store: StateStore) -> int:
    """Collect a pulse only; delivery remains impossible in shadow mode."""
    return main.mode_market_pulse()


def ingest_alerts(alerts: list[dict]) -> dict:
    """Push this job's own alerts into the Sites cockpit.

    Only claimed-and-delivered alerts are passed in. A job that lost every
    claim ingests nothing, so `ingestResult` in the logs cannot read as a
    successful ingest for a run that owned no events.
    """
    if not alerts:
        return {"ok": True, "status": "skipped: no owned alerts"}
    endpoint = os.environ.get("COCKPIT_ALERT_INGEST_URL", "")
    sites_token = os.environ.get("COCKPIT_SIWC_BYPASS_TOKEN", "")
    app_token = os.environ.get("COCKPIT_INGEST_TOKEN", "")
    if not endpoint or not sites_token or not app_token:
        return {"ok": True, "status": "skipped: cockpit ingestion is not configured"}
    if not delivery_enabled():
        return {"ok": True, "status": "skipped: delivery disabled (shadow mode)"}
    import requests

    try:
        response = requests.post(endpoint, json={"alerts": alerts}, timeout=20, headers={
            "OAI-Sites-Authorization": f"Bearer {sites_token}",
            "Authorization": f"Bearer {app_token}",
            "Content-Type": "application/json",
        })
    except Exception as exc:
        return {"ok": False, "status": f"failed: {type(exc).__name__}"}
    ok = 200 <= response.status_code < 300
    return {"ok": ok, "status": f"http {response.status_code}"}


def _run_reconcile(main, store: StateStore) -> int:
    """Close out the day: refresh the cockpit snapshot, send nothing to Discord."""
    return main.mode_reconcile()


_MODE_HANDLERS = {"digest": _run_digest, "session": _run_session, "market-pulse": _run_market_pulse, "reconcile": _run_reconcile}


def main_entry(argv: list[str] | None = None) -> int:
    arguments = argv if argv is not None else sys.argv[1:]
    return run(arguments[0] if arguments else os.environ.get("MODE", "session"))


if __name__ == "__main__":
    raise SystemExit(main_entry())
