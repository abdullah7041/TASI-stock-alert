"""Canonical, delayed-analysis summary shared by the cockpit and Discord."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from urllib.parse import urlparse


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
        accounts = ((snapshot.get("portfolio") or {}).get("accountBook") or {}).get("accounts") or []
        if accounts and not all(account.get("initialized") for account in accounts):
            cards[0]["text"] = "Confirm your broker account opening snapshots."
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


def _short(value: object, limit: int = 100) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def daily_changes(snapshot: dict) -> list[str]:
    """Dated observations for followed names; never broad scanner rankings or orders."""
    expected = snapshot.get("expectedPriceDate")
    changes = []
    for record in snapshot.get("digestRecords") or []:
        dated = record.get("priceDate")
        name = f"{_short(record.get('name') or record.get('code'), 45)} ({record.get('code')})"
        if (record.get("decision") or {}).get("label") == "Insufficient data":
            changes.append(f"{name} · Insufficient data; review source dates.")
            continue
        if not dated or (expected and dated < expected) or record.get("verified") is False:
            continue
        delta = record.get("delta") or {}
        if delta.get("trend_flipped"):
            changes.append(f"Trend changed · {name}; review chart.")
        elif delta.get("flipped"):
            changes.append(f"Technical conditions changed · {name}; observation only.")
    return changes


def data_notes(snapshot: dict) -> list[str]:
    """Compact source health while preserving failure versus a successful empty response."""
    records = snapshot.get("digestRecords") or []
    expected = snapshot.get("expectedPriceDate")
    missing = sum(not r.get("priceDate") or not isinstance(r.get("price"), (int, float))
                  or r.get("price", 0) <= 0 or r.get("verified") is False for r in records)
    stale = sum(bool(r.get("priceDate") and expected and r["priceDate"] < expected) for r in records)
    notes = []
    if not records or missing:
        notes.append("Prices unavailable" if not records else f"{missing} price check(s) unavailable")
    if stale:
        notes.append(f"{stale} stale quote(s)")
    failures = sum((r.get("news") or {}).get("ok") is False for r in records)
    if failures:
        notes.append(f"News unavailable for {failures} stock(s)")
    uncollected = sum(not r.get("news") or r["news"].get("ok") is None for r in records)
    if uncollected:
        notes.append(f"News not collected for {uncollected} stock(s)")
    filing_failures = sum((r.get("disclosures") or {}).get("ok") is False for r in records)
    if filing_failures:
        notes.append(f"Filings unavailable for {filing_failures} stock(s)")
    uncollected_filings = sum(not r.get("disclosures") or r["disclosures"].get("ok") is None for r in records)
    if uncollected_filings:
        notes.append(f"Filings not collected for {uncollected_filings} stock(s)")
    return notes


def notification_updates(snapshot: dict, prior: dict, *, tracked_codes: set[str],
                         events: list[dict], observed_at: str | None = None) -> tuple[list[dict], dict]:
    """New fetched official events and critical source transitions; no trading signals.

    Callers persist the returned state only after successful delivery. A failed
    webhook remains retryable; an unchanged failure is quiet after its first receipt.
    """
    from research.official_sources import is_official_url
    observed = _parse_utc(observed_at or snapshot.get("asOf"))
    expected = snapshot.get("expectedPriceDate") or snapshot.get("tradeDate")
    cutoff = _parse_utc(f"{expected}T00:00:00+03:00")
    seen = list(prior.get("seen") or [])
    seen_set = set(seen)
    updates = []
    for event in events:
        published = _parse_utc(event.get("published_at"))
        url = str(event.get("url") or "")
        if (str(event.get("symbol")) not in tracked_codes or not is_official_url(url)
                or not published or not observed or not cutoff or not cutoff <= published <= observed):
            continue
        # Do not accept credentials-bearing URLs from an archive or display them.
        parsed = urlparse(url)
        if parsed.username or parsed.password:
            continue
        identifier = hashlib.sha256(f"{url}|{published.isoformat()}".encode()).hexdigest()
        if identifier in seen_set:
            continue
        seen.append(identifier)
        seen_set.add(identifier)
        updates.append({"kind": "event", "id": identifier, "code": str(event["symbol"]),
                        "text": f"{event['symbol']} · {_short(event.get('title'), 160)}",
                        "url": url, "publishedAt": str(event["published_at"])})
    tracked = {**snapshot, "digestRecords": [r for r in snapshot.get("digestRecords") or []
                                             if str(r.get("code")) in tracked_codes]}
    notes = data_notes(tracked)
    health = {"prices": "failed" if any("price" in n.lower() or "quote" in n.lower() for n in notes) else "available",
              "news": "failed" if any("News unavailable" in n for n in notes) else "unknown" if not tracked["digestRecords"] or any("News not collected" in n for n in notes) else "available",
              "filings": "failed" if any("Filings unavailable" in n for n in notes) else "unknown" if not tracked["digestRecords"] or any("Filings not collected" in n for n in notes) else "available"}
    previous_health = prior.get("health") or {}
    for source, status in health.items():
        previous = previous_health.get(source)
        if status == previous or status == "unknown" or (previous is None and status == "available"):
            continue
        updates.append({"kind": "health", "id": f"{source}:{status}",
                        "text": f"{source.capitalize()} {'unavailable; check data status.' if status == 'failed' else 'coverage restored.'}"})
    return updates, {"seen": seen[-200:], "health": health}
