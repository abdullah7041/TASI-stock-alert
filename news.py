"""
Free news + sentiment layer.

Source: Google News RSS. No API key, works for Arabic and English queries.
This is the weakest, cheapest signal. It is an INPUT, never a trigger. There
is no confidence label: the sentiment is an auditable keyword/phrase tally
(word-boundary matching for English, plain substring for Arabic), not a
model, and every headline's matched terms are exposed via `matches` so a
score is never an opaque number. Do not trade on this alone.

If the fetch fails (network, rate limit), `ok` is False and the result is
empty/neutral, distinguishing "nothing happened" from "we couldn't check" so
the rest of the system keeps working either way.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
NEWS_ARCHIVE_FILE = Path(__file__).resolve().parent / "news_archive.jsonl"

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


@dataclass
class NewsResult:
    query: str
    headlines: list = field(default_factory=list)   # list of {title, link, published}
    score: float = 0.0        # -1.0 .. +1.0
    label: str = "neutral"    # 'positive' / 'neutral' / 'negative'
    matches: list = field(default_factory=list)  # per-headline {"positive": [...], "negative": [...]}
    ok: bool = True            # False if the fetch failed
    status: str = "available"  # available / partial / empty / failed
    errors: list = field(default_factory=list)


def _rss_url(query: str, lang: str = "en", country: str = "SA") -> str:
    params = {"q": query, "hl": lang, "gl": country, "ceid": f"{country}:{lang}"}
    return f"{GOOGLE_NEWS_RSS}?{urllib.parse.urlencode(params)}"


def _fetch_rss(url: str, limit: int) -> list:
    import requests
    for attempt in range(2):
        try:
            r = requests.get(url, timeout=8, headers={"User-Agent": "tasi-recommender/1.0"})
            r.raise_for_status()
            break
        except requests.RequestException as error:
            status = getattr(error.response, "status_code", None)
            transient = isinstance(error, (requests.Timeout, requests.ConnectionError)) or status in {408, 429, 500, 502, 503, 504}
            if attempt or not transient:
                raise
            time.sleep(0.5)
    root = ET.fromstring(r.content)
    items = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        if title:
            items.append({"title": title, "link": link, "published": pub})
        if len(items) >= limit:
            break
    return items


_WORD_BOUNDARY_CACHE: dict = {}


def _contains(word: str, low: str) -> bool:
    """Whether lexicon entry `word` is present in the lowercased text `low`.

    ASCII entries are word-boundary anchored so "rise" doesn't fire inside
    "Enterprise" or "surprised" (measured false positives in real archived
    headlines). Arabic entries stay plain substring because Arabic attaches
    prefixes/conjunctions directly to root words with no boundary a regex
    \\b would recognize.
    """
    if word.isascii():
        pattern = _WORD_BOUNDARY_CACHE.get(word)
        if pattern is None:
            pattern = re.compile(r'\b' + re.escape(word) + r'\b')
            _WORD_BOUNDARY_CACHE[word] = pattern
        return bool(pattern.search(low))
    return word in low


def score_headlines(titles) -> tuple[float, str]:
    """Substring tally over headline titles. Returns (score -1..1, label).

    Substring rather than word-set matching so both single words ("surge")
    and multi-word Tadawul/CMA phrases ("capital increase", "trading
    suspension") are detected without needing every inflection spelled out.
    ASCII entries are word-boundary anchored via `_contains` to avoid false
    positives like "rise" inside "Enterprise"; Arabic entries stay plain
    substring (see `_contains` docstring).
    """
    pos = neg = 0
    for t in titles:
        low = t.lower()
        pos += sum(1 for w in POSITIVE if _contains(w, low))
        neg += sum(1 for w in NEGATIVE if _contains(w, low))
    total = pos + neg
    if total == 0:
        return 0.0, "neutral"
    score = (pos - neg) / total
    label = "positive" if score > 0.2 else "negative" if score < -0.2 else "neutral"
    return round(score, 2), label


def _headline_matches(title: str) -> dict:
    """Which lexicon entries fired on this headline. Makes a surprising score
    diagnosable instead of an opaque number."""
    low = title.lower()
    return {
        "positive": sorted(w for w in POSITIVE if _contains(w, low)),
        "negative": sorted(w for w in NEGATIVE if _contains(w, low)),
    }


def get_news(company_name: str, code: str, limit: int = 8) -> NewsResult:
    """Fetch recent headlines for a name and score them. Never raises."""
    query = f'"{company_name}" OR {code} Tadawul'
    collected, errors = [], []
    for language, search in (("en", query), ("ar", company_name)):
        try:
            collected.append(_fetch_rss(_rss_url(search, language), limit))
        except Exception as error:
            errors.append(f"{language}: {type(error).__name__}")
            collected.append([])
    # Interleave so a full English result cannot silently discard Arabic news.
    headlines, seen = [], set()
    for index in range(limit):
        for group in collected:
            if index < len(group):
                item = group[index]
                key = item.get("link") or item["title"]
                if key not in seen:
                    seen.add(key)
                    headlines.append(item)
    headlines = headlines[:limit]
    titles = [h["title"] for h in headlines]
    score, label = score_headlines(titles)
    status = "failed" if len(errors) == 2 else "partial" if errors else "available" if headlines else "empty"
    return NewsResult(query=query, headlines=headlines, score=score, label=label,
                      matches=[_headline_matches(t) for t in titles],
                      ok=len(errors) < 2, status=status, errors=errors)


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
