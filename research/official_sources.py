"""Conservative collection of public Saudi Exchange announcement links.

This module intentionally produces candidates for review, never financial
metric grades. Validated evidence remains the only input to the Top 10.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse


OFFICIAL_HOST = "www.saudiexchange.sa"
PORTAL_URL = (
    "https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/"
    "issuer-news/issuer-announcements?locale=en"
)
USER_AGENT = "TASI-Action-Cockpit/1.0 (+official-source-review-queue)"
_ANNOUNCEMENT_ENDPOINT = re.compile(
    r"p0/[A-Za-z0-9_=/!?-]*NJgetAnnouncementListData=/"
)
_PAGE_SIZE = 100
_RIYADH = timezone(timedelta(hours=3))


@dataclass(frozen=True)
class OfficialAnnouncement:
    title: str
    url: str
    retrieved_at: str
    symbol: str | None = None
    published_at: str | None = None
    source_published_at: str | None = None


class _AnnouncementAnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.anchors: list[tuple[str, str]] = []
        self.base_href: str | None = None
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "base" and self.base_href is None:
            self.base_href = dict(attrs).get("href")
        if tag == "a" and self._href is None:
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href is not None:
            self.anchors.append((self._href, " ".join("".join(self._text).split())))
            self._href = None
            self._text = []


def is_official_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname == OFFICIAL_HOST


def parse_official_announcements(html: str, retrieved_at: str) -> list[OfficialAnnouncement]:
    parser = _AnnouncementAnchorParser()
    parser.feed(html)
    found: dict[str, OfficialAnnouncement] = {}
    for href, title in parser.anchors:
        url = urljoin(PORTAL_URL, href)
        if title and is_official_url(url) and (
            "issuer-announcements-details" in url or "/Resources/fsPdf/" in url
        ):
            found.setdefault(url, OfficialAnnouncement(title=title, url=url, retrieved_at=retrieved_at))
    return list(found.values())


def _request_with_retry(request):
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            response = request()
            response.raise_for_status()
            return response
        except Exception as exc:
            last_error = exc
            if attempt == 1:
                raise
    raise RuntimeError("official portal request failed") from last_error


def _period_for_days(lookback_days: int) -> str:
    if lookback_days <= 1:
        return "1 day"
    if lookback_days <= 7:
        return "7 day"
    if lookback_days <= 31:
        return "1 month"
    if lookback_days <= 366:
        return "1 year"
    return "5 year"


def _published_at(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.strptime(value.strip(), "%d/%m/%Y %H:%M:%S").replace(
            tzinfo=_RIYADH
        ).isoformat()
    except ValueError:
        return None


def _parse_feed(payload: object, retrieved_at: str) -> tuple[list[OfficialAnnouncement], int]:
    if not isinstance(payload, dict) or not isinstance(payload.get("announcementList"), list):
        raise ValueError("official announcement feed returned an invalid payload")
    try:
        total_count = int(payload.get("totalCount", len(payload["announcementList"])))
    except (TypeError, ValueError) as exc:
        raise ValueError("official announcement feed returned an invalid totalCount") from exc

    if total_count < 0 or (total_count > 0 and not payload["announcementList"]):
        raise ValueError("official feed returned an invalid announcement count")
    announcements: list[OfficialAnnouncement] = []
    for item in payload["announcementList"]:
        if not isinstance(item, dict):
            raise ValueError("official feed returned an invalid announcement")
        title = str(item.get("SHORT_DESC") or "").strip()
        raw_url = str(item.get("announcementUrl") or "").strip()
        url = urljoin(PORTAL_URL, raw_url)
        if not title or not is_official_url(url) or "issuer-announcements-details" not in url:
            raise ValueError("official feed returned an invalid announcement")
        source_published_at = item.get("newsDateStr")
        announcements.append(
            OfficialAnnouncement(
                title=title,
                url=url,
                retrieved_at=retrieved_at,
                symbol=str(item.get("SYMBOL") or "").strip() or None,
                published_at=_published_at(source_published_at),
                source_published_at=(
                    source_published_at.strip()
                    if isinstance(source_published_at, str) and source_published_at.strip()
                    else None
                ),
            )
        )
    return announcements, total_count


def collect_official_announcements(session, retrieved_at: str, lookback_days: int = 7) -> list[OfficialAnnouncement]:
    """Fetch the session-scoped official feed with one retry per request."""
    if lookback_days < 1:
        raise ValueError("lookback_days must be positive")
    portal = _request_with_retry(
        lambda: session.get(PORTAL_URL, headers={"User-Agent": USER_AGENT}, timeout=20)
    )
    parser = _AnnouncementAnchorParser()
    parser.feed(portal.text)
    endpoint_match = _ANNOUNCEMENT_ENDPOINT.search(portal.text)
    if not parser.base_href or not endpoint_match:
        raise ValueError("official announcement feed endpoint was not present")
    endpoint = urljoin(parser.base_href, endpoint_match.group(0))

    common_data = {
        "annoucmentType": "1_-1",
        "symbol": "",
        "sectorDpId": "-1",
        "searchType": "1",
        "fromDate": "",
        "toDate": "",
        "datePeriod": _period_for_days(lookback_days),
        "productType": "",
        "advisorsList": "-1",
        "textSearch": "",
        "pageSize": str(_PAGE_SIZE),
    }
    headers = {
        "Referer": PORTAL_URL,
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
    }
    found: dict[str, OfficialAnnouncement] = {}
    page_number = 1
    page_count = 1
    while page_number <= page_count:
        data = {**common_data, "pageNumberDb": str(page_number)}
        response = _request_with_retry(
            lambda data=data: session.post(
                endpoint, data=data, headers=headers, timeout=20
            )
        )
        try:
            payload = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise ValueError("official announcement feed returned non-JSON content") from exc
        announcements, total_count = _parse_feed(payload, retrieved_at)
        for announcement in announcements:
            found.setdefault(announcement.url, announcement)
        page_count = max(1, math.ceil(total_count / _PAGE_SIZE))
        page_number += 1
    return list(found.values())


def write_review_queue(path: Path, announcements: list[OfficialAnnouncement], retrieved_at: str, *, receipt: dict | None = None) -> None:
    """Atomically replace a queue only after a successful collection."""
    payload = {
        "status": "review-required",
        "source": "Saudi Exchange issuer announcements",
        "retrievedAt": retrieved_at,
        "announcements": [asdict(item) for item in announcements],
    }
    if receipt is not None:
        payload["receipt"] = receipt
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def append_event_archive(path: Path, announcements: list[OfficialAnnouncement]) -> None:
    """Persist directly verified announcements with their first observation time.

    The review queue is deliberately replaceable; the event archive is append-only
    so later validation cannot backdate when an announcement was first seen.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for announcement in announcements:
            if not (announcement.symbol and announcement.published_at):
                continue
            handle.write(json.dumps({
                "title": announcement.title,
                "url": announcement.url,
                "symbol": announcement.symbol,
                "published_at": announcement.published_at,
                "observed_at": announcement.retrieved_at,
            }, ensure_ascii=False) + "\n")
