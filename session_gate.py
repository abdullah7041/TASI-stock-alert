"""Whether the Tadawul session is open, in Riyadh local time.

A managed scheduler fires on wall-clock time and knows nothing about market
holidays, so this gate stays authoritative: an invocation that lands on a
closed day must decide nothing and send nothing. Kept dependency-free so it
runs identically in the GitHub fallback and in the Cloud Run job.
"""
from __future__ import annotations

import json
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

RIYADH = timezone(timedelta(hours=3))
HOLIDAYS_FILE = Path(__file__).parent / "market_holidays.json"

# Tadawul trades Sunday through Thursday. Python weekday(): Monday=0 ... Sunday=6.
TRADING_WEEKDAYS = {6, 0, 1, 2, 3}
SESSION_OPEN = time(10, 0)
SESSION_CLOSE = time(15, 0)
# The pre-open digest runs before the auction, so it has its own window.
PRE_OPEN_EARLIEST = time(9, 0)


def riyadh_now(now: datetime | None = None) -> datetime:
    """Current time in Riyadh, whatever timezone the caller's clock is in."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(RIYADH)


def load_holidays(path: Path | None = None) -> set[str]:
    """Closed dates as YYYY-MM-DD. A missing file means none are recorded."""
    source = path or HOLIDAYS_FILE
    if not source.exists():
        return set()
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except ValueError:
        return set()
    return {str(item) for item in payload.get("closed", [])}


def is_trading_day(now: datetime | None = None, holidays: set[str] | None = None) -> bool:
    local = riyadh_now(now)
    closed = load_holidays() if holidays is None else holidays
    return local.weekday() in TRADING_WEEKDAYS and local.date().isoformat() not in closed


def is_session_open(now: datetime | None = None, holidays: set[str] | None = None) -> bool:
    local = riyadh_now(now)
    return is_trading_day(now, holidays) and SESSION_OPEN <= local.time() < SESSION_CLOSE


def is_pre_open_window(now: datetime | None = None, holidays: set[str] | None = None) -> bool:
    local = riyadh_now(now)
    return is_trading_day(now, holidays) and PRE_OPEN_EARLIEST <= local.time() < SESSION_OPEN


def gate_reason(mode: str, now: datetime | None = None, holidays: set[str] | None = None) -> str | None:
    """Why this mode must not run now, or None when it may proceed."""
    local = riyadh_now(now)
    if not is_trading_day(now, holidays):
        return f"market closed on {local.date().isoformat()} (weekend or recorded holiday)"
    if mode == "digest" and not is_pre_open_window(now, holidays):
        return f"pre-open digest window is {PRE_OPEN_EARLIEST:%H:%M}-{SESSION_OPEN:%H:%M} Riyadh, not {local:%H:%M}"
    if mode == "session" and not is_session_open(now, holidays):
        return f"session window is {SESSION_OPEN:%H:%M}-{SESSION_CLOSE:%H:%M} Riyadh, not {local:%H:%M}"
    if mode == "reconcile" and local.time() < SESSION_CLOSE:
        return f"reconciliation runs after the {SESSION_CLOSE:%H:%M} Riyadh close, not {local:%H:%M}"
    return None
