"""Conservative collection of public Saudi Exchange announcement links.

This module intentionally produces candidates for review, never financial
metric grades. Validated evidence remains the only input to the Top 10.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse


OFFICIAL_HOST = "www.saudiexchange.sa"
PORTAL_URL = (
    "https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/"
    "issuer-news/issuer-announcements?locale=en"
)
USER_AGENT = "TASI-Action-Cockpit/1.0 (+official-source-review-queue)"


@dataclass(frozen=True)
class OfficialAnnouncement:
    title: str
    url: str
    retrieved_at: str


class _AnnouncementAnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.anchors: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
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


def collect_official_announcements(session, retrieved_at: str, lookback_days: int = 7) -> list[OfficialAnnouncement]:
    """Fetch the documented public portal with one retry for transient failure."""
    if lookback_days < 1:
        raise ValueError("lookback_days must be positive")
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            response = session.get(PORTAL_URL, headers={"User-Agent": USER_AGENT}, timeout=20)
            response.raise_for_status()
            return parse_official_announcements(response.text, retrieved_at)
        except Exception as exc:
            last_error = exc
            if attempt == 1:
                raise
    raise RuntimeError("official portal collection failed") from last_error


def write_review_queue(path: Path, announcements: list[OfficialAnnouncement], retrieved_at: str) -> None:
    """Atomically replace a queue only after a successful collection."""
    payload = {
        "status": "review-required",
        "source": "Saudi Exchange issuer announcements",
        "retrievedAt": retrieved_at,
        "announcements": [asdict(item) for item in announcements],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)
