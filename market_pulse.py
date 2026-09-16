"""Build the canonical five-minute delayed market pulse."""
from __future__ import annotations

import math
from datetime import datetime, timezone

import pandas as pd

import artifacts
import data


def _utc_timestamp(value) -> str:
    stamp = pd.Timestamp(value)
    stamp = stamp.tz_localize("Asia/Riyadh") if stamp.tzinfo is None else stamp.tz_convert("Asia/Riyadh")
    return stamp.tz_convert("UTC").isoformat().replace("+00:00", "Z")


def _quote(code: str, name: str, frame: pd.DataFrame) -> dict | None:
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
        "code": code,
        "name": name,
        "price": round(latest, 4),
        "changePct": round(change, 4) if change is not None and math.isfinite(change) else None,
        "sessionVolume": round(session_volume, 4) if session_volume is not None and math.isfinite(session_volume) else None,
        "observedAt": _utc_timestamp(clean.index[-1]),
        "latency": "delayed-intraday",
    }


def collect(items: list[dict], *, now: str | None = None, fetch=None) -> dict:
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
