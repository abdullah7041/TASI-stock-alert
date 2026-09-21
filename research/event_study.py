"""Point-in-time event outcomes for offline validation.

This module measures reactions after verified events.  It deliberately does
not infer causation or enable a user-facing probability forecast.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo


_RIYADH = ZoneInfo("Asia/Riyadh")
_TRUSTED_HOSTS = {
    "aleqt.com",
    "argaam.com",
    "arabnews.com",
    "bloomberg.com",
    "cma.org.sa",
    "ia.gov.sa",
    "reuters.com",
    "sama.gov.sa",
    "saudiexchange.sa",
    "spa.gov.sa",
}


def _timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or len(value.strip()) <= 10:
        return None
    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(raw)
        except (TypeError, ValueError, OverflowError):
            return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _trusted_host(url: object) -> str | None:
    if not isinstance(url, str):
        return None
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https":
        return None
    if any(host == allowed or host.endswith("." + allowed) for allowed in _TRUSTED_HOSTS):
        return host.removeprefix("www.")
    return None


def normalize_events(records: list[dict]) -> tuple[list[dict], dict[str, int]]:
    """Normalize only records that were precisely observed and directly verified."""
    rejected: Counter[str] = Counter()
    candidates: list[dict] = []
    for raw in records:
        observed = _timestamp(raw.get("observed_at") or raw.get("retrieved_at"))
        published = _timestamp(raw.get("published_at") or raw.get("published"))
        if observed is None or published is None:
            rejected["missing precise timestamp"] += 1
            continue
        url = raw.get("url") or raw.get("link")
        host = _trusted_host(url)
        if host is None:
            rejected["unverified source URL"] += 1
            continue
        symbol = str(raw.get("symbol") or raw.get("code") or "").strip()
        title = str(raw.get("title") or "").strip()
        if not (symbol.isdigit() and len(symbol) == 4 and title):
            rejected["missing event identity"] += 1
            continue
        candidates.append({
            "event_id": hashlib.sha256(str(url).encode("utf-8")).hexdigest()[:16],
            "symbol": symbol,
            "title": title,
            "url": str(url),
            "event_class": host,
            "published_at": _iso(published),
            "observed_at": _iso(observed),
            "available_at": _iso(max(published, observed)),
        })

    deduplicated: dict[tuple[str, str], dict] = {}
    for row in sorted(candidates, key=lambda item: item["observed_at"]):
        deduplicated.setdefault((row["url"], row["symbol"]), row)
    rows = sorted(deduplicated.values(), key=lambda item: (item["available_at"], item["event_id"], item["symbol"]))
    return rows, dict(rejected)


def _bars_by_date(rows: object) -> dict[str, dict]:
    if not isinstance(rows, list):
        return {}
    return {
        str(row["date"]): row
        for row in rows
        if isinstance(row, dict) and row.get("date") is not None
    }


def _censored(event: dict, horizon: int, reason: str) -> dict:
    return {
        "event_id": event["event_id"],
        "symbol": event["symbol"],
        "event_class": event["event_class"],
        "available_at": event["available_at"],
        "horizon_sessions": horizon,
        "status": "censored",
        "reason": reason,
    }


def event_outcomes(events: list[dict], histories: dict[str, list[dict]], horizon: int) -> list[dict]:
    """Measure next-session open to the requested matched session close."""
    if horizon < 1:
        raise ValueError("horizon must be positive")
    benchmark = _bars_by_date(histories.get("TASI"))
    benchmark_dates = sorted(benchmark)
    outcomes: list[dict] = []
    for event in events:
        event_time = _timestamp(event.get("available_at"))
        if event_time is None:
            outcomes.append(_censored(event, horizon, "invalid event timestamp"))
            continue
        event_day = event_time.astimezone(_RIYADH).date().isoformat()
        future_dates = [value for value in benchmark_dates if value > event_day]
        if len(future_dates) < horizon:
            outcomes.append(_censored(event, horizon, "incomplete benchmark window"))
            continue
        entry_date = future_dates[0]
        exit_date = future_dates[horizon - 1]
        stock = _bars_by_date(histories.get(event["symbol"]))
        if any(session_date not in stock for session_date in future_dates[:horizon]):
            outcomes.append(_censored(event, horizon, "unmatched stock dates"))
            continue
        try:
            stock_entry = float(stock[entry_date]["open"])
            stock_exit = float(stock[exit_date]["close"])
            benchmark_entry = float(benchmark[entry_date]["open"])
            benchmark_exit = float(benchmark[exit_date]["close"])
            if min(stock_entry, benchmark_entry) <= 0 or not all(
                math.isfinite(value)
                for value in (stock_entry, stock_exit, benchmark_entry, benchmark_exit)
            ):
                raise ValueError
        except (KeyError, TypeError, ValueError):
            outcomes.append(_censored(event, horizon, "invalid matched prices"))
            continue
        stock_return = round((stock_exit / stock_entry - 1) * 100, 6)
        benchmark_return = round((benchmark_exit / benchmark_entry - 1) * 100, 6)
        excess_return = round(stock_return - benchmark_return, 6)
        label_time = datetime.combine(date.fromisoformat(exit_date), time(13, 30), timezone.utc)
        outcomes.append({
            "event_id": event["event_id"],
            "symbol": event["symbol"],
            "event_class": event["event_class"],
            "available_at": event["available_at"],
            "horizon_sessions": horizon,
            "entry_date": entry_date,
            "exit_date": exit_date,
            "return_pct": stock_return,
            "benchmark_return_pct": benchmark_return,
            "excess_return_pct": excess_return,
            "outcome": int(excess_return > 0),
            "label_available_at": label_time.isoformat(),
            "status": "complete",
        })
    return outcomes


def link_anomaly(observed_at: str, symbol: str, events: list[dict], news_status: str) -> dict:
    """Keep later explanations separate so they cannot rewrite the original state."""
    observed = _timestamp(observed_at)
    if observed is None:
        raise ValueError("observed_at must be a precise timezone-aware timestamp")
    relevant = [event for event in events if event.get("symbol") == symbol]
    timely = []
    later = []
    for event in relevant:
        available = _timestamp(event.get("available_at"))
        if available is None:
            continue
        if observed - timedelta(days=5) <= available <= observed:
            timely.append(event["event_id"])
        elif observed < available <= observed + timedelta(days=5):
            later.append(event["event_id"])
    if timely:
        status = "event-linked"
    elif news_status == "failed":
        status = "news-unavailable"
    else:
        status = "unexplained"
    return {
        "status": status,
        "news_status": news_status,
        "timely_events": timely,
        "possible_later_explanations": later,
        "causation": "not-proven",
    }


def walk_forward(rows: list[dict], min_training_events: int = 30) -> list[dict]:
    """Score each event using only outcomes known before that event was usable."""
    complete = [
        row for row in rows
        if row.get("status") == "complete"
        and row.get("outcome") in (0, 1)
        and _timestamp(row.get("available_at")) is not None
        and _timestamp(row.get("label_available_at")) is not None
    ]
    complete.sort(key=lambda row: (_timestamp(row["available_at"]), row["event_id"], row.get("symbol", "")))
    predictions: list[dict] = []
    for test in complete:
        training_candidates = [
            row for row in complete
            if row["event_id"] != test["event_id"]
            and row.get("horizon_sessions") == test.get("horizon_sessions")
            and _timestamp(row["label_available_at"]) < _timestamp(test["available_at"])
        ]
        training_by_event: dict[str, dict] = {}
        for row in sorted(training_candidates, key=lambda item: _timestamp(item["label_available_at"])):
            training_by_event.setdefault(row["event_id"], row)
        training = list(training_by_event.values())
        prediction = {
            "event_id": test["event_id"],
            "symbol": test.get("symbol"),
            "available_at": test["available_at"],
            "horizon_sessions": test.get("horizon_sessions"),
            "outcome": test["outcome"],
            "training_events": len(training),
            "latest_training_label": (
                max(training, key=lambda row: _timestamp(row["label_available_at"]))["label_available_at"]
                if training else None
            ),
        }
        if len(training) < min_training_events:
            prediction["status"] = "insufficient-training"
            predictions.append(prediction)
            continue
        positives = sum(row["outcome"] for row in training)
        same_class = [row for row in training if row.get("event_class") == test.get("event_class")]
        class_positives = sum(row["outcome"] for row in same_class)
        prediction.update({
            "status": "scored",
            "base_probability": (positives + 1) / (len(training) + 2),
            "probability": (class_positives + 1) / (len(same_class) + 2),
            "event_class_training_events": len(same_class),
        })
        predictions.append(prediction)
    return predictions


def _expected_calibration_error(rows: list[dict]) -> float | None:
    if not rows:
        return None
    total = len(rows)
    error = 0.0
    for lower in (0.0, 0.2, 0.4, 0.6, 0.8):
        upper = lower + 0.2
        bucket = [
            row for row in rows
            if lower <= row["probability"] < upper
            or (upper == 1.0 and row["probability"] == 1.0)
        ]
        if bucket:
            mean_probability = sum(row["probability"] for row in bucket) / len(bucket)
            mean_outcome = sum(row["outcome"] for row in bucket) / len(bucket)
            error += len(bucket) / total * abs(mean_probability - mean_outcome)
    return error


def validation_report(outcomes: list[dict], predictions: list[dict]) -> dict:
    complete = [row for row in outcomes if row.get("status") == "complete"]
    scored = [row for row in predictions if row.get("status") == "scored"]
    report = {
        "status": "unavailable",
        "probability_release_enabled": False,
        "outcome_rows": len(outcomes),
        "complete_outcomes": len(complete),
        "censored_outcomes": len(outcomes) - len(complete),
        "scored_predictions": len(scored),
        "coverage": (len(complete) / len(outcomes)) if outcomes else 0.0,
        "brier": None,
        "base_brier": None,
        "brier_skill": None,
        "log_loss": None,
        "base_log_loss": None,
        "log_loss_skill": None,
        "ece": _expected_calibration_error(scored),
        "release_blockers": [
            "Independent uncertainty bounds are not established.",
            "Performance stability across periods and regimes is not established.",
            "Survivorship coverage is not established.",
            "After-cost expectancy is not established.",
        ],
    }
    if not scored:
        report["release_blockers"].insert(0, "No eligible out-of-sample predictions are available.")
        return report
    epsilon = 1e-12
    brier = sum((row["probability"] - row["outcome"]) ** 2 for row in scored) / len(scored)
    base_brier = sum((row["base_probability"] - row["outcome"]) ** 2 for row in scored) / len(scored)
    log_loss = -sum(
        row["outcome"] * math.log(max(epsilon, min(1 - epsilon, row["probability"])))
        + (1 - row["outcome"]) * math.log(max(epsilon, min(1 - epsilon, 1 - row["probability"])))
        for row in scored
    ) / len(scored)
    base_log_loss = -sum(
        row["outcome"] * math.log(max(epsilon, min(1 - epsilon, row["base_probability"])))
        + (1 - row["outcome"]) * math.log(max(epsilon, min(1 - epsilon, 1 - row["base_probability"])))
        for row in scored
    ) / len(scored)
    report.update({
        "brier": brier,
        "base_brier": base_brier,
        "brier_skill": base_brier - brier,
        "log_loss": log_loss,
        "base_log_loss": base_log_loss,
        "log_loss_skill": base_log_loss - log_loss,
    })
    if report["brier_skill"] <= 0 or report["log_loss_skill"] <= 0:
        report["release_blockers"].insert(0, "The model did not beat the training-only base rate on both proper scores.")
    return report


def _read_news(path: Path) -> list[dict]:
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            value = json.loads(line)
            if isinstance(value, dict):
                records.append(value)
    return records


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--news", type=Path, required=True)
    parser.add_argument("--bars", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    events, exclusions = normalize_events(_read_news(args.news))
    histories = json.loads(args.bars.read_text(encoding="utf-8")) if args.bars else {}
    outcomes = []
    if histories:
        for horizon in (1, 5):
            outcomes.extend(event_outcomes(events, histories, horizon))
    predictions = walk_forward(outcomes)
    report = validation_report(outcomes, predictions)
    report["data_status"] = "available" if histories else "missing-bars"
    payload = {
        "events": events,
        "exclusions": exclusions,
        "outcomes": outcomes,
        "predictions": predictions,
        "report": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
