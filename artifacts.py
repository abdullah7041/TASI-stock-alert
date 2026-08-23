"""Versioned, deterministic producer artifacts shared by every delivery.

The scheduler writes market facts before optional enrichments.  This module
then produces an immutable digest or movement payload whose ID is safe to use
as an idempotency key at both downstream destinations.  Delivery receipts are
deliberately stored elsewhere and excluded from the identity calculation.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import date, datetime
from typing import Any


IDENTITY_EXCLUDED_FIELDS = {"artifactId", "deliveries", "deliveryReceipts"}
MAX_CHART_BARS = 90


def _normalise(value: Any, *, identity: bool = False) -> Any:
    """Turn supported data into stable JSON and reject ambiguous values."""
    if isinstance(value, dict):
        return {
            str(key): _normalise(item, identity=identity)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
            if not (identity and str(key) in IDENTITY_EXCLUDED_FIELDS)
        }
    if isinstance(value, (list, tuple)):
        return [_normalise(item, identity=identity) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Artifact values must be finite numbers.")
        return value
    if hasattr(value, "item"):
        return _normalise(value.item(), identity=identity)
    if value is None or isinstance(value, (str, int, bool)):
        return value
    raise TypeError(f"Unsupported artifact value: {type(value).__name__}")


def artifact_id(artifact: dict) -> str:
    """SHA-256 ID for canonical content, never mutable delivery outcomes."""
    payload = _normalise(artifact, identity=True)
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _with_id(artifact: dict) -> dict:
    output = _normalise(artifact)
    output["artifactId"] = artifact_id(output)
    return output


def build_digest_artifact(snapshot: dict, *, recs: list[dict], lean_status: dict,
                          charts: list[dict], scheduled_for: str | None) -> dict:
    """Create DigestArtifactV3 from deterministic facts plus fail-soft extras."""
    artifact = {
        **snapshot,
        "schemaVersion": 3,
        "artifactKind": "digest",
        "scheduledFor": scheduled_for,
        "producer": {"generatedAt": snapshot["asOf"]},
        "digestRecords": recs,
        "leanStatus": lean_status,
        "charts": charts,
    }
    return _with_id(artifact)


def build_movement_artifact(alerts: list[dict], *, as_of: str) -> dict:
    """Create MovementArtifactV1 for named delayed intraday alerts."""
    return _with_id({
        "schemaVersion": 1,
        "artifactKind": "movement",
        "asOf": as_of,
        "dataStatus": "delayed-intraday",
        "alerts": alerts,
    })


def _finite_number(row: Any, key: str) -> float | None:
    try:
        value = float(row[key])
    except (KeyError, TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def chart_artifacts(recs: list[dict], frames: dict, levels_by_code: dict) -> list[dict]:
    """Return portable up-to-90-session OHLCV chart data for each digest name."""
    output = []
    for rec in recs:
        code, name = str(rec["code"]), str(rec["name"])
        frame = frames.get(code)
        if frame is None or getattr(frame, "empty", True):
            output.append({"code": code, "name": name, "status": "unavailable",
                           "reason": "No usable daily OHLCV history."})
            continue
        bars = []
        try:
            rows = frame.tail(MAX_CHART_BARS).iterrows()
            for index, row in rows:
                values = {field: _finite_number(row, field)
                          for field in ("Open", "High", "Low", "Close", "Volume")}
                if any(value is None for value in values.values()):
                    continue
                bars.append({"date": str(index)[:10], **values})
        except Exception:
            bars = []
        if len(bars) < 5:
            output.append({"code": code, "name": name, "status": "unavailable",
                           "reason": "No usable daily OHLCV history."})
            continue
        raw_levels = levels_by_code.get(code) or {}
        levels = {
            key: value for key in ("stop", "trim", "target")
            if (value := _finite_number(raw_levels, key)) is not None
        }
        output.append({"code": code, "name": name, "status": "available",
                       "bars": bars, "levels": levels})
    return output
