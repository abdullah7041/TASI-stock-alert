"""Pure contract for the delayed, observation-only five-minute market pulse."""

from __future__ import annotations

import pandas as pd
import math
from datetime import datetime, timezone

import analyze as az
import artifacts
import data


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


def _regime(index_daily: pd.DataFrame, fetched_at: pd.Timestamp) -> dict:
    if index_daily is not None and not index_daily.empty:
        local_fetch = fetched_at.tz_convert("Asia/Riyadh")
        session_closed = local_fetch.hour >= 15
        keep = []
        for value in index_daily.index:
            stamp = _timestamp(value)
            local_day = stamp.tz_convert("Asia/Riyadh").date() if stamp is not None else None
            keep.append(local_day is not None and (local_day < local_fetch.date() or (local_day == local_fetch.date() and session_closed)))
        index_daily = index_daily.iloc[[position for position, valid in enumerate(keep) if valid]]
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
    required = max(1, math.ceil(len(tracked) * coverage_threshold)) if tracked else 0
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
                "lastValidAt": prior.get("lastValidAt") or prior.get("fetchedAt"), "attemptCoverage": coverage,
            })
            return stale
        return {
            "schemaVersion": 1, "artifactKind": "market-pulse", "status": "unavailable", "source": source,
            "dataStatus": "delayed-intraday", "intervalMinutes": interval_minutes,
            "declaredDelayMinutes": declared_delay_minutes, "fetchedAt": _iso(fetched), "coverage": coverage,
            "reason": reason, "regime": _regime(index_daily, fetched), "observations": [],
        }

    index_at, index_price, index_change = index
    return {
        "schemaVersion": 1, "artifactKind": "market-pulse", "status": "current", "source": source,
        "dataStatus": "delayed-intraday", "intervalMinutes": interval_minutes,
        "declaredDelayMinutes": declared_delay_minutes, "fetchedAt": _iso(fetched), "observedAt": _iso(index_at),
        "coverage": coverage,
        "index": {"code": INDEX_CODE, "price": round(index_price, 4), "changePct": round(index_change, 4), "latestBarAt": _iso(index_at)},
        "regime": _regime(index_daily, fetched), "observations": observations,
    }


def _utc_timestamp(value) -> str:
    stamp = pd.Timestamp(value)
    stamp = stamp.tz_localize("Asia/Riyadh") if stamp.tzinfo is None else stamp.tz_convert("Asia/Riyadh")
    return stamp.tz_convert("UTC").isoformat().replace("+00:00", "Z")


def _quote(code: str, name: str, frame: pd.DataFrame) -> dict | None:
    """Legacy daily-dashboard pulse, kept separate from MarketPulseV1."""
    if frame is None or frame.empty:
        return None
    clean = frame.sort_index()
    local_index = pd.DatetimeIndex(clean.index)
    local_index = local_index.tz_localize("Asia/Riyadh") if local_index.tz is None else local_index.tz_convert("Asia/Riyadh")
    latest_day = local_index[-1].date()
    session_mask = [stamp.date() == latest_day for stamp in local_index]
    prior_positions = [index for index, stamp in enumerate(local_index) if stamp.date() < latest_day]
    latest = float(clean["Close"].iloc[-1])
    if not math.isfinite(latest) or latest <= 0:
        return None
    previous_close = float(clean["Close"].iloc[prior_positions[-1]]) if prior_positions else None
    change = 100 * (latest / previous_close - 1) if previous_close and previous_close > 0 else None
    session_volume = float(clean.loc[session_mask, "Volume"].sum()) if "Volume" in clean else None
    return {
        "code": code, "name": name, "price": round(latest, 4),
        "changePct": round(change, 4) if change is not None and math.isfinite(change) else None,
        "sessionVolume": round(session_volume, 4) if session_volume is not None and math.isfinite(session_volume) else None,
        "observedAt": _utc_timestamp(clean.index[-1]), "latency": "delayed-intraday",
    }


def collect(items: list[dict], *, now: str | None = None, fetch=None) -> dict:
    """Existing dashboard pulse producer; never used by the managed shadow pulse."""
    unique = {str(item["code"]): str(item.get("name") or item["code"]) for item in items}
    requested = list(unique)
    batch = (fetch or data.get_intraday_histories)(requested)
    quotes = [quote for code in requested
              if (quote := _quote(code, unique[code], batch.frames.get(code))) is not None]
    status = batch.status
    if quotes and len(quotes) < len(requested):
        status = "partial"
    elif quotes and status in {"empty", "failed"}:
        status = "partial"
    as_of = now or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return artifacts.build_market_pulse_artifact(
        status=status, as_of=as_of, quotes=quotes, requested=requested, errors=list(batch.errors))
