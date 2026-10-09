"""Canonical, delayed-analysis summary shared by the cockpit and Discord."""

from __future__ import annotations

from datetime import datetime, timezone


def _parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _lateness_minutes(generated_at: str, scheduled_for: str | None) -> int | None:
    generated = _parse_utc(generated_at)
    scheduled = _parse_utc(scheduled_for)
    if generated is None or scheduled is None:
        return None
    return max(0, int((generated - scheduled).total_seconds() // 60))


def build_summary_v1(snapshot: dict, scheduled_for: str | None = None) -> dict:
    """Return deterministic cards without making a trading recommendation."""
    generated_at = str(snapshot["asOf"])
    urgent = list(snapshot.get("urgent") or [])
    top10 = dict(snapshot.get("top10") or {})
    forecast = dict(snapshot.get("forecast") or {})
    top10_entries = list(top10.get("entries") or [])
    forecast_status = str(forecast.get("status") or "unavailable")

    cards = [
        {
            "kind": "portfolio",
            "state": "action" if urgent else "clear",
            "text": (
                f"{len(urgent)} confirmed holding action(s) require review."
                if urgent else "No confirmed trade requires action."
            ),
        },
        {
            "kind": "top10",
            "state": "ready" if top10_entries else "evidence-pending",
            "text": (
                f"Top 10: {len(top10_entries)} evidence-ranked companies ready for review."
                if top10_entries else "Top 10: evidence pending; no current primary-source review."
            ),
        },
        {
            "kind": "safety",
            "state": "delayed",
            "text": "Broker app owns real-time price alerts; this digest is delayed analysis.",
        },
        {
            "kind": "forecast",
            "state": forecast_status,
            "text": (
                "Forecast unavailable: validation gates not passed."
                if forecast_status == "unavailable"
                else "Forecast available only as a validated delayed-analysis reference."
            ),
        },
    ]
    if (snapshot.get("portfolio") or {}).get("policyStatus") == "unconfigured":
        cards[0].update(state="evidence-pending", text="Company assessment and signal evaluation are pending; no trade quantity is proposed.")
    return {
        "version": 1,
        "generatedAt": generated_at,
        "scheduledFor": scheduled_for,
        "latenessMinutes": _lateness_minutes(generated_at, scheduled_for),
        "cards": cards,
    }


def summary_lines(summary: dict) -> list[str]:
    """Keep the existing string summary usable for older consumers."""
    return [str(card["text"]) for card in list(summary.get("cards") or [])]
