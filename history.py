"""
Day-over-day history: an append-only, per-code snapshot store, plus the
delta and streak math built on it. Pure functions only -- main.py owns the
history.json file I/O (same _load/_save pattern as state.json).

One snapshot per code per day. Re-running the same day updates that day's
entry in place rather than appending a duplicate -- this is what makes two
digest runs on the same day produce identical deltas and streaks:
compute_delta/compute_streak both compare only against entries whose date
is STRICTLY BEFORE today, so a same-day rerun's own just-written entry is
never compared against itself, and it does not matter whether you call
record_snapshot before or after computing the delta/streak for that code.
"""

from __future__ import annotations

MAX_ENTRIES_PER_CODE = 90


def record_snapshot(history: dict, code: str, today: str, snapshot: dict) -> dict:
    """Append today's snapshot for `code`, or replace it if this code already
    has an entry for `today` (idempotent reruns). Caps at MAX_ENTRIES_PER_CODE,
    dropping the oldest. Returns a NEW history dict; does not mutate `history`.
    """
    history = dict(history)
    entries = list(history.get(code, []))
    entry = {"date": today, **snapshot}
    if entries and entries[-1]["date"] == today:
        entries[-1] = entry
    else:
        entries.append(entry)
    history[code] = entries[-MAX_ENTRIES_PER_CODE:]
    return history


def _entries_before(history: dict, code: str, today: str) -> list:
    return sorted([e for e in history.get(code, []) if e["date"] < today],
                 key=lambda e: e["date"])


def compute_delta(history: dict, code: str, today: str, snapshot: dict) -> dict | None:
    """vs yesterday: price %, RSI delta, rules-met delta, which rules (if any)
    flipped passed/failed state, and whether trend flipped. None if there is
    no prior snapshot for this code (first run -- the caller renders "no
    prior data" rather than a delta)."""
    prior = _entries_before(history, code, today)
    if not prior:
        return None
    y = prior[-1]
    price_pct = None
    if y.get("price"):
        price_pct = round((snapshot["price"] - y["price"]) / y["price"] * 100, 2)
    rsi_delta = None
    if y.get("rsi") is not None and snapshot.get("rsi") is not None:
        rsi_delta = round(snapshot["rsi"] - y["rsi"], 1)
    rules_met_delta = None
    if y.get("rules_met") is not None and snapshot.get("rules_met") is not None:
        rules_met_delta = snapshot["rules_met"] - y["rules_met"]
    flipped = sorted(set(y.get("blocking") or []) ^ set(snapshot.get("blocking") or []))
    trend_flipped = y.get("trend") != snapshot.get("trend")
    return {"price_pct": price_pct, "rsi_delta": rsi_delta,
            "rules_met_delta": rules_met_delta, "flipped": flipped,
            "trend_flipped": trend_flipped}


def compute_streak(history: dict, code: str, today: str, field: str, today_value) -> dict:
    """Consecutive days (ending today) that `field` has held `today_value`,
    and the date that streak began. With no prior history, or if yesterday's
    value differs, the streak is 1 day starting today -- a graceful default,
    not an error."""
    prior = _entries_before(history, code, today)
    days, started = 1, today
    for e in reversed(prior):
        if e.get(field) == today_value:
            days += 1
            started = e["date"]
        else:
            break
    return {"days": days, "started": started}
