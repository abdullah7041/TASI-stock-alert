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
