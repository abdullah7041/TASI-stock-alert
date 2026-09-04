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


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print("usage: verify_production_smoke.py HEALTH_JSON DASHBOARD_JSON EXPECTED_COMMIT", file=sys.stderr)
        return 2
    health = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    dashboard = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
    verify_production_smoke(health, dashboard, argv[3])
    print(f"dashboard schema {dashboard['snapshot']['schemaVersion']} and alert composition verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
