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

import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"

# Keyword lexicons. Deliberately small and explicit. English + Arabic.
POSITIVE = {
    "beat", "beats", "surge", "surges", "jump", "jumps", "rise", "rises", "gain",
    "gains", "profit", "profits", "growth", "record", "upgrade", "buy", "wins",
    "win", "award", "dividend", "expansion", "acquire", "acquisition", "strong",
    "ارتفاع", "أرباح", "ربح", "نمو", "صفقة", "توزيع", "ترسية", "عقد", "قياسي", "توسع",
}
NEGATIVE = {
    "miss", "misses", "fall", "falls", "drop", "drops", "plunge", "plunges",
    "loss", "losses", "decline", "downgrade", "sell", "cut", "cuts", "probe",
    "lawsuit", "fraud", "delay", "warning", "weak", "halt", "suspend",
    "انخفاض", "خسارة", "خسائر", "تراجع", "هبوط", "تأجيل", "تحقيق", "غرامة", "تعليق", "إيقاف",
}


@dataclass
class NewsResult:
    query: str
    headlines: list = field(default_factory=list)   # list of {title, link, published}
    score: float = 0.0        # -1.0 .. +1.0
    label: str = "neutral"    # 'positive' / 'neutral' / 'negative'
    confidence: str = "low"    # always low by design
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
    """Keyword tally over headline titles. Returns (score -1..1, label)."""
    pos = neg = 0
    for t in titles:
        words = set(t.lower().replace(",", " ").replace(".", " ").split())
        pos += len(words & POSITIVE)
        neg += len(words & NEGATIVE)
    total = pos + neg
    if total == 0:
        return 0.0, "neutral"
    score = (pos - neg) / total
    label = "positive" if score > 0.2 else "negative" if score < -0.2 else "neutral"
    return round(score, 2), label


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
        titles = [h["title"] for h in headlines]
        score, label = score_headlines(titles)
        return NewsResult(query=query, headlines=headlines[:limit],
                          score=score, label=label, ok=True)
    except Exception:
        return NewsResult(query=query, headlines=[], score=0.0, label="neutral", ok=False)
