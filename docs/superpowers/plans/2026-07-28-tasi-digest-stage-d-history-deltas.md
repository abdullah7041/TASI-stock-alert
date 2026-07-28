# TASI Digest Stage D — Day-over-day deltas + streaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show what changed since yesterday. New `history.json` (append-only, per-code, capped at 90 daily snapshots) backs two computations: a day-over-day delta (price %, RSI delta, rules-met delta, which rules flipped) and a streak (consecutive days at the current trend / rules-met state). The digest marks changed names with `▲` and collapses unchanged ones to a short line, so attention goes to what's new.

**Architecture:** New `history.py`, pure functions only (no I/O — same convention as `indicators.py`/`triggers.py`). `main.py` owns `history.json` I/O (same `_load`/`_save` pattern as `state.json`), builds one snapshot dict per name per run, computes delta+streak, attaches both to the rec dict. `notify.py` renders them.

**Tech Stack:** Python 3, pytest, existing project conventions.

## Global Constraints (design decisions made now, not re-litigated per task)

- **Idempotence is load-bearing.** Running the digest twice on the same day must show identical deltas and streaks (this is explicitly required by the master design doc's Verification section). Mechanism: `record_snapshot` replaces today's entry in place on a same-day rerun rather than appending a duplicate, and both `compute_delta`/`compute_streak` only ever compare against entries whose `date` is **strictly before** today — so a rerun's own just-written entry is never compared against itself, and call order relative to `record_snapshot` does not matter.
- **Snapshot schema** (one dict per code per day, all fields present, `None` where not applicable): `{"date": "YYYY-MM-DD", "price": float, "rsi": float|None, "trend": "up"|"down"|"flat"|"unknown", "rules_met": int|None, "blocking": list[str]|None}`. `rules_met`/`blocking` are `None` for holdings (they have no BUY rule checklist); watchlist names populate both from `rec["rules_met"]` and the rule names in `rec["rules"]` where `passed` is `False`.
- **"Changed" (gets the `▲` marker) means:** for a name with prior data, any of: a rule flipped pass/fail state (watchlist only), `rules_met` changed (watchlist only), or `trend` changed (both kinds). Price movement alone is NOT "changed" — that's ordinary daily noise, not new information. A name with no prior data (first run for that code) is never marked changed (there's nothing to compare against).
- **"Collapse to one line" means:** when a name is NOT changed AND has no news headlines this run (news is always new information — never hide it, that would undo Stage A's entire point), skip the existing detailed body (rules/trigger/short-long-term reads block for watchlist; the equivalent detail for holdings) and print exactly one summary line combining the trend-streak phrase with a news-or-no-news note. When changed, or when news headlines exist, print the full existing body (unchanged from Stages A-C) plus the new streak line — never hide the detail that explains a change.
- **Only the trend streak gets a rendered line.** The rules-met streak is computed (for potential future use and because the master doc asks for it) but is not printed as its own line in this stage — it would be redundant with the existing "Rules met: X/Y" line plus the new rules_met delta. Do not add a second streak line for it.
- **First run for a code (no prior snapshot) degrades gracefully**: `compute_delta` returns `None` (caller renders no "vs yesterday" info, no `▲`, no collapse), `compute_streak` returns `{"days": 1, "started": today}` (a real, honest streak of length 1 — not an error, not a placeholder string).
- `history.json` lives at `HERE / "history.json"` in `main.py`, loaded/saved with the existing `_load`/`_save` helpers, exactly like `state.json`. It is written once per `mode_digest` run (not `mode_run` — that can fire multiple times per session and would corrupt the one-entry-per-day invariant if it also wrote snapshots).
- This is Stage D of a 6-stage plan (master doc: `C:\Users\NoteBook Pc\.claude\plans\still-not-what-i-sequential-gizmo.md`). Stage E (disclosures feed, `TECH["rsi_period"]` threading bug, CI test step) and Stage F (scanner) are untouched by this plan.

---

## File Structure

| File | Change |
|---|---|
| `history.py` | **New** — `record_snapshot`, `compute_delta`, `compute_streak` (all pure) |
| `main.py` | Load/save `history.json`; build snapshot per rec; attach `delta`/`trend_streak` to each rec |
| `notify.py` | `▲` marker, price-delta in header, `Trend: ...` streak line, one-line collapse for unchanged/no-news names |
| `test_core.py` | New tests for all of the above |
| `README.md` | New section describing the delta/streak behavior |

---

## Task 1: `history.py` — snapshot store, delta, streak (pure functions)

**Files:**
- Create: `history.py`
- Test: `test_core.py`

**Interfaces:**
- Produces: `record_snapshot(history: dict, code: str, today: str, snapshot: dict) -> dict` (returns a new dict, does not mutate the input); `compute_delta(history: dict, code: str, today: str, snapshot: dict) -> dict | None`; `compute_streak(history: dict, code: str, today: str, field: str, today_value) -> dict`.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py`, in a new section (anywhere after the trigger-price tests, e.g. right before the `# --- BUY decision ---` section, is fine — match existing style):

```python
# --- history: snapshots, deltas, streaks ------------------------------------
import history as hist

def test_record_snapshot_appends_new_day():
    h = hist.record_snapshot({}, "4015", "2026-07-27", {"price": 100.0, "rsi": 50.0,
                              "trend": "up", "rules_met": 2, "blocking": ["momentum_floor"]})
    assert h["4015"] == [{"date": "2026-07-27", "price": 100.0, "rsi": 50.0,
                          "trend": "up", "rules_met": 2, "blocking": ["momentum_floor"]}]

def test_record_snapshot_same_day_rerun_replaces_not_appends():
    h = hist.record_snapshot({}, "4015", "2026-07-27", {"price": 100.0, "rsi": 50.0,
                              "trend": "up", "rules_met": 2, "blocking": []})
    h2 = hist.record_snapshot(h, "4015", "2026-07-27", {"price": 101.0, "rsi": 51.0,
                               "trend": "up", "rules_met": 3, "blocking": []})
    assert len(h2["4015"]) == 1
    assert h2["4015"][0]["price"] == 101.0

def test_record_snapshot_caps_at_90_entries():
    h = {}
    for i in range(95):
        h = hist.record_snapshot(h, "4015", f"2026-01-{i:03d}", {"price": float(i),
                                  "rsi": 50.0, "trend": "up", "rules_met": 1, "blocking": []})
    assert len(h["4015"]) == 90
    assert h["4015"][0]["date"] == "2026-01-005"  # oldest 5 dropped
    assert h["4015"][-1]["date"] == "2026-01-094"

def test_record_snapshot_does_not_mutate_input():
    original = {}
    hist.record_snapshot(original, "4015", "2026-07-27", {"price": 1.0, "rsi": None,
                          "trend": "flat", "rules_met": None, "blocking": None})
    assert original == {}

def test_compute_delta_none_on_first_run():
    assert hist.compute_delta({}, "4015", "2026-07-27",
                               {"price": 100.0, "rsi": 50.0, "trend": "up",
                                "rules_met": 2, "blocking": []}) is None

def test_compute_delta_price_rsi_rules_met_and_flip():
    h = {"4015": [{"date": "2026-07-27", "price": 100.0, "rsi": 40.0, "trend": "down",
                   "rules_met": 1, "blocking": ["trend", "momentum_floor"]}]}
    d = hist.compute_delta(h, "4015", "2026-07-28",
                           {"price": 105.0, "rsi": 45.0, "trend": "up",
                            "rules_met": 2, "blocking": ["momentum_floor"]})
    assert d["price_pct"] == 5.0
    assert d["rsi_delta"] == 5.0
    assert d["rules_met_delta"] == 1
    assert d["flipped"] == ["trend"]  # trend rule passed today, was blocking yesterday
    assert d["trend_flipped"] is True

def test_compute_delta_no_change_is_zero_not_none():
    h = {"4015": [{"date": "2026-07-27", "price": 100.0, "rsi": 40.0, "trend": "down",
                   "rules_met": 1, "blocking": ["trend"]}]}
    d = hist.compute_delta(h, "4015", "2026-07-28",
                           {"price": 100.0, "rsi": 40.0, "trend": "down",
                            "rules_met": 1, "blocking": ["trend"]})
    assert d["price_pct"] == 0.0
    assert d["rsi_delta"] == 0.0
    assert d["rules_met_delta"] == 0
    assert d["flipped"] == []
    assert d["trend_flipped"] is False

def test_compute_delta_ignores_todays_own_entry_same_day_rerun():
    # Simulates a second digest run on the same day: history already has
    # TODAY's entry (from the first run) alongside yesterday's. The delta
    # must still be computed against yesterday, not today's own entry.
    h = {"4015": [{"date": "2026-07-27", "price": 100.0, "rsi": 40.0, "trend": "down",
                   "rules_met": 1, "blocking": ["trend"]},
                  {"date": "2026-07-28", "price": 105.0, "rsi": 45.0, "trend": "up",
                   "rules_met": 2, "blocking": []}]}
    d = hist.compute_delta(h, "4015", "2026-07-28",
                           {"price": 105.0, "rsi": 45.0, "trend": "up",
                            "rules_met": 2, "blocking": []})
    assert d["price_pct"] == 5.0  # vs the 07-27 entry, not the 07-28 one

def test_compute_delta_holding_has_no_rules_met_or_blocking():
    h = {"1303": [{"date": "2026-07-27", "price": 15.0, "rsi": 50.0, "trend": "down",
                   "rules_met": None, "blocking": None}]}
    d = hist.compute_delta(h, "1303", "2026-07-28",
                           {"price": 15.2, "rsi": 51.0, "trend": "down",
                            "rules_met": None, "blocking": None})
    assert d["rules_met_delta"] is None
    assert d["flipped"] == []
    assert d["trend_flipped"] is False

def test_compute_streak_first_day_is_one():
    s = hist.compute_streak({}, "4015", "2026-07-28", "trend", "up")
    assert s == {"days": 1, "started": "2026-07-28"}

def test_compute_streak_counts_consecutive_matching_days():
    h = {"4015": [{"date": "2026-07-25", "trend": "up"},
                  {"date": "2026-07-26", "trend": "up"},
                  {"date": "2026-07-27", "trend": "down"}]}
    s = hist.compute_streak(h, "4015", "2026-07-28", "trend", "down")
    assert s == {"days": 2, "started": "2026-07-27"}

def test_compute_streak_breaks_on_first_mismatch():
    h = {"4015": [{"date": "2026-07-24", "trend": "down"},
                  {"date": "2026-07-25", "trend": "up"},
                  {"date": "2026-07-26", "trend": "up"},
                  {"date": "2026-07-27", "trend": "up"}]}
    s = hist.compute_streak(h, "4015", "2026-07-28", "trend", "up")
    assert s == {"days": 4, "started": "2026-07-25"}

def test_compute_streak_ignores_todays_own_entry():
    h = {"4015": [{"date": "2026-07-27", "trend": "up"},
                  {"date": "2026-07-28", "trend": "up"}]}  # same-day rerun artifact
    s = hist.compute_streak(h, "4015", "2026-07-28", "trend", "up")
    assert s["days"] == 2  # 07-27 + today, NOT 07-27 + 07-28 + today
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "record_snapshot or compute_delta or compute_streak" -v`
Expected: FAIL — `history` module does not exist.

- [ ] **Step 3: Write `history.py`**

```python
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
```

- [ ] **Step 4: Run the new tests**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "record_snapshot or compute_delta or compute_streak" -v`
Expected: all 12 PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass (116 + 12 = 128).

- [ ] **Step 6: Commit**

```bash
git add history.py test_core.py
git commit -m "Add history.py: append-only snapshot store, delta, streak"
```

---

## Task 2: Wire into `main.py` + render in `notify.py` (bundled)

Bundled for the same reason Stage C's equivalent task was: a `delta`/`trend_streak` field nobody renders is dead code, worth one task and one review, not a merge risk (rendering additions are additive to `format_recommendation`, no signature change).

**Files:**
- Modify: `main.py` (`_collect_recs`, add `HISTORY_FILE` constant)
- Modify: `notify.py` (`format_recommendation`)
- Test: `test_core.py`

**Interfaces:**
- Consumes: `history.record_snapshot`, `history.compute_delta`, `history.compute_streak` (Task 1); the existing rec dict shape from `evaluate_watchlist`/`evaluate_holding` (has `code`, `price`, `action`, and for watchlist `rules`/`rules_met`, for both `long_term` with `trend`/`rsi`).
- Produces: every rec in `main.py`'s `_collect_recs` gains `rec["delta"]` (the dict from `compute_delta`, or `None`) and `rec["trend_streak"]` (the dict from `compute_streak`). `notify.format_recommendation` renders a `▲` prefix, a price-delta suffix in the header, a `Trend: ...` streak line, and collapses the body to one line when unchanged and news-free.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py`:

```python
def test_collect_recs_attaches_delta_and_streak(tmp_path, monkeypatch):
    # This test exercises main.py's wiring directly by calling the same
    # snapshot-building logic main.py uses, not by running the full
    # _collect_recs pipeline (which hits the network). Build a rec the way
    # evaluate_watchlist would, run it through main.py's snapshot builder.
    import main as m
    rec = {"kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
           "action": "WATCH", "rules": [{"rule": "trend", "passed": False, "actual": "down",
           "required": "up", "plain": "x"}], "rules_met": 0, "rules_total": 1,
           "long_term": {"trend": "down", "rsi": 40.0, "momentum_pct": -6.0}}
    snap = m._snapshot_for(rec)
    assert snap == {"price": 100.0, "rsi": 40.0, "trend": "down",
                    "rules_met": 0, "blocking": ["trend"]}

def test_snapshot_for_holding_has_no_rules_met():
    import main as m
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.0,
           "action": "HOLD", "long_term": {"trend": "up", "rsi": 55.0, "momentum_pct": 2.0}}
    snap = m._snapshot_for(rec)
    assert snap["rules_met"] is None
    assert snap["blocking"] is None
    assert snap["trend"] == "up"

def test_format_recommendation_marks_changed_with_arrow():
    rec = {"kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
           "action": "WATCH", "reason": ["x"], "rules_met": 2, "rules_total": 3,
           "triggers": [], "delta": {"price_pct": 1.0, "rsi_delta": 0.5,
           "rules_met_delta": 1, "flipped": ["trend"], "trend_flipped": True},
           "trend_streak": {"days": 1, "started": "2026-07-28"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert block.startswith("▲")

def test_format_recommendation_no_arrow_when_unchanged():
    rec = {"kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
           "action": "WATCH", "reason": ["x"], "rules_met": 2, "rules_total": 3,
           "triggers": [], "delta": {"price_pct": 0.5, "rsi_delta": 0.1,
           "rules_met_delta": 0, "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 5, "started": "2026-07-24"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert not block.startswith("▲")

def test_format_recommendation_shows_price_delta_in_header():
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.09,
           "action": "HOLD", "reason": [], "unrealized_pct": 21.6,
           "delta": {"price_pct": 0.4, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 11, "started": "2026-07-17"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "+0.4% today" in block

def test_format_recommendation_collapses_when_unchanged_and_no_news():
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.09,
           "action": "HOLD", "reason": [], "unrealized_pct": 21.6,
           "delta": {"price_pct": 0.4, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 11, "started": "2026-07-17"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "below its 50-day average, 11th day" in block
    assert "No news" in block
    assert "short:" not in block  # full short/long-term breakdown suppressed

def test_format_recommendation_does_not_collapse_when_news_present():
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.09,
           "action": "HOLD", "reason": [], "unrealized_pct": 21.6,
           "delta": {"price_pct": 0.4, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 11, "started": "2026-07-17"},
           "news": {"ok": True, "label": "positive", "score": 1.0,
                    "headlines": [{"title": "EIC profit rises", "published": "Mon"}]},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "short:" in block  # full breakdown still shown because news exists

def test_format_recommendation_first_run_no_delta_no_arrow_no_collapse():
    rec = {"kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
           "action": "WATCH", "reason": ["x"], "rules_met": 2, "rules_total": 3,
           "triggers": [], "delta": None,
           "trend_streak": {"days": 1, "started": "2026-07-28"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert not block.startswith("▲")
    assert "today" not in block.split("\n")[0]  # no price-delta suffix without a delta
    assert "short:" in block  # first run always shows full detail
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "snapshot_for or format_recommendation_marks or format_recommendation_no_arrow or format_recommendation_shows_price_delta or format_recommendation_collapses or format_recommendation_does_not_collapse or format_recommendation_first_run" -v`
Expected: FAIL.

- [ ] **Step 3: Add `_snapshot_for` and wire history into `main.py`**

Add `import history as hist` to `main.py`'s imports, and `HISTORY_FILE = HERE / "history.json"` next to the other `*_FILE` constants.

Add this helper function near `_budget_record`:

```python
def _snapshot_for(rec: dict) -> dict:
    lt = rec.get("long_term", {})
    blocking = None
    rules_met = None
    if rec["kind"] == "watchlist":
        rules_met = rec.get("rules_met")
        blocking = sorted(r["rule"] for r in rec.get("rules", []) if not r["passed"])
    return {"price": rec["price"], "rsi": lt.get("rsi"), "trend": lt.get("trend"),
            "rules_met": rules_met, "blocking": blocking}
```

In `_collect_recs`, after the `recs` list is fully built (after both the `for h in cfg.HOLDINGS` and `for w in cfg.WATCHLIST` loops, before the `buys = [...]` line), add:

```python
    history = _load(HISTORY_FILE, {})
    today = _today()
    for rec in recs:
        snap = _snapshot_for(rec)
        rec["delta"] = hist.compute_delta(history, rec["code"], today, snap)
        rec["trend_streak"] = hist.compute_streak(history, rec["code"], today,
                                                   "trend", snap["trend"])
        history = hist.record_snapshot(history, rec["code"], today, snap)
    _save(HISTORY_FILE, history)
```

- [ ] **Step 4: Render in `notify.py`**

Add near the top of `notify.py` (module level, after imports):

```python
def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


_TREND_PHRASE = {"up": "above its 50-day average", "down": "below its 50-day average",
                 "flat": "near its 50-day average"}


def _fmt_trend_streak(streak: dict, trend: str) -> str:
    phrase = _TREND_PHRASE.get(trend, "trend unknown")
    return f"   Trend: {phrase}, {_ordinal(streak['days'])} day (flipped {streak['started']})"


def _is_changed(delta: dict | None) -> bool:
    if delta is None:
        return False
    return bool(delta["flipped"]) or (delta["rules_met_delta"] or 0) != 0 or delta["trend_flipped"]
```

Rewrite `format_recommendation` (replace the existing function):

```python
def format_recommendation(rec: dict) -> str:
    """One block per name. Marks changed names with a leading arrow, shows
    the day-over-day price move in the header, and collapses names with no
    change and no news to one summary line -- attention goes to what's new."""
    delta = rec.get("delta")
    changed = _is_changed(delta)
    news_headlines = bool((rec.get("news") or {}).get("headlines"))
    collapse = (delta is not None) and (not changed) and (not news_headlines)

    arrow = "▲ " if changed else ""
    price_suffix = ""
    if delta is not None and delta.get("price_pct") is not None:
        price_suffix = f" ({delta['price_pct']:+.1f}% today)"
    head = f"{arrow}**{rec['code']} {rec['name']}** @ {rec['price']}{price_suffix}  ->  **{rec['action']}**"
    lines = [head]

    streak = rec.get("trend_streak")
    trend = rec.get("long_term", {}).get("trend")
    streak_line = _fmt_trend_streak(streak, trend) if streak else None

    if collapse:
        news_note = "No news" if not rec.get("news") else _fmt_news(rec["news"])[0].strip()
        lines.append(f"{streak_line.strip()}. {news_note}." if streak_line else f"{news_note}.")
        if rec["kind"] == "holding" and rec.get("unrealized_pct") is not None:
            lines.append(f"   P/L: {rec['unrealized_pct']}%")
        return "\n".join(lines)

    for r in rec.get("reason", []):
        lines.append(f"   - {r}")
    if rec["kind"] == "holding" and rec.get("unrealized_pct") is not None:
        lines.append(f"   P/L: {rec['unrealized_pct']}%")
    if rec["kind"] == "watchlist":
        lines.append(f"   Rules met: {rec.get('rules_met')}/{rec.get('rules_total')}")
        trigger_line = _fmt_trigger(rec.get("triggers") or [])
        if trigger_line:
            lines.append(trigger_line)
        sz = rec.get("sizing")
        if sz and not sz.get("skip"):
            lines.append(
                f"   size: BUY {sz['shares']} sh x {rec['price']} = {sz['spend']} SAR "
                f"(equal weight across qualifying names; "
                f"{sz.get('budget_left_after')} SAR of monthly budget left after)")
        elif sz and sz.get("skip"):
            lines.append(f"   size: none — {sz['skip']}")
    if streak_line:
        lines.append(streak_line)
    if rec.get("news"):
        lines.extend(_fmt_news(rec["news"]))
    lines.append(f"   {_fmt_reads(rec)}")
    return "\n".join(lines)
```

Note: `_fmt_news`'s first line for a headline-free result already reads like `"   news: no headlines found (...)"` or `"   news: fetch failed"` — for the collapsed one-liner, reuse that same first line (stripped) rather than inventing new wording, so "no news" phrasing stays consistent with the rest of the digest. Implementer: read `_fmt_news`'s current behavior before wiring this — if `rec.get("news")` is `None` entirely (news wasn't fetched for this rec at all), fall back to the literal string `"No news"` as shown in the code above.

- [ ] **Step 5: Run the new tests**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "snapshot_for or format_recommendation_marks or format_recommendation_no_arrow or format_recommendation_shows_price_delta or format_recommendation_collapses or format_recommendation_does_not_collapse or format_recommendation_first_run" -v`
Expected: all 8 PASS.

- [ ] **Step 6: Run the FULL suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass. In particular, every PRE-EXISTING `format_recommendation`/`build_message` test must still pass — check whether any pre-existing fixture lacks a `delta`/`trend_streak` key entirely (from before this stage) and confirm `rec.get("delta")` / `rec.get("trend_streak")` degrade safely (delta absent -> `None` -> not changed, not collapsed; `trend_streak` absent -> `None` -> `_fmt_trend_streak` guarded by `if streak else None`, no crash). If any pre-existing test fixture breaks because it now unexpectedly collapses or crashes, that is a real gap in this design — fix the guard, don't edit the old test to match.

- [ ] **Step 7: Commit**

```bash
git add main.py notify.py test_core.py
git commit -m "Wire day-over-day deltas and streaks into the digest"
```

---

## Task 3: Documentation + live end-to-end verification (including idempotence)

**Files:**
- Modify: `README.md`
- No new tests — this task verifies the branch as a whole, including the idempotence guarantee the master design doc requires.

- [ ] **Step 1: Add a README section**

Add right after the "Trigger prices" section Stage C added:

```markdown
## Day-over-day deltas and streaks

Every name gets a snapshot recorded once per digest run (`history.json`, capped
at 90 days per name). From the previous day's snapshot the digest computes: the
price move, the RSI move, whether any BUY rule flipped pass/fail, and how many
consecutive days the current trend has held.

Names where nothing changed (no rule flipped, `rules_met` steady, trend the
same) and that have no fresh news collapse to one line — the digest's
attention goes to what changed, not what didn't. A leading `▲` marks a name
that did change. Running the digest more than once on the same day is safe:
the second run compares against yesterday, not against the first run's own
snapshot, so deltas and streaks come out identical both times.
```

- [ ] **Step 2: Run the full suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass, 0 failures.

- [ ] **Step 3: Manual end-to-end + idempotence check**

Run TWICE in a row: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python main.py digest`

Capture both outputs in full. Confirm:
- `history.json` now exists (or was updated) with one entry per watched/held code.
- The FIRST run's digest shows no `▲` markers and no "collapsed" one-liners for any name that had no PRIOR `history.json` entry before this task's testing began (first run for every code — this is expected and correct, not a bug: there is no "yesterday" yet).
- The SECOND run's digest is compared line-by-line against the first: deltas (the `(+X.X% today)` header suffixes) and streak lines (`Trend: ..., Nth day`) must be IDENTICAL between the two runs — this is the idempotence guarantee. If they differ, that's a real bug (likely: `record_snapshot`'s same-day-replace logic, or `compute_delta`/`compute_streak` not correctly excluding today's own entry) — do not paper over it, investigate `history.py`.
- Report the actual observed outputs, not a description of expected behavior.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document day-over-day deltas and streaks in the README"
```

Note: do NOT commit `history.json` itself from this local test run — it's a runtime artifact (like `news_archive.jsonl`), meant to be committed by the CI workflow on scheduled runs, not by a local verification pass. Leave it untracked/uncommitted (check `.gitignore` covers it; if not, that's fine to leave as an untracked file — do not add it to `.gitignore` either, since the master design doc says the workflow commits it, meaning it MUST be tracked in the repo for CI to pick up and persist across runs. Just don't commit the version generated by THIS local test task).

---

## Self-Review Notes

- **Idempotence is the one property that could silently fail** and is explicitly tested twice: once at the unit level (`test_compute_delta_ignores_todays_own_entry_same_day_rerun`, `test_compute_streak_ignores_todays_own_entry`), once at the live end-to-end level (Task 3's two-runs-in-a-row check). Both must agree.
- **Collapse/changed semantics are fully specified in Global Constraints**, not left to task-time interpretation — every task's tests encode the exact same rule (news always shows full detail; price movement alone never triggers `▲` or blocks collapse).
- **No signature changes** anywhere — `history.py` is new, `main.py`'s `_collect_recs` gains internal steps but its return shape (`regime, recs, budget_summary`) is unchanged, `notify.format_recommendation` still takes one `rec` dict and returns one string. Every pre-existing caller and test is unaffected except where `format_recommendation`'s OWN tests must now supply `delta`/`trend_streak` keys (or omit them, and the guards degrade safely — Task 2 Step 6 explicitly checks this).
- **Deferred, confirmed out of scope:** Stage E (disclosures, `TECH["rsi_period"]` threading fix, CI test step running `python test_core.py`) and Stage F (scanner) are untouched.

## Verification (end-to-end, after all 3 tasks)

```bash
cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system"
python -m pytest test_core.py research/test_base_rate.py -v
python main.py digest    # run twice; second run's deltas/streaks must match the first exactly
```
