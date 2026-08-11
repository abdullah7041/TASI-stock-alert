# TASI Reliability Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make decisions and Discord output truthful, whole-card, deterministic, and testable before moving runtime state to managed infrastructure.

**Architecture:** Add pure quote-quality and event-key modules around the existing flat Python layout. Refactor Discord rendering into complete cards that are packed at card boundaries, while preserving webhook delivery as the sole network side effect. main.py consumes these pure interfaces but retains local JSON persistence until the managed-runtime plan replaces it.

**Tech Stack:** Python 3.12, pytest, pandas, requests, Discord webhook JSON.

## Global Constraints

- Preserve the broker/app as the only real-time stop/target safety path.
- Treat Yahoo and SAHMK Free quotes as delayed unless the provider explicitly marks them live.
- Never issue a decision from rejected or stale data.
- Use valid UTF-8 source text and ensure_ascii=False; no mojibake literals remain.
- Pack complete Discord cards below 1,800 characters; never substring raw output.
- Do not change the BUY rule or allocate forecast-driven budget.

---

## File structure

- Create: quality.py — quote observation and pure freshness/symbol validation.
- Create: events.py — crossing identity and rearming helpers.
- Modify: data.py — documented SAHMK single-quote endpoint and timestamps.
- Modify: notify.py — card rendering, stale-news filtering, UTF-8 text, semantic packing.
- Modify: main.py — validated holding monitoring.
- Modify: config.py, test_core.py, README.md.

### Task 1: Quote-quality contract

**Files:**
- Create: quality.py
- Modify: data.py:25-31, 89-127, 238-253
- Modify: config.py
- Test: test_core.py

**Interfaces:**
- Produces QuoteObservation(code, price, source, observed_at, received_at, delayed).
- Produces validate_quote(observation, expected_code, now, max_age_minutes) -> str | None.

- [ ] **Step 1: Write the failing tests**

~~~
from datetime import datetime, timedelta, timezone
from quality import QuoteObservation, validate_quote

def test_validate_quote_rejects_stale_delayed_observation():
    now = datetime(2026, 8, 2, 10, 20, tzinfo=timezone.utc)
    q = QuoteObservation("2320", 55.5, "sahmk", now - timedelta(minutes=21), now, True)
    assert validate_quote(q, "2320", now, 20) == "stale quote (21m old)"

def test_validate_quote_accepts_matching_fresh_quote():
    now = datetime(2026, 8, 2, 10, 20, tzinfo=timezone.utc)
    q = QuoteObservation("2320", 55.5, "sahmk", now - timedelta(minutes=4), now, True)
    assert validate_quote(q, "2320", now, 20) is None
~~~

- [ ] **Step 2: Run the focused test**

Run: python -m pytest test_core.py -k quote_quality -v

Expected: FAIL because quality.py does not exist.

- [ ] **Step 3: Implement the minimal contract**

~~~
@dataclass(frozen=True)
class QuoteObservation:
    code: str
    price: float
    source: str
    observed_at: datetime
    received_at: datetime
    delayed: bool

def validate_quote(q, expected_code, now, max_age_minutes):
    if q.code != str(expected_code): return "symbol mismatch"
    if not math.isfinite(q.price) or q.price <= 0: return "invalid price"
    if q.observed_at > now: return "future quote timestamp"
    age = (now - q.observed_at).total_seconds() / 60
    return None if age <= max_age_minutes else f"stale quote ({age:.0f}m old)"
~~~

Change SAHMK fallback to GET /quote/{code}/, parse updated_at and is_delayed, and set received_at immediately after parsing. If a provider timestamp is absent or malformed, return None rather than inventing a fresh quote. Add RUNTIME["max_quote_age_minutes"] = 20.

- [ ] **Step 4: Verify contract and provider shapes**

Run: python -m pytest test_core.py -k "quote_quality or sahmk_quote" -v

Expected: PASS for fresh, stale, mismatched, future, malformed, and delayed quotes.

- [ ] **Step 5: Commit**

~~~
git add quality.py data.py config.py test_core.py
git commit -m "feat: validate delayed quote observations"
~~~

### Task 2: Deterministic event identity and rearming

**Files:**
- Create: events.py
- Modify: config.py
- Test: test_core.py

**Interfaces:**
- Produces event_id_for(code, level_type, level_version, direction) -> str.
- Produces is_rearmed(price, level, direction, hysteresis_pct) -> bool.

- [ ] **Step 1: Write failing tests**

~~~
from events import event_id_for, is_rearmed

def test_event_id_changes_when_configured_level_changes():
    assert event_id_for("2320", "stop", "58.37", "down") != event_id_for("2320", "stop", "58.40", "down")

def test_downward_stop_rearms_only_after_buffer():
    assert not is_rearmed(58.40, 58.37, "down", 0.25)
    assert is_rearmed(58.60, 58.37, "down", 0.25)
~~~

- [ ] **Step 2: Run the focused test**

Run: python -m pytest test_core.py -k "event_id or rearm" -v

Expected: FAIL because events.py does not exist.

- [ ] **Step 3: Implement the deterministic domain**

~~~
def event_id_for(code, level_type, level_version, direction):
    raw = f"{code}:{level_type}:{level_version}:{direction}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

def is_rearmed(price, level, direction, hysteresis_pct):
    band = level * hysteresis_pct / 100
    if direction == "down": return price >= level + band
    if direction == "up": return price <= level - band
    raise ValueError(f"unsupported direction: {direction}")
~~~

Set RUNTIME["hysteresis_pct"] = 0.25.

- [ ] **Step 4: Verify the domain**

Run: python -m pytest test_core.py -k "event_id or rearm or trigger" -v

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add events.py config.py test_core.py
git commit -m "feat: add deterministic alert event keys"
~~~

### Task 3: Semantic Discord cards and delivery

**Files:**
- Modify: notify.py:13-250
- Modify: test_core.py:675-930
- Modify: README.md

**Interfaces:**
- Produces build_cards(recs, header, quote_note, budget) -> list[str].
- Produces pack_cards(cards, max_chars=1800) -> list[str].
- Changes send_discord(content: str | list[str], webhook_url=None) -> bool.

- [ ] **Step 1: Write failing rendering tests**

~~~
def test_pack_cards_never_splits_a_card_or_utf8_character():
    cards = ["**2320 Al-Babtain** — SELL", "**4015 Jamjoom** — WATCH"]
    assert nt.pack_cards(cards, max_chars=30) == cards

def test_recent_news_excludes_stale_headlines():
    rows = [{"title": "old", "published": "Tue, 26 Dec 2017 17:54:15 GMT"}]
    out = nt._fmt_news({"ok": True, "label": "neutral", "score": 0, "headlines": rows}, today=date(2026, 8, 2))
    assert out == ["   news: no recent headlines"]
~~~

- [ ] **Step 2: Run the focused test**

Run: python -m pytest test_core.py -k "pack_cards or recent_news" -v

Expected: FAIL because the helpers do not exist and stale news renders.

- [ ] **Step 3: Implement card-first rendering**

Replace invalid literals such as â€” and â–² with their valid UTF-8 characters. Parse RFC-2822 headline timestamps; retain only items no more than seven calendar days old. Implement pack_cards so cards are joined only whole; a single oversized card is truncated at a word boundary with … [truncated]. Keep build_message as a compatibility wrapper returning the joined cards.

- [ ] **Step 4: Implement bounded webhook retries and verify**

Retry only 429, 408, and 5xx responses, at most three attempts; honor numeric Retry-After for 429 and otherwise wait 1 then 2 seconds. Mock success, 429 recovery, 500 exhaustion, complete-card payloads, and UTF-8 text.

Run: python -m pytest test_core.py -k "notify or news or disclosures" -v

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add notify.py test_core.py README.md
git commit -m "fix: deliver complete UTF-8 Discord cards"
~~~

### Task 4: Wire validated delayed holding confirmation

**Files:**
- Modify: main.py:195-365
- Modify: config.py
- Modify: test_core.py

**Interfaces:**
- Produces collect_monitoring_events(now) -> tuple[list[dict], list[str]].
- Consumes data.get_quote, quality.validate_quote, and events.event_id_for.

- [ ] **Step 1: Write a failing monitoring test**

~~~
def test_monitoring_skips_stale_quote_and_returns_health_reason(monkeypatch):
    monkeypatch.setattr(m.dat, "get_quote", lambda code: stale_quote(code))
    events, health = m.collect_monitoring_events(fixed_now())
    assert events == []
    assert health == ["2320: stale quote (21m old)"]
~~~

- [ ] **Step 2: Run the test**

Run: python -m pytest test_core.py -k monitoring_skips_stale -v

Expected: FAIL because collect_monitoring_events does not exist.

- [ ] **Step 3: Implement the holding-only path**

Set RUNTIME["monitor_interval_minutes"] = 10. Fetch only cfg.HOLDINGS, validate every observation, evaluate stop/trim/target levels, and return health reasons separately. Do not call evaluate_watchlist, scanner, RSI, or momentum in this path.

- [ ] **Step 4: Verify all affected behavior**

Run: python -m pytest test_core.py research/test_base_rate.py -v

Run: python -m py_compile main.py data.py quality.py events.py notify.py

Run: git diff --check

Expected: all commands succeed.

- [ ] **Step 5: Commit**

~~~
git add main.py config.py test_core.py
git commit -m "feat: validate delayed holding confirmations"
~~~
