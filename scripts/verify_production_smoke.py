"""Validate the private Cockpit's release and current dashboard contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def verify_production_smoke(health: dict[str, Any], dashboard: dict[str, Any], expected_commit: str) -> None:
    assert health.get("ok") is True, "Cockpit health is not ready"
    assert health.get("database") == "ready", "Cockpit database is not ready"
    assert health.get("deployedCommit") == expected_commit, "deployed commit does not match the approved release"

    accepted_versions = health.get("acceptedSchemaVersions")
    assert isinstance(accepted_versions, list), "accepted schema versions missing from health"

    snapshot = dashboard.get("snapshot")
    assert isinstance(snapshot, dict), "dashboard snapshot missing"
    assert snapshot.get("schemaVersion") in accepted_versions, "dashboard schema is not accepted by this release"
    assert snapshot.get("dataStatus") == "delayed-daily", "delayed data label missing"
    assert snapshot.get("tradeDate"), "dashboard trade date missing"
    assert dashboard.get("freshness") in {"current", "stale"}, "dashboard freshness missing"
    assert isinstance(dashboard.get("alerts"), list), "dashboard alerts collection missing"


def verify_alert_ingest(response: dict[str, Any], payload: dict[str, Any]) -> None:
    alerts = payload.get("alerts")
    assert isinstance(alerts, list), "movement alert payload is missing alerts"
    assert response.get("ok") is True, "movement alert ingestion failed"
    assert response.get("accepted") == len(alerts), "movement alert accepted count does not match the payload"
    if payload.get("artifactId") is not None:
        assert response.get("artifactId") == payload["artifactId"], "movement artifact receipt does not match the payload"


def main(argv: list[str]) -> int:
    if len(argv) != 6:
        print(
            "usage: verify_production_smoke.py HEALTH_JSON DASHBOARD_JSON ALERT_INGEST_JSON ALERT_PAYLOAD_JSON EXPECTED_COMMIT",
            file=sys.stderr,
        )
        return 2
    health = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    dashboard = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
    alert_ingest = json.loads(Path(argv[3]).read_text(encoding="utf-8"))
    alert_payload = json.loads(Path(argv[4]).read_text(encoding="utf-8"))
    verify_production_smoke(health, dashboard, argv[5])
    verify_alert_ingest(alert_ingest, alert_payload)
    print(
        f"dashboard schema {dashboard['snapshot']['schemaVersion']}, alert composition, "
        f"and movement ingest accepted={alert_ingest['accepted']} verified"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
