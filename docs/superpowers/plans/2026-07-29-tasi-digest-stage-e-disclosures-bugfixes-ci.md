# TASI Digest Stage E — Disclosures + Real Bug Fixes + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four independent, previously-identified gaps, per the master design doc's Stage E: (1) a new `disclosures.py` surfacing official Tadawul company announcements — higher signal than scraped news; (2) fix `TECH["rsi_period"]` being configured but silently ignored everywhere RSI is computed; (3) make `RISK["max_positions"]` (defined, never read) actually cap concurrent positions; (4) run the test suite in CI, which has never happened despite 137+ tests existing.

**Spike already done (this session, before writing this plan):** fetched `https://www.argaam.com/en/rss/ho-company-disclosures?sectionid=244` directly — confirmed live, valid RSS 2.0 XML, aggregates official announcements across ALL Tadawul-listed companies in one feed (not per-company), with company name identifiable in each item's title (e.g. "Al Rasheed upsides SAB facilities by SAR 100M"). No Google-News-fallback needed — the primary source holds up. Existing `news._fetch_rss(url, limit)` already generically parses any RSS 2.0 feed and is reused as-is, not reimplemented.

**Tech Stack:** Python 3, pytest, existing project conventions.

## Global Constraints

- **`disclosures.py` fetches the aggregate feed ONCE per digest run, then filters per name.** The feed is not per-company, so fetching it once and matching locally (substring match on company name in each item's title, same idiom `news.py` already uses for its own headline scoring) avoids hitting Argaam once per watchlist/holding name. `fetch_all()` is the only network-touching function; `match_company()` is pure and fully unit-testable offline with fixture item lists — same untested-network / tested-pure split `news.py` already has (`_fetch_rss`/`get_news` are not directly unit tested; `score_headlines`/`_headline_matches` are). Do not add per-name network calls.
- **Disclosures fail soft**, exactly like news: a fetch failure produces `ok=False` for every name (not a crash, not a silently-empty result indistinguishable from "nothing new"). Rendered as `disclosures: fetch failed` — distinct from `disclosures: none found`, mirroring `_fmt_news`'s existing three-way distinction (failure / empty / real content).
- **Disclosures apply to BOTH holdings and watchlist**, matching how Stage A extended news to both — an official filing matters at least as much for something you already own.
- **A disclosure item, like a news headline, is never collapsed away.** Stage D's one-line collapse for unchanged/news-free names must also check for disclosure items — a fresh official filing is exactly the kind of new information the whole system exists to surface, the same reasoning that already exempts news headlines from collapse.
- **`rsi_period` must be threaded consistently everywhere RSI is computed for a rec**, including `triggers.py`'s RSI inversion (Stage C's `RSI_PERIOD` module constant was an explicit placeholder for this exact fix — see `triggers.py`'s own comment: *"When that's fixed, this constant must be threaded the same way, in the same change"*). `compute_triggers` gains an explicit `rsi_period` parameter; the module constant is removed, not left dangling.
- **`max_positions` counts existing holdings + this run's newly-qualifying BUYs together**, not just new BUYs in isolation — `RISK["max_positions"]` is documented in `config.py` as "max concurrent open names," and a name you already hold already occupies a position. Truncated (over-cap) BUY candidates get a `sizing.skip` reason, following the exact pattern already used for budget-exhausted candidates — never silently dropped from the digest (they still render as WATCH/BUY-qualified with a stated reason they weren't sized).
- **CI runs the exact same test command every task in this project has used locally**: `python -m pytest test_core.py research/test_base_rate.py -v`. Do not invent a different invocation.
- **Fix the missing `history.json` in the workflow's "Commit state" step while touching that file for the test step anyway** — found during this stage's grounding: `.github/workflows/tasi.yml`'s `git add` line lists `state.json levels.json symbols.json news_archive.jsonl` but omits `history.json` (Stage D's file), meaning CI never persists day-over-day history across scheduled runs today. Same class of gap as Stage 0/A's original `news_archive.jsonl` omission — fix it in the same commit as the test-step addition since it's the same file, not a separate task.
- Stage F (scanner) is untouched — gated on Stage 0's base-rate findings, which have not been reviewed as part of this stage.

---

## File Structure

| File | Change |
|---|---|
| `indicators.py` | `short_term_read`/`long_term_read` gain an `rsi_period` parameter, threaded through to `rsi()` |
| `analyze.py` | Pass `tech["rsi_period"]` through; `allocate_budget` enforces `max_positions`; `evaluate_holding`/`evaluate_watchlist` gain a `disclosures` parameter + `disclosures_summary` shaping helper |
| `triggers.py` | `compute_triggers` gains an `rsi_period` parameter; `RSI_PERIOD` module constant removed |
| `disclosures.py` | **New** — `fetch_all`, `match_company` |
| `main.py` | Pass `cfg.TECH["rsi_period"]` implicitly via `tech`; wire `max_positions`/`current_positions` into `allocate_budget`; fetch disclosures once per run, attach per rec |
| `notify.py` | `_fmt_disclosures`; collapse gating extended to disclosure items |
| `.github/workflows/tasi.yml` | Add a test-run step; fix missing `history.json` in the commit step |
| `test_core.py` | New/updated tests for all of the above |
| `README.md` | New section on disclosures; note on `max_positions` enforcement |

---

## Task 1: Thread `rsi_period` everywhere RSI is computed

**Files:**
- Modify: `indicators.py` (`short_term_read`, `long_term_read`)
- Modify: `analyze.py` (`evaluate_holding`, `evaluate_watchlist` — the two call sites)
- Modify: `triggers.py` (`compute_triggers`, remove `RSI_PERIOD`)
- Test: `test_core.py` (update the 2 existing `compute_triggers` tests' call signature; add 2 new tests proving the period actually threads through)

**Interfaces:**
- `indicators.short_term_read(df, lookback, short_ma, rsi_period: int = 14) -> dict` — default preserves current behavior for any caller not yet updated.
- `indicators.long_term_read(df, lookback, short_ma, long_ma, rsi_period: int = 14) -> dict` — same default-preserving contract.
- `triggers.compute_triggers(df, rules, horizon_cfg, criteria, rsi_period: int) -> list` — no default; every caller in this codebase has a `tech` dict in scope, so a bare default would just hide the exact bug this task fixes.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py` (near the existing RSI/indicator tests):

```python
def test_short_term_read_honors_configured_rsi_period():
    df = _frame(list(range(1, 60)))
    default = ind.short_term_read(df, 10, 20)
    custom = ind.short_term_read(df, 10, 20, rsi_period=7)
    assert default["rsi"] != custom["rsi"]  # different smoothing window -> different value

def test_long_term_read_honors_configured_rsi_period():
    df = _frame(list(range(1, 160)))
    default = ind.long_term_read(df, 120, 20, 50)
    custom = ind.long_term_read(df, 120, 20, 50, rsi_period=7)
    assert default["rsi"] != custom["rsi"]
```

Update the 2 existing `compute_triggers` tests (search `test_compute_triggers_only_for_failing_rules` and `test_compute_triggers_empty_when_all_rules_pass`) to pass a 5th argument, `14`, matching the codebase's existing default RSI period:

```python
result = trig.compute_triggers(df, rules, horizon_cfg, criteria, 14)
```
and
```python
assert trig.compute_triggers(df, rules, horizon_cfg, criteria, 14) == []
```

Add one new test proving `compute_triggers` actually uses the passed period, not a hardcoded one:

```python
def test_compute_triggers_uses_passed_rsi_period_not_hardcoded():
    rules = [{"rule": "rsi_band", "passed": False, "actual": 15.0,
             "required": "25-60", "plain": "x"}]
    df = _frame([20 - i * 0.15 for i in range(30)])
    horizon_cfg = {"long_lookback_days": 120, "short_ma": 20, "long_ma": 50}
    criteria = {"rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
    trigger_14 = trig.compute_triggers(df, rules, horizon_cfg, criteria, 14)[0]
    trigger_7 = trig.compute_triggers(df, rules, horizon_cfg, criteria, 7)[0]
    assert trigger_14["trigger_price"] != trigger_7["trigger_price"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "rsi_period" -v`
Expected: FAIL — `short_term_read`/`long_term_read` don't accept `rsi_period` yet; `compute_triggers`'s call sites in the updated tests fail on arg count.

- [ ] **Step 3: Update `indicators.py`**

Change `short_term_read` (currently reads `rsi(closes)` with no period):
```python
def short_term_read(df: pd.DataFrame, lookback: int, short_ma: int, rsi_period: int = 14) -> dict:
    """Short-horizon momentum read."""
    closes = df["Close"]
    return {
        "horizon": "short",
        "momentum_pct": round(pct_change(closes, lookback), 2),
        "rsi": round(rsi(closes, rsi_period), 1),
        "above_ma": bool(float(closes.iloc[-1]) > sma(closes, short_ma))
        if not np.isnan(sma(closes, short_ma)) else None,
    }
```

Change `long_term_read` the same way:
```python
def long_term_read(df: pd.DataFrame, lookback: int, short_ma: int, long_ma: int,
                   rsi_period: int = 14) -> dict:
    """Long-horizon swing read. This is the more reliable one on daily data."""
    closes = df["Close"]
    return {
        "horizon": "long",
        "trend": trend(closes, short_ma, long_ma),
        "momentum_pct": round(pct_change(closes, lookback), 2),
        "rsi": round(rsi(closes, rsi_period), 1),
    }
```

- [ ] **Step 4: Update `analyze.py`'s two call sites**

In `evaluate_holding`, change:
```python
    short = ind.short_term_read(df, horizon_cfg["short_lookback_days"], horizon_cfg["short_ma"])
    long = ind.long_term_read(df, horizon_cfg["long_lookback_days"],
                              horizon_cfg["short_ma"], horizon_cfg["long_ma"])
```
to:
```python
    short = ind.short_term_read(df, horizon_cfg["short_lookback_days"], horizon_cfg["short_ma"],
                                tech["rsi_period"])
    long = ind.long_term_read(df, horizon_cfg["long_lookback_days"],
                              horizon_cfg["short_ma"], horizon_cfg["long_ma"], tech["rsi_period"])
```

In `evaluate_watchlist`, change the equivalent two lines (search for the identical pattern — `evaluate_watchlist` calls the same two functions with the same argument shape) the same way, using the `tech` parameter already in scope for that function.

- [ ] **Step 5: Update `triggers.py`**

Remove the module constant near the top:
```python
# DELETE this line and its surrounding comment block:
RSI_PERIOD = 14
```

Change `compute_triggers`'s signature and body:
```python
def compute_triggers(df, rules: list, horizon_cfg: dict, criteria: dict, rsi_period: int) -> list:
    """For every FAILING rule in `rules` (analyze.buy_decision's output),
    compute its trigger price. Passed rules produce nothing — there is
    nothing to flip. `rsi_period` must match whatever period actually
    produced the "current RSI" the rule dict reports (analyze.py threads
    tech["rsi_period"] through to indicators.long_term_read AND here, in the
    same change, so the two never disagree about what RSI means)."""
    closes = df["Close"]
    out = []
    for r in rules:
        if r["passed"]:
            continue
        if r["rule"] == "momentum_floor":
            out.append(momentum_trigger(closes, horizon_cfg["long_lookback_days"],
                                        criteria["long_mom_floor_pct"]))
        elif r["rule"] == "rsi_band":
            lo, hi = criteria["rsi_recovery_band"]
            out.append(rsi_trigger(closes, rsi_period, lo, hi))
        elif r["rule"] == "trend":
            out.append(trend_trigger(closes, horizon_cfg["short_ma"],
                                     horizon_cfg["long_ma"]))
    return out
```

Update `analyze.py`'s `evaluate_watchlist`, the single call site:
```python
    triggers = trig.compute_triggers(df, rules, horizon_cfg, criteria, tech["rsi_period"])
```

- [ ] **Step 6: Run the new/updated tests**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "rsi_period or compute_triggers" -v`
Expected: all PASS.

- [ ] **Step 7: Run the FULL suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass (139 baseline + 5 new/updated = check the exact count from your own run and report it precisely).

- [ ] **Step 8: Commit**

```bash
git add indicators.py analyze.py triggers.py test_core.py
git commit -m "Thread TECH[rsi_period] through indicators and triggers instead of hardcoding 14"
```

---

## Task 2: Enforce `RISK["max_positions"]` in `allocate_budget`

**Files:**
- Modify: `analyze.py` (`allocate_budget`)
- Modify: `main.py` (`_collect_recs`'s call site)
- Test: `test_core.py`

**Interfaces:**
- `analyze.allocate_budget(buys: list, budget_sar: float, current_positions: int = 0, max_positions: int | None = None) -> dict` — both new params default to "no cap" (`0`/`None`), so any caller not yet updated keeps today's behavior exactly.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py`, near the existing `allocate_budget` tests:

```python
def test_allocate_budget_caps_at_max_positions_counting_existing_holdings():
    buys = [{"code": "A", "price": 10.0}, {"code": "B", "price": 10.0},
           {"code": "C", "price": 10.0}]
    az.allocate_budget(buys, 10000.0, current_positions=3, max_positions=4)
    sized = [b for b in buys if b["sizing"]["shares"] > 0]
    skipped = [b for b in buys if b["sizing"]["shares"] == 0]
    assert len(sized) == 1  # only 1 slot left (4 - 3 already held)
    assert len(skipped) == 2
    assert "max_positions" in skipped[0]["sizing"]["skip"]

def test_allocate_budget_no_cap_when_max_positions_is_none():
    buys = [{"code": "A", "price": 10.0}, {"code": "B", "price": 10.0}]
    az.allocate_budget(buys, 10000.0, current_positions=10, max_positions=None)
    assert all(b["sizing"]["shares"] > 0 for b in buys)  # unaffected, as before this task

def test_allocate_budget_zero_capacity_skips_all_new_buys():
    buys = [{"code": "A", "price": 10.0}]
    az.allocate_budget(buys, 10000.0, current_positions=5, max_positions=5)
    assert buys[0]["sizing"]["shares"] == 0
    assert "max_positions" in buys[0]["sizing"]["skip"]

def test_allocate_budget_weight_pct_reflects_capped_count_not_original():
    # 3 buys but only capacity for 2 -- the 2 that fit should be weighted as
    # if there were 2 qualifying names, not 3 (the cap changes what "equal
    # weight" means, since the 3rd was never really in contention).
    buys = [{"code": "A", "price": 10.0}, {"code": "B", "price": 10.0},
           {"code": "C", "price": 10.0}]
    az.allocate_budget(buys, 10000.0, current_positions=0, max_positions=2)
    assert buys[0]["sizing"]["weight_pct"] == 50.0
    assert buys[1]["sizing"]["weight_pct"] == 50.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "max_positions" -v`
Expected: FAIL — `allocate_budget` doesn't accept the new keyword arguments yet.

- [ ] **Step 3: Update `allocate_budget`**

Replace the function's signature and add the capacity-truncation step before the existing equal-weight loop:

```python
def allocate_budget(buys: list, budget_sar: float,
                    current_positions: int = 0, max_positions: int | None = None) -> dict:
    """Split the remaining monthly budget EQUALLY across BUY recs. Mutates each
    rec's 'sizing' in place; returns a summary.

    Rules (transparent, in order):
      - max_positions cap (if set): current_positions (names already held)
        plus this run's newly-qualifying buys may not exceed max_positions.
        Buys beyond capacity get sizing={shares:0, skip:"..."} and are
        excluded from the equal-weight split below -- RISK["max_positions"]
        is documented as "max concurrent open names," and a name you already
        hold already occupies one of those slots.
      - Equal weight: every remaining qualifying name targets the same slice,
        processed in the order given. This used to be weighted by
        conviction — which backtested inverted against forward return, so
        weighting toward it was weighting toward worse outcomes
        (docs/backtest-findings-2026-07-23.md). With conviction gone there is
        nothing left to rank on, and pretending otherwise would be inventing
        a ranking.
      - Each gets slice = budget / len(buys), rounded DOWN to whole shares
        (Tadawul does not allow fractions).
      - If the slice affords 0 shares but 1 share fits what is left of the
        budget, it gets 1 share.
      - Unspent remainder of a slice rolls to the next candidate via the
        running 'remaining' amount; whatever is left at the end stays cash.
      - Hard invariant: total spend <= budget_sar.
    """
    summary = {"budget": round(budget_sar, 2), "allocated": 0.0,
               "leftover": round(budget_sar, 2)}

    if max_positions is not None:
        capacity = max(0, max_positions - current_positions)
        if len(buys) > capacity:
            over_cap = buys[capacity:]
            buys = buys[:capacity]
            for r in over_cap:
                r["sizing"] = {
                    "shares": 0, "spend": 0.0,
                    "skip": f"max_positions cap ({max_positions}) reached "
                            f"({current_positions} already held + {capacity} newly allocated this run)",
                }

    if not buys or budget_sar <= 0:
        for r in buys:
            r["sizing"] = {"shares": 0, "spend": 0.0, "skip": "monthly budget exhausted"}
        return summary

    n = len(buys)
    equal_slice = budget_sar / n
    remaining = budget_sar

    for r in buys:
        price = r["price"]
        slice_sar = min(equal_slice, remaining)
        shares = int(slice_sar // price) if price > 0 else 0
        if shares == 0 and 0 < price <= remaining:
            shares = 1  # min viable lot for a qualified name, if budget allows.
        spend = shares * price
        if spend > remaining:                    # never breach the cap.
            shares = int(remaining // price) if price > 0 else 0
            spend = shares * price
        if shares == 0:
            r["sizing"] = {"shares": 0, "spend": 0.0,
                           "skip": f"1 share ({price:.2f}) exceeds remaining budget ({remaining:.2f})"}
            continue
        remaining -= spend
        r["sizing"] = {
            "shares": shares,
            "spend": round(spend, 2),
            "weight_pct": round(100.0 / n, 1),
            "budget_left_after": round(remaining, 2),
        }

    summary["allocated"] = round(budget_sar - remaining, 2)
    summary["leftover"] = round(remaining, 2)
    return summary
```

- [ ] **Step 4: Wire `main.py`'s call site**

In `_collect_recs`, find:
```python
    budget_summary = az.allocate_budget(buys, _budget_remaining())
```
Change to:
```python
    budget_summary = az.allocate_budget(buys, _budget_remaining(),
                                        current_positions=len(cfg.HOLDINGS),
                                        max_positions=cfg.RISK["max_positions"])
```

- [ ] **Step 5: Run the new tests**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "max_positions" -v`
Expected: all 4 PASS.

- [ ] **Step 6: Run the FULL suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass, including every PRE-EXISTING `allocate_budget` test (they call it without the two new kwargs — confirm the defaults truly reproduce old behavior exactly, unchanged).

- [ ] **Step 7: Commit**

```bash
git add analyze.py main.py test_core.py
git commit -m "Enforce RISK[max_positions] in allocate_budget instead of leaving it dead config"
```

---

## Task 3: `disclosures.py` — fetch once, filter per name

**Files:**
- Create: `disclosures.py`
- Test: `test_core.py`

**Interfaces:**
- `fetch_all(limit: int = 200) -> tuple[list, bool]` — the only network-touching function. Returns `([], False)` on any failure, never raises.
- `match_company(all_items: list, ok: bool, company_name: str) -> DisclosureResult` — pure, no I/O.
- `DisclosureResult` dataclass: `items: list` (each `{title, link, published}`, same shape `news.py` already uses), `ok: bool`.

- [ ] **Step 1: Write the failing tests**

```python
import disclosures as discl

def test_match_company_filters_by_name_substring():
    items = [
        {"title": "Al Rasheed upsides SAB facilities by SAR 100M", "link": "x", "published": "Mon"},
        {"title": "MIS awarded SAR 179.8M project by KSMC", "link": "y", "published": "Tue"},
        {"title": "Jamjoom Pharma board recommends dividend", "link": "z", "published": "Wed"},
    ]
    result = discl.match_company(items, True, "Jamjoom Pharma")
    assert len(result.items) == 1
    assert result.items[0]["title"] == "Jamjoom Pharma board recommends dividend"
    assert result.ok is True

def test_match_company_case_insensitive():
    items = [{"title": "jamjoom pharma reports Q2 profit", "link": "x", "published": "Mon"}]
    result = discl.match_company(items, True, "Jamjoom Pharma")
    assert len(result.items) == 1

def test_match_company_no_matches_is_empty_not_failed():
    items = [{"title": "Some Other Co announces something", "link": "x", "published": "Mon"}]
    result = discl.match_company(items, True, "Jamjoom Pharma")
    assert result.items == []
    assert result.ok is True  # the FEED fetch succeeded; this name just has no hits

def test_match_company_propagates_fetch_failure():
    result = discl.match_company([], False, "Jamjoom Pharma")
    assert result.items == []
    assert result.ok is False

def test_fetch_all_never_raises_on_bad_url(monkeypatch):
    # Simulate a network failure without hitting the real network.
    import news as newsmod
    def _boom(*a, **k):
        raise ConnectionError("simulated failure")
    monkeypatch.setattr(newsmod, "_fetch_rss", _boom)
    items, ok = discl.fetch_all()
    assert items == []
    assert ok is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "match_company or fetch_all" -v`
Expected: FAIL — `disclosures` module does not exist.

- [ ] **Step 3: Write `disclosures.py`**

```python
"""
Tadawul disclosures: official company announcements (earnings, dividends,
capital increases, board recommendations) via Argaam's aggregate disclosures
RSS feed -- higher signal than news.py's Google News scrape, since these are
the company's own regulatory filings, not press coverage.

Spike (done before this module was written): fetched
https://www.argaam.com/en/rss/ho-company-disclosures?sectionid=244 directly
and confirmed it is live, valid RSS 2.0 XML, and aggregates announcements
across ALL Tadawul-listed companies in one feed -- not per-company -- with
the company name identifiable in each item's title. No fallback source is
needed; this primary source held up.

Because the feed is aggregate, not per-company, it is fetched ONCE per
digest run (fetch_all) and filtered locally per watchlist/holding name
(match_company) -- fetching once and filtering N ways, rather than N
network calls for N names. match_company is pure and fully testable
offline; fetch_all is not directly unit tested, matching news.py's own
convention (its network-touching _fetch_rss/get_news aren't unit tested
either -- only the pure scoring functions are).

Fails soft: a fetch failure makes every name's result ok=False, never
crashes the digest.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import news as newsmod  # reuse _fetch_rss -- one RSS parser, not two.

DISCLOSURES_RSS = "https://www.argaam.com/en/rss/ho-company-disclosures?sectionid=244"


@dataclass
class DisclosureResult:
    items: list = field(default_factory=list)   # [{title, link, published}, ...]
    ok: bool = True


def fetch_all(limit: int = 200) -> tuple[list, bool]:
    """One network fetch of the aggregate disclosures feed. Never raises --
    returns ([], False) on any failure so every subsequent per-name filter
    (match_company) degrades to ok=False without a second network attempt."""
    try:
        items = newsmod._fetch_rss(DISCLOSURES_RSS, limit)
        return items, True
    except Exception:
        return [], False


def match_company(all_items: list, ok: bool, company_name: str) -> DisclosureResult:
    """Which of the already-fetched items mention this company. `ok` carries
    through from fetch_all: a feed-level failure means every name's result
    is ok=False, distinct from a real fetch that simply found nothing for
    this particular name."""
    if not ok:
        return DisclosureResult(items=[], ok=False)
    low_name = company_name.lower()
    matches = [it for it in all_items if low_name in it.get("title", "").lower()]
    return DisclosureResult(items=matches, ok=True)
```

- [ ] **Step 4: Run the new tests**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "match_company or fetch_all" -v`
Expected: all 5 PASS.

- [ ] **Step 5: Run the FULL suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add disclosures.py test_core.py
git commit -m "Add disclosures.py: fetch Tadawul's aggregate disclosures feed once, filter per name"
```

---

## Task 4: Wire disclosures into `analyze.py` + `main.py` + `notify.py` (bundled)

Bundled for the same reason prior stages' equivalent tasks were: a `disclosures` field nobody renders, or rendered but never populated, is dead/invisible work either way.

**Files:**
- Modify: `analyze.py` (`evaluate_holding`, `evaluate_watchlist`, new `disclosures_summary` helper)
- Modify: `main.py` (`_collect_recs`)
- Modify: `notify.py` (`format_recommendation`, new `_fmt_disclosures`)
- Test: `test_core.py`

**Interfaces:**
- `analyze.disclosures_summary(disclosures) -> dict | None` — shapes a `disclosures.DisclosureResult` into the dict `notify.py` renders, mirroring `news_summary`'s existing role exactly.
- `evaluate_holding(..., disclosures=None)` / `evaluate_watchlist(..., disclosures=None)` — additive parameter, default `None`, no existing caller breaks.
- `notify._fmt_disclosures(disclosures: dict) -> list` — three-way render mirroring `_fmt_news`: fetch failed / none found / real items.

- [ ] **Step 1: Write the failing tests**

```python
def test_disclosures_summary_none_when_no_disclosures():
    assert az.disclosures_summary(None) is None

def test_disclosures_summary_shapes_result():
    d = discl.DisclosureResult(items=[{"title": "x", "link": "y", "published": "z"}], ok=True)
    s = az.disclosures_summary(d)
    assert s == {"ok": True, "items": [{"title": "x", "link": "y", "published": "z"}]}

def test_evaluate_holding_attaches_disclosures():
    df = _frame(list(range(1, 60)))
    d = discl.DisclosureResult(items=[{"title": "EIC dividend announced", "link": "x", "published": "Mon"}], ok=True)
    rec = az.evaluate_holding({"code": "1303", "name": "EIC", "shares": 10, "avg_cost": 10.0},
                              price=12.0, df=df, levels={}, horizon_cfg=_WL_HORIZON,
                              tech=_WL_TECH, disclosures=d)
    assert rec["disclosures"]["ok"] is True
    assert len(rec["disclosures"]["items"]) == 1

def test_evaluate_watchlist_disclosures_defaults_to_none():
    df = _frame(list(range(1, 160)))
    rec = az.evaluate_watchlist({"code": "4015", "name": "Jamjoom"}, price=100.0, df=df,
                                levels={}, risk=BASE_RISK, horizon_cfg=_WL_HORIZON, tech=_WL_TECH)
    assert rec["disclosures"] is None

def test_format_disclosures_fetch_failed_renders_distinctly():
    block = nt._fmt_disclosures({"ok": False, "items": []})
    assert block == ["   disclosures: fetch failed"]

def test_format_disclosures_empty_renders_distinctly_from_failure():
    block = nt._fmt_disclosures({"ok": True, "items": []})
    assert block == ["   disclosures: none found"]

def test_format_disclosures_shows_items():
    block = nt._fmt_disclosures({"ok": True, "items": [
        {"title": "Jamjoom board recommends dividend", "link": "x", "published": "Mon"}]})
    assert any("Jamjoom board recommends dividend" in line for line in block)

def test_format_recommendation_does_not_collapse_when_disclosures_present():
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.09,
           "action": "HOLD", "reason": [], "unrealized_pct": 21.6,
           "delta": {"price_pct": 0.4, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 11, "started": "2026-07-17"},
           "disclosures": {"ok": True, "items": [{"title": "EIC dividend announced",
                           "link": "x", "published": "Mon"}]},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "EIC dividend announced" in block
    assert "short:" in block  # full detail shown, not collapsed
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "disclosures" -v`
Expected: FAIL.

- [ ] **Step 3: Add `disclosures_summary` and wire `evaluate_holding`/`evaluate_watchlist` in `analyze.py`**

Add `import disclosures as discl` to the top-level imports (alongside `import triggers as trig`).

Add right after `news_summary`:
```python
def disclosures_summary(disclosures) -> dict | None:
    """Shape a disclosures.DisclosureResult into the dict notify.py renders.
    Mirrors news_summary exactly -- same reasoning: a fetch failure and a
    genuinely empty result must render identically regardless of which
    evaluation path found the name."""
    if disclosures is None:
        return None
    return {"ok": disclosures.ok, "items": disclosures.items}
```

Change `evaluate_holding`'s signature and final line:
```python
def evaluate_holding(holding: dict, price: float, df: pd.DataFrame, levels: dict,
                     horizon_cfg: dict, tech: dict, news=None, disclosures=None) -> dict:
    ...
    return {
        ...
        "news": news_summary(news),
        "disclosures": disclosures_summary(disclosures),
    }
```

Change `evaluate_watchlist`'s signature and add the line after `out["news"] = news_summary(news)`:
```python
def evaluate_watchlist(item: dict, price: float, df: pd.DataFrame, levels: dict,
                       risk: dict, horizon_cfg: dict, tech: dict,
                       news=None, buy_criteria: dict | None = None, disclosures=None) -> dict:
    ...
    out["news"] = news_summary(news)
    out["disclosures"] = disclosures_summary(disclosures)
    return out
```

- [ ] **Step 4: Wire `main.py`**

Add `import disclosures as discl` to the top-level imports.

In `_collect_recs`, after the existing `news_by_code = {}` block (the `if include_news:` block that fetches news), add an unconditional disclosures fetch (disclosures are official filings, not gated by `include_news` the way news is — always worth fetching):
```python
    all_disclosures, disclosures_ok = discl.fetch_all()
```

In the `for h in cfg.HOLDINGS:` loop, change the `evaluate_holding` call to pass the matched result:
```python
        disc = discl.match_company(all_disclosures, disclosures_ok, h["name"])
        rec = az.evaluate_holding(h, price, df, _levels_for(h["code"], stored_levels),
                                  cfg.HORIZON, cfg.TECH, news_by_code.get(h["code"]), disc)
```

In the `for w in cfg.WATCHLIST:` loop, change the `evaluate_watchlist` call similarly:
```python
        disc = discl.match_company(all_disclosures, disclosures_ok, w["name"])
        rec = az.evaluate_watchlist(w, price, df, _levels_for(w["code"], stored_levels),
                                    cfg.RISK, cfg.HORIZON, cfg.TECH,
                                    news_by_code.get(w["code"]), cfg.BUY_CRITERIA, disc)
```

- [ ] **Step 5: Render in `notify.py`**

Add `_fmt_disclosures` right after `_fmt_news`:
```python
def _fmt_disclosures(disclosures: dict) -> list:
    """Same three-way distinction as _fmt_news: a failed fetch, a fetch that
    found nothing for this name, and a fetch with real matches."""
    if disclosures.get("ok") is False:
        return ["   disclosures: fetch failed"]
    items = disclosures.get("items") or []
    if not items:
        return ["   disclosures: none found"]
    lines = [f"   disclosures: {len(items)} recent"]
    for it in items[:2]:
        lines.append(f"      \"{it.get('title', '')}\" — {it.get('published', '')}")
    return lines
```

In `format_recommendation`, add a `disclosure_items` check alongside the existing `news_headlines` one, and extend `collapse`:
```python
    news_headlines = bool((rec.get("news") or {}).get("headlines"))
    disclosure_items = bool((rec.get("disclosures") or {}).get("items"))
    collapse = (delta is not None) and (not changed) and (not news_headlines) \
        and (not disclosure_items) and (rec["action"] in ("HOLD", "WATCH"))
```

In the non-collapsed rendering path, right after the existing `if rec.get("news"): lines.extend(_fmt_news(rec["news"]))` block, add:
```python
    if rec.get("disclosures"):
        lines.extend(_fmt_disclosures(rec["disclosures"]))
```

- [ ] **Step 6: Run the new tests**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "disclosures" -v`
Expected: all PASS.

- [ ] **Step 7: Run the FULL suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass. Every PRE-EXISTING `evaluate_holding`/`evaluate_watchlist`/`format_recommendation` test (from Stages A-D) must still pass UNCHANGED — `disclosures=None` is the default everywhere, and `rec.get("disclosures")` degrades to `None`/falsy in `notify.py`, same additive pattern Stage C/D already established for `triggers`/`delta`.

- [ ] **Step 8: Commit**

```bash
git add analyze.py main.py notify.py test_core.py
git commit -m "Wire Tadawul disclosures into holdings, watchlist, and the digest"
```

---

## Task 5: CI test step + `history.json` fix + docs + live verification

**Files:**
- Modify: `.github/workflows/tasi.yml`
- Modify: `README.md`
- No new tests — this task verifies the branch as a whole and fixes CI config (not Python, not pytest-covered).

- [ ] **Step 1: Add a test-run step to the workflow**

In `.github/workflows/tasi.yml`, add a new step right after `- run: pip install -r requirements.txt` and before `- name: Pick mode`:
```yaml
      - name: Run tests
        run: python -m pytest test_core.py research/test_base_rate.py -v
```

- [ ] **Step 2: Fix the missing `history.json` in the commit-state step**

Find the `git add state.json levels.json symbols.json news_archive.jsonl 2>/dev/null || true` line and add `history.json`:
```yaml
          git add state.json levels.json symbols.json news_archive.jsonl history.json 2>/dev/null || true
```

- [ ] **Step 3: Add a README section**

Add right after the "Day-over-day deltas and streaks" section Stage D added:
```markdown
## Tadawul disclosures

Every name — holding or watchlist — is checked against Argaam's aggregate
Tadawul disclosures feed (official company announcements: earnings,
dividends, capital increases, board recommendations), fetched once per
digest run and matched locally by company name. This is a higher-signal
source than the news headlines Stage A added — these are the company's own
regulatory filings, not press coverage. Same honesty rule as news: a feed
outage renders `disclosures: fetch failed`, distinct from `disclosures: none
found` for a real fetch that had nothing for that name.

## `max_positions` is now enforced

`RISK["max_positions"]` used to be configured and silently ignored. It now
caps concurrent open names: existing holdings plus this run's newly-qualifying
BUYs cannot exceed it. A BUY that would push past the cap still appears in
the digest with its rules and trigger — it is just not sized, with a stated
reason (`size: none — max_positions cap (5) reached ...`), the same pattern
already used when a name's price exceeds what's left of the monthly budget.
```

- [ ] **Step 4: Run the full suite**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass, 0 failures.

- [ ] **Step 5: Manual end-to-end check**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python main.py digest`

Capture the full output. Inspect honestly: does at least one name show a `disclosures:` line (either real items, "none found", or "fetch failed" — Argaam's feed may or may not have a current item matching any of this project's specific watchlist/holding names on a given day, that's fine and expected, report exactly what you see)? Does the RSI value shown match what `TECH["rsi_period"]` (14, unchanged in `config.py`) would produce — i.e., nothing should look different from before this stage for the default period, since 14 was already the effective value; this task is proving the plumbing is no longer hardcoded, not changing today's numbers. If `RISK["max_positions"]` (5) combined with `len(cfg.HOLDINGS)` (3) and any qualifying BUYs happens to exceed 5 today, confirm the "max_positions cap" skip reason renders correctly — if no BUY fires today, this specific check is inconclusive from live data (fine, it's covered by Task 2's unit tests).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/tasi.yml README.md
git commit -m "Run tests in CI, fix missing history.json commit, document Stage E"
```

---

## Self-Review Notes

- **Spec coverage:** rsi_period threading through indicators.py/analyze.py/triggers.py (Task 1), max_positions enforcement (Task 2), disclosures.py fetch-once-filter-many (Task 3), full wiring + rendering (Task 4), CI + docs + live check (Task 5).
- **The disclosures spike was done BEFORE writing this plan**, not deferred to task time — the feed URL, its validity, and its per-item shape (title/link/pubDate, company name in title) were confirmed live via a direct fetch. No fallback-source task is needed because the primary source held up.
- **All three signature changes (`short_term_read`, `long_term_read`, `evaluate_holding`, `evaluate_watchlist`) are additive or covered exactly**: the two `indicators.py` functions get a defaulted new parameter (no caller breaks); `evaluate_holding`/`evaluate_watchlist` get a defaulted new parameter the same way. `triggers.compute_triggers` is the one genuinely breaking signature change in this plan (new required `rsi_period` param, no default) — deliberate, since a defaulted value would silently reintroduce the exact bug Stage C's own code comment flagged for this fix; its one production call site and two existing tests are updated in the same task (Task 1) that makes the change, so nothing is left broken mid-plan.
- **No task ends red**: every task's own new tests plus the full suite are run before commit.
- **Deferred, confirmed out of scope:** Stage F (scanner) — gated on a review of Stage 0's `research/base_rate.py` findings that hasn't happened yet, not part of this plan.

## Verification (end-to-end, after all 5 tasks)

```bash
cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system"
python -m pytest test_core.py research/test_base_rate.py -v
python main.py digest    # inspect for a disclosures: line on at least one name
```
