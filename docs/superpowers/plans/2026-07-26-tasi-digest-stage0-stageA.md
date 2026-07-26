# TASI Digest Rebuild — Stage 0 (base rate) + Stage A (readability) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first two independent stages of the TASI digest redesign: (0) an offline base-rate study that gates the future breakout-scanner track, and (A) make the digest's news and technical-read output honest — real headlines instead of a dead-end sentiment number, no fabricated confidence labels, and no silent conflation of "fetch failed" with "nothing found."

**Architecture:** No new services, no new dependencies. Stage 0 is a standalone offline script (`research/base_rate.py`) reusing `backtest.py`'s existing feature cache and adjusted-history loader — it touches no production code path. Stage A is a chain of small, pure-function changes through `news.py` → `indicators.py` → `analyze.py` → `notify.py` → `main.py`, each layer consuming the shape the previous layer now produces. Every change is unit-tested offline in the existing `test_core.py` (or a colocated `research/test_base_rate.py` for Stage 0); no task requires a live network call to verify.

**Tech Stack:** Python 3, pandas, numpy, pytest (repo's existing offline test convention — see `test_core.py:1-2`).

## Global Constraints

- Free data sources only — no paid APIs, no LLM calls (user constraint, this session).
- News stays context-only. It must never gate a BUY decision or feed conviction (unchanged from current behavior — `analyze.buy_decision`'s `news_score < 0` veto is untouched by this plan; that veto's fate is a Stage B decision, out of scope here).
- Every fetched headline is archived starting now (`news_archive.jsonl`), so news becomes testable against `backtest.py` in the future. Do not skip the archive writer to save time.
- Conviction (`analyze.conviction_score`, `analyze.py:116-140`) is explicitly OUT OF SCOPE for this plan — it is deleted in a separate Stage B plan. Do not touch it here. `rec["conviction"]` keeps appearing in test fixtures unchanged.
- `TECH["rsi_period"]` being ignored by `indicators.short_term_read`/`long_term_read` is a known bug (`indicators.py:134,148`) but is deferred to Stage E. Do not fix it in this plan — fixing it here would touch `backtest.py`'s feature-cache call site and risk invalidating the cached `.cache/features.csv` that Task 1 depends on.
- All new/changed Python must keep working under `python test_core.py`'s hand-rolled runner (no test framework import beyond what's already used) as well as `pytest`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `research/__init__.py` | Create (empty) | Makes `research` an importable package. |
| `research/base_rate.py` | Create | Stage 0: forward-return labeling + base-rate report over the full backtest universe. |
| `research/test_base_rate.py` | Create | Offline tests for the above, synthetic OHLC data. |
| `news.py` | Modify | Phrase-aware lexicon, per-headline match detail, drop fake `confidence`, add `archive_headlines`. |
| `indicators.py` | Modify | Remove hardcoded `confidence` keys from `short_term_read`/`long_term_read`. |
| `analyze.py` | Modify | Add shared `news_summary()`; `evaluate_holding` gains a `news=None` param; `evaluate_watchlist` uses the shared helper. |
| `notify.py` | Modify | `_fmt_reads` drops the fake confidence suffix; new `_fmt_news` renders real headlines and distinguishes fetch-failure from silence. |
| `main.py` | Modify | Fetch news for holdings too (not watchlist-only); pass news into `evaluate_holding`; archive every fetch. |
| `test_core.py` | Modify | Update the `test_format_and_build_message` fixture to the new shapes; add tests for the new indicator/news/notify behavior. |

---

## Task 1: Stage 0 — base-rate research script

**Files:**
- Create: `research/__init__.py` (empty)
- Create: `research/base_rate.py`
- Test: `research/test_base_rate.py`

**Interfaces:**
- Consumes: `backtest.load_features() -> pd.DataFrame` (columns: `code, date, t, price, trend, rsi, momentum_pct, buy_zone_low, buy_zone_high, atr, stop, target, distance_to_zone_pct, regime` — `backtest.py:198-200`), `backtest.load_adjusted(codes: list, years: int) -> dict[str, pd.DataFrame]` (OHLC per code, `backtest.py:68-115`), `backtest.HISTORY_YEARS` (`backtest.py:47`).
- Produces: `forward_max_return_pct(df, t, window=60) -> float | None`, `label_rockets(feat, hist, threshold=15.0, window=60) -> pd.DataFrame` (adds `fwd_max_return_pct`, `is_rocket` columns), `base_rate_report(labeled) -> dict` (keys: `rows`, `positives`, `base_rate_pct`, `by_year`). These three functions are the interface any later scanner-feature study (Stage F, future plan) will import and reuse.

- [ ] **Step 1: Write the failing tests**

Create `research/test_base_rate.py`:

```python
"""Offline tests for the Stage 0 base-rate study. No network, no disk I/O
beyond what pytest's tmp_path gives a test — mirrors test_core.py's convention."""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from research.base_rate import base_rate_report, forward_max_return_pct, label_rockets


def _ohlc(closes):
    closes = list(closes)
    return pd.DataFrame({
        "Open": closes, "High": [c * 1.01 for c in closes],
        "Low": [c * 0.99 for c in closes], "Close": closes,
    })


def test_forward_max_return_flat_price_is_near_zero():
    df = _ohlc([100] * 100)
    fwd = forward_max_return_pct(df, t=10, window=60)
    assert fwd is not None
    assert abs(fwd) < 2.0  # High is 1% above Close, so max is ~+1%, not exactly 0.


def test_forward_max_return_catches_a_spike_mid_window():
    closes = [100] * 20 + [130] + [101] * 79  # spike at t+21
    df = _ohlc(closes)
    fwd = forward_max_return_pct(df, t=10, window=60)
    assert fwd > 25.0  # High of the spike bar is ~131.3, entry ~101 -> ~30%.


def test_forward_max_return_none_when_not_enough_future_bars():
    df = _ohlc([100] * 50)
    fwd = forward_max_return_pct(df, t=48, window=60)  # only 1 bar left after t+1.
    assert fwd is None


def test_forward_max_return_none_at_end_of_history():
    df = _ohlc([100] * 50)
    fwd = forward_max_return_pct(df, t=49, window=60)  # no bar after t at all.
    assert fwd is None


def test_label_rockets_drops_rows_with_no_future_data():
    feat = pd.DataFrame({"code": ["X", "X"], "date": pd.to_datetime(["2020-01-01", "2020-06-01"]),
                        "t": [10, 200]})
    hist = {"X": _ohlc([100] * 250)}
    labeled = label_rockets(feat, hist, threshold=15.0, window=60)
    assert len(labeled) == 1  # the t=200 row has no bar t+1 within a 250-bar frame minus buffer.
    assert labeled.iloc[0]["t"] == 10


def test_label_rockets_flags_is_rocket_correctly():
    feat = pd.DataFrame({"code": ["X"], "date": pd.to_datetime(["2020-01-01"]), "t": [10]})
    closes = [100] * 20 + [140] + [101] * 200  # clear spike, well above +15%.
    hist = {"X": _ohlc(closes)}
    labeled = label_rockets(feat, hist, threshold=15.0, window=60)
    assert bool(labeled.iloc[0]["is_rocket"]) is True


def test_label_rockets_skips_codes_missing_from_hist():
    feat = pd.DataFrame({"code": ["MISSING"], "date": pd.to_datetime(["2020-01-01"]), "t": [10]})
    labeled = label_rockets(feat, {}, threshold=15.0, window=60)
    assert labeled.empty


def test_base_rate_report_empty_input():
    rep = base_rate_report(pd.DataFrame())
    assert rep == {"rows": 0, "positives": 0, "base_rate_pct": None, "by_year": {}}


def test_base_rate_report_computes_overall_and_by_year():
    labeled = pd.DataFrame({
        "date": pd.to_datetime(["2020-01-01", "2020-06-01", "2021-01-01", "2021-06-01"]),
        "is_rocket": [True, False, False, False],
    })
    rep = base_rate_report(labeled)
    assert rep["rows"] == 4
    assert rep["positives"] == 1
    assert rep["base_rate_pct"] == 25.0
    assert rep["by_year"][2020]["positives"] == 1
    assert rep["by_year"][2020]["rows"] == 2
    assert rep["by_year"][2021]["positives"] == 0
    assert rep["by_year"][2021]["base_rate_pct"] == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest research/test_base_rate.py -v`
Expected: collection error — `research/base_rate.py` and `research/__init__.py` do not exist yet.

- [ ] **Step 3: Create the package init**

Create `research/__init__.py` with empty content (just makes the directory a package).

- [ ] **Step 4: Write `research/base_rate.py`**

```python
"""
Stage 0 of the breakout-scanner track: what is the real base rate of a
"rocket" (a big forward move) across the full backtest universe?

Every later scanner feature must be judged as lift OVER this number, never as
raw accuracy. If nothing beats it, the scanner track stops here — that is the
agreed outcome, not a failure to fix.

Run: `python research/base_rate.py` from the repo root. Requires
`.cache/features.csv` to already exist (MODE=universe then MODE=features).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backtest as bt  # noqa: E402

ROCKET_PCT = 15.0
ROCKET_WINDOW_BARS = 60


def forward_max_return_pct(df: pd.DataFrame, t: int, window: int = ROCKET_WINDOW_BARS) -> float | None:
    """Max close-to-high gain from bar t+1's open over the next `window` bars.

    Entry is t+1's open, matching backtest.resolve_outcome's no-look-ahead
    convention (a decision made on bar t cannot fill at bar t's own close).
    Returns None when there are not enough future bars to judge a full
    window — those rows must be DROPPED by the caller, not scored as "not a
    rocket", or the base rate would be biased toward names near the end of
    their history (which have disproportionately few forward bars).
    """
    n = len(df)
    if t + 1 >= n:
        return None
    entry = float(df["Open"].iloc[t + 1])
    if not np.isfinite(entry) or entry <= 0:
        entry = float(df["Close"].iloc[t + 1])
    if not np.isfinite(entry) or entry <= 0:
        return None
    last = min(t + window, n - 1)
    if last <= t + 1:
        return None
    highs = df["High"].iloc[t + 1:last + 1]
    return round((float(highs.max()) - entry) / entry * 100, 2)


def label_rockets(feat: pd.DataFrame, hist: dict, threshold: float = ROCKET_PCT,
                  window: int = ROCKET_WINDOW_BARS) -> pd.DataFrame:
    """Adds fwd_max_return_pct and is_rocket to every feature row that has a
    matching, non-empty history and enough future bars to judge. Rows that
    fail either check are dropped, not zero-filled."""
    if feat.empty:
        return pd.DataFrame()
    out_rows = []
    for code, group in feat.groupby("code"):
        df = hist.get(code)
        if df is None or df.empty:
            continue
        for _, row in group.iterrows():
            fwd = forward_max_return_pct(df, int(row["t"]), window)
            if fwd is None:
                continue
            out_rows.append({**row.to_dict(), "fwd_max_return_pct": fwd,
                             "is_rocket": fwd >= threshold})
    return pd.DataFrame(out_rows)


def base_rate_report(labeled: pd.DataFrame) -> dict:
    """Overall and per-year base rate, plus counts. A rate without its count
    is not trustworthy — 2 positives out of 8 rows is not a 25% base rate
    worth acting on."""
    if labeled.empty:
        return {"rows": 0, "positives": 0, "base_rate_pct": None, "by_year": {}}
    overall = {
        "rows": len(labeled),
        "positives": int(labeled["is_rocket"].sum()),
        "base_rate_pct": round(labeled["is_rocket"].mean() * 100, 2),
    }
    labeled = labeled.copy()
    labeled["year"] = pd.to_datetime(labeled["date"]).dt.year
    by_year = {}
    for year, g in labeled.groupby("year"):
        by_year[int(year)] = {
            "rows": len(g),
            "positives": int(g["is_rocket"].sum()),
            "base_rate_pct": round(g["is_rocket"].mean() * 100, 2),
        }
    overall["by_year"] = by_year
    return overall


def main() -> int:
    feat = bt.load_features()
    if feat.empty:
        print("no features. Run MODE=features first.")
        return 1
    codes = sorted(feat["code"].astype(str).unique())
    hist = bt.load_adjusted(codes, bt.HISTORY_YEARS)
    labeled = label_rockets(feat, hist)
    rep = base_rate_report(labeled)
    print(f"Base rate for +{ROCKET_PCT}% within {ROCKET_WINDOW_BARS} bars: "
          f"{rep['positives']}/{rep['rows']} = {rep['base_rate_pct']}%\n")
    print("By year:")
    for year, y in sorted(rep["by_year"].items()):
        print(f"  {year}: {y['positives']}/{y['rows']} = {y['base_rate_pct']}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest research/test_base_rate.py -v`
Expected: all 9 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add research/__init__.py research/base_rate.py research/test_base_rate.py
git commit -m "Add Stage 0 base-rate study for the breakout-scanner track"
```

---

## Task 2: `news.py` — phrase-aware, Tadawul-specific lexicon

The current lexicon (`news.py:22-33`) is ~25 single English/Arabic words and is
checked via word-set intersection, so multi-word market vocabulary ("profit
warning", "capital increase") can never match even if added verbatim. This
task switches to substring matching over the lowercased title so real
multi-word Tadawul/CMA phrases work, and expands the lexicon accordingly.

**Files:**
- Modify: `news.py:19-33` (constants), `news.py:68-80` (`score_headlines`)
- Test: `test_core.py` (append to the "news sentiment" section, `test_core.py:362-378`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `score_headlines(titles: list[str]) -> tuple[float, str]` — same signature as before, substring-matching implementation. Existing callers (`news.get_news`) are unaffected by the signature.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py` after `test_sentiment_arabic` (`test_core.py:375-377`):

```python
def test_sentiment_phrase_capital_increase_is_positive():
    score, label = news.score_headlines(["Company board approves capital increase plan"])
    assert score > 0 and label == "positive"

def test_sentiment_phrase_trading_suspension_is_negative():
    score, label = news.score_headlines(["CMA orders trading suspension of the stock"])
    assert score < 0 and label == "negative"

def test_sentiment_phrase_profit_warning_is_negative():
    score, label = news.score_headlines(["Firm issues profit warning ahead of results"])
    assert score < 0 and label == "negative"

def test_sentiment_arabic_phrase_dividend_distribution_is_positive():
    score, label = news.score_headlines(["مجلس الإدارة يوصي بتوزيعات أرباح نقدية"])
    assert score > 0 and label == "positive"

def test_sentiment_arabic_phrase_trading_halt_is_negative():
    score, label = news.score_headlines(["تعليق التداول في السهم بقرار من الهيئة"])
    assert score < 0 and label == "negative"

def test_sentiment_still_handles_old_single_word_lexicon():
    # Regression: substring matching must not lose the original coverage.
    score, label = news.score_headlines(["Shares plunge on unexpected loss"])
    assert score < 0 and label == "negative"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k phrase -v`
Expected: FAIL — "capital increase", "trading suspension", "profit warning", and the Arabic phrases are not yet in the lexicon, and `score_headlines` does not substring-match.

- [ ] **Step 3: Rewrite the lexicon and scoring function**

Replace `news.py:22-33`:

```python
# Keyword/phrase lexicons. Deliberately explicit, no stemming library.
# Substring-matched (not word-set) so multi-word market vocabulary works —
# a word-set tally can never match a two-word phrase like "capital increase".
POSITIVE = {
    "beat", "beats", "surge", "surges", "jump", "jumps", "rise", "rises", "gain",
    "gains", "profit", "profits", "growth", "record", "upgrade", "buy", "wins",
    "win", "award", "dividend", "dividends", "expansion", "acquire", "acquisition",
    "strong", "buyback", "share buyback", "capital increase", "board recommends",
    "rights issue", "signs contract", "wins contract",
    "ارتفاع", "أرباح", "ربح", "نمو", "صفقة", "توزيع", "توزيعات أرباح", "ترسية",
    "ترسية مشروع", "عقد", "قياسي", "توسع", "زيادة رأس المال", "توصية مجلس الإدارة",
}
NEGATIVE = {
    "miss", "misses", "fall", "falls", "drop", "drops", "plunge", "plunges",
    "loss", "losses", "decline", "downgrade", "sell", "cut", "cuts", "probe",
    "lawsuit", "fraud", "delay", "warning", "weak", "halt", "suspend",
    "profit warning", "trading suspension", "trading halt",
    "انخفاض", "خسارة", "خسائر", "تراجع", "هبوط", "تأجيل", "تحقيق", "غرامة",
    "تعليق", "إيقاف", "تعليق التداول", "إنذار أرباح",
}
```

Replace `news.py:68-80` (`score_headlines`):

```python
def score_headlines(titles) -> tuple[float, str]:
    """Substring tally over headline titles. Returns (score -1..1, label).

    Substring rather than word-set matching so both single words ("surge")
    and multi-word Tadawul/CMA phrases ("capital increase", "trading
    suspension") are detected without needing every inflection spelled out.
    """
    pos = neg = 0
    for t in titles:
        low = t.lower()
        pos += sum(1 for w in POSITIVE if w in low)
        neg += sum(1 for w in NEGATIVE if w in low)
    total = pos + neg
    if total == 0:
        return 0.0, "neutral"
    score = (pos - neg) / total
    label = "positive" if score > 0.2 else "negative" if score < -0.2 else "neutral"
    return round(score, 2), label
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "sentiment" -v`
Expected: all sentiment tests PASS, including the 6 new ones.

- [ ] **Step 5: Run the full offline suite to check for regressions**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -v`
Expected: all pass (this lexicon change has no other consumers besides `score_headlines`'s callers, which are unaffected by signature).

- [ ] **Step 6: Commit**

```bash
git add news.py test_core.py
git commit -m "Make news sentiment phrase-aware with real Tadawul/CMA vocabulary"
```

---

## Task 3: `news.py` — drop fake confidence, add auditable per-headline matches

`NewsResult.confidence` (`news.py:42`) is a hardcoded constant, never computed,
always `"low"`. A constant labeled "confidence" is worse than none — delete
it. Replace it with something real: which lexicon words/phrases fired on each
headline, so a surprising score is diagnosable instead of opaque.

**Files:**
- Modify: `news.py:36-43` (`NewsResult` dataclass), `news.py:83-98` (`get_news`)
- Test: `test_core.py`

**Interfaces:**
- Consumes: `POSITIVE`, `NEGATIVE` from Task 2.
- Produces: `NewsResult` with fields `query, headlines, score, label, matches, ok` (no `confidence`). `matches: list[dict]` — one `{"positive": [...], "negative": [...]}` per headline, same index order as `headlines`. New helper `_headline_matches(title: str) -> dict`.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py`:

```python
def test_headline_matches_finds_positive_words():
    m = news._headline_matches("Company profit surges to a record high")
    assert "profit" in m["positive"]
    assert m["negative"] == []

def test_headline_matches_finds_negative_phrase():
    m = news._headline_matches("Firm issues profit warning after weak quarter")
    assert "profit warning" in m["negative"]

def test_news_result_has_no_confidence_field():
    import dataclasses
    field_names = {f.name for f in dataclasses.fields(news.NewsResult)}
    assert "confidence" not in field_names
    assert "matches" in field_names
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "headline_matches or news_result_has_no" -v`
Expected: FAIL — `_headline_matches` does not exist; `NewsResult` still has `confidence`, not `matches`.

- [ ] **Step 3: Update `NewsResult` and add `_headline_matches`**

Replace `news.py:36-43`:

```python
@dataclass
class NewsResult:
    query: str
    headlines: list = field(default_factory=list)   # list of {title, link, published}
    score: float = 0.0        # -1.0 .. +1.0
    label: str = "neutral"    # 'positive' / 'neutral' / 'negative'
    matches: list = field(default_factory=list)  # per-headline {"positive": [...], "negative": [...]}
    ok: bool = True            # False if the fetch failed
```

Add after `score_headlines` (post-Task-2 version, `news.py:68-...`):

```python
def _headline_matches(title: str) -> dict:
    """Which lexicon entries fired on this headline. Makes a surprising score
    diagnosable instead of an opaque number."""
    low = title.lower()
    return {
        "positive": sorted(w for w in POSITIVE if w in low),
        "negative": sorted(w for w in NEGATIVE if w in low),
    }
```

- [ ] **Step 4: Update `get_news` to populate `matches` and drop `confidence`**

Replace `news.py:83-98` (`get_news`):

```python
def get_news(company_name: str, code: str, limit: int = 8) -> NewsResult:
    """Fetch recent headlines for a name and score them. Never raises."""
    query = f'"{company_name}" OR {code} Tadawul'
    try:
        headlines = _fetch_rss(_rss_url(query, "en"), limit)
        # Add a few Arabic-language hits.
        try:
            headlines += _fetch_rss(_rss_url(company_name, "ar"), max(2, limit // 2))
        except Exception:
            pass
        headlines = headlines[:limit]
        titles = [h["title"] for h in headlines]
        score, label = score_headlines(titles)
        matches = [_headline_matches(t) for t in titles]
        return NewsResult(query=query, headlines=headlines, score=score,
                          label=label, matches=matches, ok=True)
    except Exception:
        return NewsResult(query=query, headlines=[], score=0.0, label="neutral",
                          matches=[], ok=False)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -v`
Expected: all pass. (`analyze.py:354` still reads `news.confidence` at this point in the sequence — that is fixed in Task 6, which comes right after. Do not skip ahead; Task 6 depends on this task's field rename being in place.)

- [ ] **Step 6: Commit**

```bash
git add news.py test_core.py
git commit -m "Drop fake news confidence label; add per-headline match detail"
```

---

## Task 4: `news.py` — archive every fetched headline

`backtest.py:362` hardcodes `news_score = 0.0` because no headline history
exists to validate news against. This task starts that history. Every run's
fetch gets appended to a JSONL log — the prerequisite for ever testing whether
news sentiment predicts anything (revisit in ~12 months once enough days have
accumulated).

**Files:**
- Modify: `news.py` (add imports, `NEWS_ARCHIVE_FILE`, `archive_headlines`)
- Test: `test_core.py`

**Interfaces:**
- Consumes: `NewsResult` from Task 3.
- Produces: `archive_headlines(code: str, result: NewsResult, archive_path: Path = NEWS_ARCHIVE_FILE) -> None`. Called by `main.py` in Task 8 — do not wire it into `main.py` yet in this task.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py` (needs `import json` — add it locally inside the test functions to avoid touching the shared import block):

```python
def test_archive_headlines_writes_one_jsonl_line_per_headline():
    import json
    result = news.NewsResult(
        query="q",
        headlines=[{"title": "Firm profit rises 12%", "link": "http://x", "published": "24 Jul 2026"}],
        score=0.5, label="positive",
        matches=[{"positive": ["profit"], "negative": []}], ok=True)
    path = Path(__file__).resolve().parent / "_test_archive_tmp.jsonl"
    try:
        if path.exists():
            path.unlink()
        news.archive_headlines("1234", result, archive_path=path)
        lines = path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        rec = json.loads(lines[0])
        assert rec["code"] == "1234"
        assert rec["title"] == "Firm profit rises 12%"
        assert rec["matched_positive"] == ["profit"]
        assert rec["score"] == 0.5
    finally:
        if path.exists():
            path.unlink()

def test_archive_headlines_skips_when_no_headlines():
    result = news.NewsResult(query="q", ok=True)  # empty headlines, default.
    path = Path(__file__).resolve().parent / "_test_archive_tmp2.jsonl"
    try:
        if path.exists():
            path.unlink()
        news.archive_headlines("1234", result, archive_path=path)
        assert not path.exists()
    finally:
        if path.exists():
            path.unlink()

def test_archive_headlines_appends_across_calls():
    import json
    path = Path(__file__).resolve().parent / "_test_archive_tmp3.jsonl"
    try:
        if path.exists():
            path.unlink()
        r1 = news.NewsResult(query="q", headlines=[{"title": "A", "link": "", "published": ""}],
                             score=0.0, label="neutral", matches=[{"positive": [], "negative": []}], ok=True)
        r2 = news.NewsResult(query="q", headlines=[{"title": "B", "link": "", "published": ""}],
                             score=0.0, label="neutral", matches=[{"positive": [], "negative": []}], ok=True)
        news.archive_headlines("1", r1, archive_path=path)
        news.archive_headlines("2", r2, archive_path=path)
        lines = path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 2
        assert json.loads(lines[0])["code"] == "1"
        assert json.loads(lines[1])["code"] == "2"
    finally:
        if path.exists():
            path.unlink()
```

Also add `from pathlib import Path` to `test_core.py`'s import block if not already present (check `test_core.py:1-19` first — it is not currently imported there).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k archive_headlines -v`
Expected: FAIL — `news.archive_headlines` does not exist.

- [ ] **Step 3: Add the archive writer to `news.py`**

Add near the top of `news.py`, alongside the existing imports:

```python
import json
import time
from pathlib import Path
```

Add after the `GOOGLE_NEWS_RSS` constant (`news.py:19`):

```python
NEWS_ARCHIVE_FILE = Path(__file__).resolve().parent / "news_archive.jsonl"
```

Add at the end of `news.py`, after `get_news`:

```python
def archive_headlines(code: str, result: NewsResult,
                      archive_path: Path = NEWS_ARCHIVE_FILE) -> None:
    """Append every fetched headline to a JSONL log, one line per headline.

    This is the only way news ever becomes testable against price outcomes:
    backtest.py hardcodes news_score=0.0 because no headline history exists
    yet. Every run's fetch would otherwise be thrown away. No-op when there
    are no headlines (fetch failure or a genuinely empty result) — an empty
    archive entry is noise, not data.
    """
    if not result.headlines:
        return
    today = time.strftime("%Y-%m-%d")
    matches = result.matches or [{"positive": [], "negative": []}] * len(result.headlines)
    with open(archive_path, "a", encoding="utf-8") as f:
        for h, m in zip(result.headlines, matches):
            f.write(json.dumps({
                "date": today, "code": code, "title": h.get("title", ""),
                "link": h.get("link", ""), "published": h.get("published", ""),
                "score": result.score, "label": result.label,
                "matched_positive": m.get("positive", []),
                "matched_negative": m.get("negative", []),
            }, ensure_ascii=False) + "\n")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -v`
Expected: all pass.

- [ ] **Step 5: Add `news_archive.jsonl` to `.gitignore`... no — do the opposite**

Check `.gitignore` for any pattern that would exclude `news_archive.jsonl` (e.g. `*.jsonl`). This file MUST be committed by the workflow (it is the archive), unlike `.cache/`. If `.gitignore` has a blanket `*.jsonl` rule, add an explicit exception `!news_archive.jsonl` beneath it. If there is no such rule, no change is needed — confirm with `git check-ignore -v news_archive.jsonl` (expect no output, meaning it is NOT ignored).

- [ ] **Step 6: Commit**

```bash
git add news.py test_core.py .gitignore
git commit -m "Archive every fetched headline so news becomes testable over time"
```

---

## Task 5: `indicators.py` — remove hardcoded confidence labels

`short_term_read` and `long_term_read` (`indicators.py:127-149`) return a
`confidence` key that is a hardcoded string constant (`"low"` / `"medium"`),
never computed from anything about the data. Delete it — a fabricated
confidence is worse than none, and `notify.py` (Task 7) stops rendering it.

**Files:**
- Modify: `indicators.py:127-149`
- Test: `test_core.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `short_term_read(df, lookback, short_ma) -> dict` with keys `horizon, momentum_pct, rsi, above_ma` (no `confidence`). `long_term_read(df, lookback, short_ma, long_ma) -> dict` with keys `horizon, trend, momentum_pct, rsi` (no `confidence`). Callers in `analyze.py` (`evaluate_holding`, `evaluate_watchlist`) and `backtest.py` (`build_features`, `_row_to_long_read`) already only read `trend`/`momentum_pct`/`rsi` from these dicts — verified by reading their call sites; no caller reads `confidence`, so this is a safe removal.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py`, in the indicators section (near the RSI/trend tests, `test_core.py:32-58`):

```python
def test_short_term_read_has_no_confidence_key():
    df = _frame(list(range(1, 40)))
    out = ind.short_term_read(df, 10, 20)
    assert "confidence" not in out
    assert "momentum_pct" in out and "rsi" in out

def test_long_term_read_has_no_confidence_key():
    df = _frame(list(range(1, 160)))
    out = ind.long_term_read(df, 50, 20, 50)
    assert "confidence" not in out
    assert "trend" in out and "momentum_pct" in out and "rsi" in out
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "has_no_confidence" -v`
Expected: FAIL — both dicts currently contain `"confidence"`.

- [ ] **Step 3: Remove the hardcoded keys**

Replace `indicators.py:127-149`:

```python
def short_term_read(df: pd.DataFrame, lookback: int, short_ma: int) -> dict:
    """Short-horizon momentum read."""
    closes = df["Close"]
    return {
        "horizon": "short",
        "momentum_pct": round(pct_change(closes, lookback), 2),
        "rsi": round(rsi(closes), 1),
        "above_ma": bool(float(closes.iloc[-1]) > sma(closes, short_ma))
        if not np.isnan(sma(closes, short_ma)) else None,
    }


def long_term_read(df: pd.DataFrame, lookback: int, short_ma: int, long_ma: int) -> dict:
    """Long-horizon swing read. This is the more reliable one on daily data."""
    closes = df["Close"]
    return {
        "horizon": "long",
        "trend": trend(closes, short_ma, long_ma),
        "momentum_pct": round(pct_change(closes, lookback), 2),
        "rsi": round(rsi(closes), 1),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -v`
Expected: all pass (existing tests do not assert on `confidence` anywhere except the `test_format_and_build_message` fixture, which is fixed in Task 7 — until then that one test's fixture data simply has an unused extra key with no effect on the assertions, so it stays green).

- [ ] **Step 5: Commit**

```bash
git add indicators.py test_core.py
git commit -m "Remove hardcoded confidence labels from short/long-term reads"
```

---

## Task 6: `analyze.py` — shared `news_summary()`, holdings get news too

Today only `evaluate_watchlist` attaches a news dict to its output
(`analyze.py:352-354`), and it reads the now-deleted `news.confidence` field.
This task adds a shared helper used by both evaluators, and gives
`evaluate_holding` a `news` parameter so holdings can carry a news block too
(wired up end-to-end in Task 8).

**Files:**
- Modify: `analyze.py:176-207` (`evaluate_holding`), `analyze.py:306-355` (`evaluate_watchlist`)
- Test: `test_core.py`

**Interfaces:**
- Consumes: `NewsResult` (from Task 3: `ok, label, score, headlines` — no `confidence`).
- Produces: `news_summary(news: NewsResult | None) -> dict | None` with keys `ok, label, score, headlines` (or `None` if `news is None`). `evaluate_holding(holding, price, df, levels, horizon_cfg, tech, news=None) -> dict` — new optional trailing param, output dict gains a `"news"` key. `evaluate_watchlist`'s output `"news"` key now comes from `news_summary()` instead of inline dict construction.

- [ ] **Step 1: Write the failing tests**

Add to `test_core.py` near `test_holding_stop_triggers_sell` (`test_core.py:321-329`):

```python
def test_news_summary_none_when_no_news():
    assert az.news_summary(None) is None

def test_news_summary_shapes_result():
    result = news.NewsResult(query="q", headlines=[{"title": "T", "link": "", "published": ""}],
                             score=0.3, label="positive", matches=[{"positive": [], "negative": []}], ok=True)
    summary = az.news_summary(result)
    assert summary == {"ok": True, "label": "positive", "score": 0.3,
                       "headlines": [{"title": "T", "link": "", "published": ""}]}

def test_evaluate_holding_attaches_news():
    df = _frame(list(range(100, 160)))
    h = {"code": "1303", "name": "EIC", "shares": 100, "avg_cost": 120.0}
    result = news.NewsResult(query="q", headlines=[{"title": "T", "link": "", "published": ""}],
                             score=0.1, label="neutral", matches=[{"positive": [], "negative": []}], ok=True)
    rec = az.evaluate_holding(h, price=110.0, df=df,
                              levels={"stop": 115.0}, horizon_cfg={
                                  "short_lookback_days": 10, "long_lookback_days": 50,
                                  "short_ma": 20, "long_ma": 50},
                              tech={"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70},
                              news=result)
    assert rec["news"]["ok"] is True
    assert rec["news"]["headlines"][0]["title"] == "T"

def test_evaluate_holding_news_defaults_to_none():
    df = _frame(list(range(100, 160)))
    h = {"code": "1303", "name": "EIC", "shares": 100, "avg_cost": 120.0}
    rec = az.evaluate_holding(h, price=110.0, df=df,
                              levels={"stop": 115.0}, horizon_cfg={
                                  "short_lookback_days": 10, "long_lookback_days": 50,
                                  "short_ma": 20, "long_ma": 50},
                              tech={"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70})
    assert rec["news"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "news_summary or evaluate_holding_news or evaluate_holding_attaches" -v`
Expected: FAIL — `az.news_summary` does not exist; `evaluate_holding` has no `news` parameter and never sets `rec["news"]`.

- [ ] **Step 3: Add `news_summary` and wire it into both evaluators**

Add to `analyze.py`, just before `# --- Holdings evaluation ---` (`analyze.py:175`):

```python
# --- News shaping ------------------------------------------------------------
def news_summary(news) -> dict | None:
    """Shape a news.NewsResult into the dict notify.py renders. Shared by both
    evaluators so a fetch failure and a genuinely empty result render
    identically regardless of which evaluation path found the name."""
    if news is None:
        return None
    return {
        "ok": news.ok,
        "label": news.label,
        "score": news.score,
        "headlines": news.headlines,
    }
```

Modify `evaluate_holding`'s signature (`analyze.py:176-177`):

```python
def evaluate_holding(holding: dict, price: float, df: pd.DataFrame, levels: dict,
                     horizon_cfg: dict, tech: dict, news=None) -> dict:
```

Modify its return dict (`analyze.py:201-207`) to add the news key:

```python
    return {
        "kind": "holding",
        "code": code, "name": holding.get("name", code),
        "price": round(price, 2), "action": action, "reason": reason,
        "unrealized_pct": pnl_pct,
        "short_term": short, "long_term": long,
        "news": news_summary(news),
    }
```

Replace `evaluate_watchlist`'s inline news block (`analyze.py:352-354`):

```python
    if news is not None:
        out["news"] = news_summary(news)
```

with:

```python
    out["news"] = news_summary(news)
```

(Unconditional now — `news_summary(None)` already returns `None`, matching the prior behavior of omitting a truthy news block, and `notify.py`'s `if rec.get("news"):` check treats `None` the same as a missing key.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add analyze.py test_core.py
git commit -m "Share news-shaping between holdings and watchlist evaluators"
```

---

## Task 7: `notify.py` — render real headlines, retire the fake confidence suffix

This is the visible payoff. `_fmt_reads` stops printing `(low conf)` /
`(medium conf)` (the keys no longer exist after Task 5). The news line stops
being a single opaque number and instead shows 2-3 actual headlines with
dates, and distinguishes "the fetch failed" from "nothing was found" — today
these render identically and that ambiguity was one of the three original
complaints.

**Files:**
- Modify: `notify.py:13-43`
- Test: `test_core.py:381-393` (`test_format_and_build_message` — fixture must be updated to the new shapes)

**Interfaces:**
- Consumes: `rec["short_term"]`, `rec["long_term"]` (no `confidence` key, per Task 5); `rec["news"]` shaped as `{ok, label, score, headlines}` or `None` (per Task 6).
- Produces: `_fmt_reads(rec) -> str` (unchanged signature, new content), new `_fmt_news(news: dict) -> list[str]`, `format_recommendation(rec) -> str` (unchanged signature).

- [ ] **Step 1: Write the failing tests**

Replace the existing fixture in `test_core.py` (`test_core.py:381-393`):

```python
def test_format_and_build_message():
    rec = {
        "kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
        "action": "BUY", "reason": ["in zone"], "conviction": 72,
        "sizing": {"shares": 7, "spend": 700.0, "pct_of_cash": 23.3},
        "short_term": {"momentum_pct": 2.1, "rsi": 55},
        "long_term": {"trend": "up", "momentum_pct": 8.0, "rsi": 60},
        "news": {"ok": True, "label": "positive", "score": 0.4,
                "headlines": [{"title": "Jamjoom profit rises 12%",
                              "link": "http://x", "published": "24 Jul 2026"}]},
    }
    block = nt.format_recommendation(rec)
    assert "4015" in block and "BUY" in block and "conviction: 72" in block
    assert "conf)" not in block  # the fake confidence suffix is gone.
    assert "Jamjoom profit rises 12%" in block
    assert "24 Jul 2026" in block
    msg = nt.build_message([rec], "Test header")
    assert "Test header" in msg and "Not financial advice" in msg
```

Add two new tests right after it:

```python
def test_format_news_fetch_failed_renders_distinctly():
    rec = {
        "kind": "watchlist", "code": "1", "name": "X", "price": 1.0,
        "action": "WATCH", "reason": [], "conviction": 0,
        "short_term": {"momentum_pct": 0, "rsi": 50}, "long_term": {"trend": "flat", "momentum_pct": 0, "rsi": 50},
        "news": {"ok": False, "label": "neutral", "score": 0.0, "headlines": []},
    }
    block = nt.format_recommendation(rec)
    assert "fetch failed" in block

def test_format_news_empty_result_renders_distinctly_from_failure():
    rec = {
        "kind": "watchlist", "code": "2", "name": "Y", "price": 1.0,
        "action": "WATCH", "reason": [], "conviction": 0,
        "short_term": {"momentum_pct": 0, "rsi": 50}, "long_term": {"trend": "flat", "momentum_pct": 0, "rsi": 50},
        "news": {"ok": True, "label": "neutral", "score": 0.0, "headlines": []},
    }
    block = nt.format_recommendation(rec)
    assert "no headlines found" in block
    assert "fetch failed" not in block
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -k "format_and_build_message or format_news" -v`
Expected: FAIL — `notify.py` still emits `(... conf)` and the raw `score`/`count`/`confidence` line; no headline text is rendered; "fetch failed" / "no headlines found" strings don't exist yet.

- [ ] **Step 3: Rewrite `notify.py:13-43`**

Replace:

```python
def _fmt_reads(rec: dict) -> str:
    s = rec.get("short_term", {})
    l = rec.get("long_term", {})
    short = f"short: mom {s.get('momentum_pct')}% RSI {s.get('rsi')}"
    long = f"long: {l.get('trend')} mom {l.get('momentum_pct')}% RSI {l.get('rsi')}"
    return f"{short}\n   {long}"


def _fmt_news(news: dict) -> list:
    """Three distinct renders: a failed fetch, a fetch that found nothing, and
    a fetch with real headlines. Collapsing the first two into one 'neutral
    0.0' line is exactly what made news look hardcoded."""
    if news.get("ok") is False:
        return ["   news: fetch failed"]
    headlines = news.get("headlines") or []
    if not headlines:
        return [f"   news: no headlines found ({news.get('label')}, score {news.get('score')})"]
    lines = [f"   news: {news.get('label')} (score {news.get('score')}, {len(headlines)} headlines)"]
    for h in headlines[:3]:
        title = h.get("title", "")
        published = h.get("published", "")
        lines.append(f"      \"{title}\" — {published}")
    return lines


def format_recommendation(rec: dict) -> str:
    """One block per name."""
    head = f"**{rec['code']} {rec['name']}** @ {rec['price']}  ->  **{rec['action']}**"
    lines = [head]
    for r in rec.get("reason", []):
        lines.append(f"   - {r}")
    if rec["kind"] == "holding" and rec.get("unrealized_pct") is not None:
        lines.append(f"   P/L: {rec['unrealized_pct']}%")
    if rec["kind"] == "watchlist":
        lines.append(f"   conviction: {rec.get('conviction')}/100")
        sz = rec.get("sizing")
        if sz and not sz.get("skip"):
            lines.append(
                f"   size: BUY {sz['shares']} sh x {rec['price']} = {sz['spend']} SAR "
                f"({sz.get('weight_pct')}% conviction weight; "
                f"{sz.get('budget_left_after')} SAR of monthly budget left after)")
        elif sz and sz.get("skip"):
            lines.append(f"   size: none — {sz['skip']}")
    if rec.get("news"):
        lines.extend(_fmt_news(rec["news"]))
    lines.append(f"   {_fmt_reads(rec)}")
    return "\n".join(lines)
```

(`build_message` at `notify.py:46-68` and `send_discord` at `notify.py:71-86` are unchanged — leave them exactly as they are.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add notify.py test_core.py
git commit -m "Render real headlines in the digest; retire fake confidence labels"
```

---

## Task 8: `main.py` — news for holdings too, and archive every fetch

Today news is fetched only for `cfg.WATCHLIST` (`main.py:198-210`); holdings
never get a news block, which was complaint #3 from the user ("my lists seems
so basic, it does not have even news signal"). This task fetches for both
lists, threads the result into `evaluate_holding`, and archives every fetch
via Task 4's writer.

**Files:**
- Modify: `main.py:198-226` (`_collect_recs`)

**Interfaces:**
- Consumes: `az.evaluate_holding(..., news=None)` (Task 6), `newsmod.archive_headlines(code, result)` (Task 4).
- Produces: no new public interface — this is the wiring task. Not independently unit-testable (network + threading); verified manually in Step 3 below, consistent with the rest of `main.py` having no offline test coverage today.

- [ ] **Step 1: Widen the news fetch to include holdings**

Replace `main.py:198-210`:

```python
    news_by_code = {}
    if include_news:
        from concurrent.futures import ThreadPoolExecutor
        import news as newsmod

        def _fetch(w):
            try:
                return w["code"], newsmod.get_news(w["name"], w["code"])
            except Exception:
                return w["code"], None

        with ThreadPoolExecutor(max_workers=8) as ex:
            news_by_code = dict(ex.map(_fetch, cfg.HOLDINGS + cfg.WATCHLIST))

        for code, result in news_by_code.items():
            if result is not None:
                newsmod.archive_headlines(code, result)
```

- [ ] **Step 2: Pass news into `evaluate_holding`**

Replace the holdings loop (`main.py:214-226`):

```python
    for h in cfg.HOLDINGS:
        df = hist.get(h["code"])
        if df is None or df.empty:
            continue
        price = float(df["Close"].iloc[-1])
        rec = az.evaluate_holding(h, price, df, _levels_for(h["code"], stored_levels),
                                  cfg.HORIZON, cfg.TECH, news_by_code.get(h["code"]))
        v = verify.get(h["code"], {})
        rec["verified"], rec["yahoo_name"] = v.get("verified", True), v.get("yahoo_name", "")
        if not rec["verified"]:
            rec["reason"].insert(0, f"symbol UNVERIFIED: {v.get('reason')} — P/L may be wrong")
            unverified.append((h["code"], h["name"], v.get("yahoo_name", "")))
        recs.append(rec)
```

(Only the `az.evaluate_holding(...)` call line changed — added `news_by_code.get(h["code"])` as the trailing positional arg. The watchlist loop below it is unchanged; it already passes `news_by_code.get(w["code"])` at `main.py:234`.)

- [ ] **Step 3: Manual verification (no automated test — network + threading)**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python main.py digest`
(No `DISCORD_WEBHOOK_URL` set — the digest prints to stdout per `main.py:260-261`.)

Expected: every holding AND every watchlist name shows a `news:` line; at least
one shows either real headline text or `no headlines found` (not silently
absent as it was for holdings before). Confirm `news_archive.jsonl` was
created/appended in the repo root — `cat news_archive.jsonl | wc -l` should
grow versus its state before this run (0 if the file didn't exist yet).

- [ ] **Step 4: Run the full offline suite once more (nothing here should have moved)**

Run: `cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system" && python -m pytest test_core.py research/test_base_rate.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add main.py
git commit -m "Fetch and archive news for holdings, not just the watchlist"
```

---

## Self-Review Notes

- **Spec coverage:** Stage 0 (base rate) — Task 1. Stage A's four readability items from the design — headlines shown (Task 7/8), fetch-failure vs silence distinguished (Task 3/7), fake confidence dropped (Task 3/5/7), lexicon expanded to Tadawul vocabulary (Task 2), archive started (Task 4). All covered.
- **Explicitly deferred, confirmed not touched by any task above:** `conviction_score`/`position_size` deletion (Stage B), `triggers.py` (Stage C), `history.json`/streaks (Stage D), disclosures feed + `TECH["rsi_period"]` fix + CI test step (Stage E), the scanner itself (Stage F, gated on Task 1's result). These are separate follow-on plans.
- **Type/signature consistency check:** `news_summary()` defined in Task 6, consumed in Task 6 (both evaluators) and implicitly relied upon by Task 7/8's expectations of `rec["news"]` shape — consistent throughout (`{ok, label, score, headlines}` or `None`). `evaluate_holding`'s new `news=None` trailing parameter is additive and keeps `test_holding_stop_triggers_sell` (`test_core.py:321-329`, which calls it without `news=`) passing unchanged.
- **No placeholders:** every step above has runnable code, not a description of code.

## Verification (end-to-end, after all 8 tasks)

```bash
cd "C:\Users\NoteBook Pc\Desktop\tasi-alert-system"
python -m pytest test_core.py research/test_base_rate.py -v
python research/base_rate.py          # requires .cache/features.csv; prints base rate + by-year breakdown
python main.py digest                  # prints the new-format digest to stdout (no webhook needed locally)
```

Confirm in the printed digest: no `(low conf)`/`(medium conf)` anywhere; every
name (holding or watchlist) has a `news:` line that is either real headlines,
`no headlines found`, or `fetch failed` — never silently absent or a bare
`neutral (0.0, ...)`.
