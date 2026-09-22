"""Pure contract for the delayed, observation-only five-minute market pulse."""

from __future__ import annotations

import pandas as pd

import analyze as az


INDEX_CODE = "^TASI.SR"
INTERVAL_MINUTES = 5
REGIME_HISTORY_BARS = 52


def _timestamp(value) -> pd.Timestamp | None:
    try:
        stamp = pd.Timestamp(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(stamp):
        return None
    return stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp.tz_convert("UTC")


def _iso(value) -> str | None:
    stamp = _timestamp(value)
    return stamp.isoformat().replace("+00:00", "Z") if stamp is not None else None


def _usable_bar(frame: pd.DataFrame, fetched_at: pd.Timestamp, max_age_minutes: int,
                interval_minutes: int) -> tuple[pd.Timestamp, float, float] | None:
    if frame is None or frame.empty or "Close" not in frame or len(frame) < 2:
        return None
    completed = []
    for position in range(len(frame)):
        stamp = _timestamp(frame.index[position])
        if stamp is not None and stamp + pd.Timedelta(minutes=interval_minutes) <= fetched_at:
            completed.append(position)
    if len(completed) < 2:
        return None
    latest_position, previous_position = completed[-1], completed[-2]
    try:
        latest_at = _timestamp(frame.index[latest_position])
        latest = float(frame["Close"].iloc[latest_position])
        previous = float(frame["Close"].iloc[previous_position])
    except (IndexError, TypeError, ValueError):
        return None
    if latest_at is None or not pd.notna(latest) or not pd.notna(previous) or previous == 0:
        return None
    age_minutes = (fetched_at - latest_at).total_seconds() / 60
    if age_minutes < 0 or age_minutes > max_age_minutes:
        return None
    return latest_at, latest, (latest / previous - 1) * 100


def _regime(index_daily: pd.DataFrame) -> dict:
    bars = 0 if index_daily is None or index_daily.empty else len(index_daily)
    if bars < REGIME_HISTORY_BARS:
        return {
            "status": "unavailable",
            "reason": f"Market regime unavailable: the index returned {bars} usable daily bars; 50 are required.",
        }
    return {"status": "available", "label": az.market_regime(index_daily, 50), "bars": bars}


def build_market_pulse(
    intraday: dict[str, pd.DataFrame],
    index_daily: pd.DataFrame,
    tracked_codes: list[str],
    *,
    source: str,
    fetched_at: str,
    declared_delay_minutes: int,
    prior: dict | None = None,
    interval_minutes: int = INTERVAL_MINUTES,
    coverage_threshold: float = 0.7,
) -> dict:
    """Build a fact-only pulse or retain the last valid artifact as stale.

    The source must provide completed bars; caller-supplied values cannot turn an
    incomplete response into a current pulse. This intentionally does not emit
    alerts or decisions.
    """
    fetched = _timestamp(fetched_at)
    if fetched is None:
        raise ValueError("fetched_at must be a valid timestamp")
    if not source.strip() or declared_delay_minutes < 0 or interval_minutes < 1:
        raise ValueError("pulse source and delay configuration are invalid")

    tracked = list(dict.fromkeys(str(code) for code in tracked_codes if str(code) and str(code) != INDEX_CODE))
    required = max(1, round(len(tracked) * coverage_threshold)) if tracked else 0
    max_age_minutes = declared_delay_minutes + interval_minutes * 2
    index = _usable_bar(intraday.get(INDEX_CODE, pd.DataFrame()), fetched, max_age_minutes, interval_minutes)
    observations = []
    for code in tracked:
        usable = _usable_bar(intraday.get(code, pd.DataFrame()), fetched, max_age_minutes, interval_minutes)
        if usable is None:
            continue
        observed_at, price, change_pct = usable
        observations.append({"code": code, "price": round(price, 4), "changePct": round(change_pct, 4), "latestBarAt": _iso(observed_at)})

    coverage = {"tracked": len(tracked), "usable": len(observations), "required": required}
    reason = None
    if index is None:
        reason = "Market pulse unavailable: the index has no recent completed five-minute bar."
    elif len(observations) < required:
        reason = f"Market pulse unavailable: {len(observations)} of {len(tracked)} tracked stocks have usable completed bars; {required} are required."

    if reason:
        if prior and prior.get("status") in {"current", "stale"}:
            stale = dict(prior)
            stale.update({
                "status": "stale", "source": source, "fetchedAt": _iso(fetched), "reason": reason,
                "lastValidAt": prior.get("fetchedAt") or prior.get("lastValidAt"), "attemptCoverage": coverage,
            })
            return stale
        return {
            "schemaVersion": 1, "artifactKind": "market-pulse", "status": "unavailable", "source": source,
            "dataStatus": "delayed-intraday", "intervalMinutes": interval_minutes,
            "declaredDelayMinutes": declared_delay_minutes, "fetchedAt": _iso(fetched), "coverage": coverage,
            "reason": reason, "regime": _regime(index_daily), "observations": [],
        }

    index_at, index_price, index_change = index
    return {
        "schemaVersion": 1, "artifactKind": "market-pulse", "status": "current", "source": source,
        "dataStatus": "delayed-intraday", "intervalMinutes": interval_minutes,
        "declaredDelayMinutes": declared_delay_minutes, "fetchedAt": _iso(fetched), "observedAt": _iso(index_at),
        "coverage": coverage,
        "index": {"code": INDEX_CODE, "price": round(index_price, 4), "changePct": round(index_change, 4), "latestBarAt": _iso(index_at)},
        "regime": _regime(index_daily), "observations": observations,
    }
