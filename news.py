"""
Free news + sentiment layer.

Source: Google News RSS. No API key, works for Arabic and English queries.
This is the weakest, cheapest signal. It is an INPUT, never a trigger. Every
result is labeled low-confidence and the sentiment is a simple keyword tally,
not a model. Do not trade on this alone.

If the fetch fails (network, rate limit), it returns an empty, neutral result
so the rest of the system keeps working.
"""

from __future__ import annotations

import json
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


def _rss_url(query: str, lang: str = "en", country: str = "SA") -> str:
    params = {"q": query, "hl": lang, "gl": country, "ceid": f"{country}:{lang}"}
    return f"{GOOGLE_NEWS_RSS}?{urllib.parse.urlencode(params)}"


def _fetch_rss(url: str, limit: int) -> list:
    import requests
    r = requests.get(url, timeout=15, headers={"User-Agent": "tasi-recommender/1.0"})
    r.raise_for_status()
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


def _headline_matches(title: str) -> dict:
    """Which lexicon entries fired on this headline. Makes a surprising score
    diagnosable instead of an opaque number."""
    low = title.lower()
    return {
        "positive": sorted(w for w in POSITIVE if w in low),
        "negative": sorted(w for w in NEGATIVE if w in low),
    }


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
