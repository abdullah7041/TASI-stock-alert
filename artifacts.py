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
# Everything levels.json carries that a reader acts on. price_at_derivation is
# not a price line -- it is what _fmt_levels compares against to warn that the
# levels are stale -- so it travels with them or that warning can never fire.
LEVEL_FIELDS = ("stop", "trim", "target", "price_at_derivation")


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


def timestamp_or_none(value: Any) -> str | None:
    """Keep a real offset-bearing ISO timestamp; anything else becomes null.

    Manual runs historically set SCHEDULED_FOR to the literal "manual". The v3
    contract types that field as a timestamp, so the marker has to be dropped
    here -- in the one place every artifact is built -- rather than by each
    caller. A caller that sanitises and a builder that does not is how the two
    ended up disagreeing.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return str(value) if parsed.tzinfo else None


def build_digest_artifact(snapshot: dict, *, recs: list[dict], lean_status: dict,
                          charts: list[dict], scheduled_for: str | None) -> dict:
    """Create DigestArtifactV3 from deterministic facts plus fail-soft extras."""
    records = [decision_record(rec, charts, trade_date=snapshot.get("tradeDate"))
               for rec in recs]
    unavailable_codes = {
        str(record.get("code")) for record in records
        if record.get("kind") == "holding"
        and (record.get("decision") or {}).get("label") == "Insufficient data"
    }
    urgent = [item for item in (snapshot.get("urgent") or [])
              if str(item.get("code")) not in unavailable_codes]
    warnings = list(snapshot.get("warnings") or [])
    if unavailable_codes:
        count = len(unavailable_codes)
        warnings.append(
            f"{count} holding check{'s are' if count != 1 else ' is'} unavailable; "
            "verify the current price in your broker."
        )
    summary_v1 = {**(snapshot.get("summaryV1") or {})}
    cards = [dict(card) for card in summary_v1.get("cards") or []]
    if unavailable_codes:
        for card in cards:
            if card.get("kind") == "portfolio":
                unavailable_text = (
                    f"{len(unavailable_codes)} holding check"
                    f"{'s are' if len(unavailable_codes) != 1 else ' is'} unavailable."
                )
                card["state"] = "action" if urgent else "unavailable"
                card["text"] = (
                    f"{len(urgent)} confirmed holding action(s) require review; {unavailable_text}"
                    if urgent else unavailable_text
                )
                break
    summary_v1["cards"] = cards
    artifact = {
        **snapshot,
        "schemaVersion": 3,
        "artifactKind": "digest",
        "scheduledFor": timestamp_or_none(scheduled_for),
        "producer": {"generatedAt": snapshot["asOf"]},
        "urgent": urgent,
        "warnings": warnings,
        "summaryV1": summary_v1,
        "summary": [str(card["text"]) for card in cards],
        "digestRecords": records,
        "leanStatus": lean_status,
        "charts": charts,
    }
    return _with_id(artifact)


def _previous_trading_date(value: str) -> str:
    cursor = datetime.fromisoformat(value).date()
    while True:
        cursor = date.fromordinal(cursor.toordinal() - 1)
        if cursor.weekday() not in (4, 5):
            return cursor.isoformat()


def decision_record(rec: dict, charts: list[dict], *, trade_date: str | None = None) -> dict:
    """One plain-language decision for both dashboard and Discord readers."""
    import explain
    price = _finite_number(rec, "price")
    action = str(rec.get("action") or "").upper()
    known = action in {"HOLD", "WATCH", "BUY", "SELL (STOP)", "SELL (TARGET)", "TRIM"}
    chart = next((c for c in charts if c.get("code") == rec.get("code")), {})
    bars = chart.get("bars") or []
    price_date = rec.get("priceDate") or (bars[-1].get("date") if bars else None)
    holding = rec.get("kind") == "holding"
    chart_ready = not holding or (chart.get("status") == "available" and len(bars) >= 5)
    rules = rec.get("rules")
    rules_ready = not holding or (isinstance(rules, list) and bool(rules)
                                  and all(rule.get("available") is not False for rule in rules))
    quote_stale = bool(holding and trade_date and price_date
                       and price_date < _previous_trading_date(trade_date))
    if quote_stale:
        label = "Insufficient data"
        reason = (f"This quote ({price_date}) is older than the expected previous session. "
                  "Check your broker before reviewing a decision.")
    elif not chart_ready:
        label, reason = "Insufficient data", "Required chart history is unavailable."
    elif price is None or price <= 0 or rec.get("verified") is False or not known or not rules_ready:
        label, reason = "Insufficient data", "A verified price or complete rule check is unavailable."
    elif action == "SELL (STOP)":
        label, reason = "Review stop", "Your protective level was reached in the daily snapshot. Check your broker."
    elif action in {"SELL (TARGET)", "TRIM"}:
        label, reason = "Review profit level", "Your profit-taking level was reached in the daily snapshot. Review it in your broker."
    elif rec.get("kind") == "holding":
        label, reason = "Hold", "No decision level crossed in this daily snapshot."
    else:
        label, reason = "Watching", explain.situation(rec) + " This remains a research opportunity."
    return {**rec, "priceDate": price_date, "decision": {"label": label, "reason": reason}}


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
    """Return portable up-to-90-session OHLCV chart data for each digest name.

    Levels travel with every name, including one whose chart could not be drawn.
    They come from levels.json and have nothing to do with whether there is
    enough history to plot: a holding with a thin frame still has a stop, and
    the digest reads its levels from here.
    """
    output = []
    for rec in recs:
        code, name = str(rec["code"]), str(rec["name"])
        levels = {
            key: value for key in LEVEL_FIELDS
            if (value := _finite_number(levels_by_code.get(code) or {}, key)) is not None
        }
        frame = frames.get(code)
        if frame is None or getattr(frame, "empty", True):
            output.append({"code": code, "name": name, "status": "unavailable",
                           "reason": "No usable daily OHLCV history.", "levels": levels})
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
                           "reason": "No usable daily OHLCV history.", "levels": levels})
            continue
        output.append({"code": code, "name": name, "status": "available",
                       "bars": bars, "levels": levels})
    return output
