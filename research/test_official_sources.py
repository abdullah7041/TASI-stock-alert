from pathlib import Path

import main
from research import official_sources


class _Response:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _PortalSession:
    def __init__(self):
        self.posts = []

    def get(self, url, **_kwargs):
        assert url == official_sources.PORTAL_URL
        return _Response(
            '<base href="https://www.saudiexchange.sa/wps/portal/saudiexchange/'
            'newsandreports/issuer-news/issuer-announcements/!ut/p/z1/session/">'
            "<script>var endpoint = 'p0/IZ7_PORTLET=NJgetAnnouncementListData=/';</script>"
        )

    def post(self, url, data, **_kwargs):
        self.posts.append((url, data.copy()))
        page = int(data["pageNumberDb"])
        announcements = [
            {
                "SYMBOL": "8200" if page == 1 else "8010",
                "SHORT_DESC": "Insurance regulation update" if page == 1 else "Cooperative insurance follow-up",
                "announcementUrl": (
                    "/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements/"
                    f"issuer-announcements-details/?anId={page}&anCat=1&cs=8200&locale=en"
                ),
                "newsDateStr": "16/09/2026 09:47:56",
            }
        ]
        import json

        return _Response(json.dumps({"announcementList": announcements, "totalCount": 101}))


def test_parser_keeps_only_official_announcement_links():
    html = Path("research/fixtures/official_announcements.html").read_text(encoding="utf-8")

    records = official_sources.parse_official_announcements(html, "2026-08-17T05:15:00Z")

    assert [record.url for record in records] == [
        "https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements/issuer-announcements-details/example",
        "https://www.saudiexchange.sa/Resources/fsPdf/example.pdf",
    ]
    assert all(record.retrieved_at == "2026-08-17T05:15:00Z" for record in records)


def test_failed_collection_keeps_the_previous_review_queue(monkeypatch, tmp_path):
    queue = tmp_path / "evidence_queue.json"
    previous = '{"status": "ok", "announcements": [{"url": "https://www.saudiexchange.sa/Resources/fsPdf/old.pdf"}]}'
    queue.write_text(previous, encoding="utf-8")
    monkeypatch.setattr(main, "EVIDENCE_QUEUE_FILE", queue)
    monkeypatch.setattr(main.official_sources, "collect_official_announcements", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("portal unavailable")))

    assert main.mode_research_evidence() == 1
    assert queue.read_text(encoding="utf-8") == previous


def test_collector_uses_the_session_scoped_official_feed_and_paginates():
    """The static listing became Akamai-blocked; the official portlet is the durable source."""
    session = _PortalSession()

    records = official_sources.collect_official_announcements(
        session, "2026-09-16T10:00:00Z", lookback_days=7
    )

    assert [record.symbol for record in records] == ["8200", "8010"]
    assert all(record.published_at == "2026-09-16T09:47:56+03:00" for record in records)
    assert len(session.posts) == 2
    assert [post[1]["pageNumberDb"] for post in session.posts] == ["1", "2"]
    assert all(post[1]["datePeriod"] == "7 day" for post in session.posts)
    assert all("NJgetAnnouncementListData" in post[0] for post in session.posts)


def test_official_announcements_are_appended_as_point_in_time_event_records(tmp_path):
    archive = tmp_path / "event_archive.jsonl"
    announcement = official_sources.OfficialAnnouncement(
        title="Insurance regulation update",
        url="https://www.saudiexchange.sa/wps/portal/saudiexchange/news/1",
        symbol="8200",
        published_at="2026-09-16T09:47:56+03:00",
        retrieved_at="2026-09-16T10:00:00Z",
    )

    official_sources.append_event_archive(archive, [announcement])

    import json
    record = json.loads(archive.read_text(encoding="utf-8").strip())
    assert record == {
        "title": "Insurance regulation update",
        "url": "https://www.saudiexchange.sa/wps/portal/saudiexchange/news/1",
        "symbol": "8200",
        "published_at": "2026-09-16T09:47:56+03:00",
        "observed_at": "2026-09-16T10:00:00Z",
    }


def test_successful_collection_writes_a_durable_event_archive(monkeypatch, tmp_path):
    queue = tmp_path / "evidence_queue.json"
    archive = tmp_path / "event_archive.jsonl"
    announcement = official_sources.OfficialAnnouncement(
        title="Insurance regulation update",
        url="https://www.saudiexchange.sa/wps/portal/saudiexchange/news/1",
        symbol="8200",
        published_at="2026-09-16T09:47:56+03:00",
        retrieved_at="2026-09-16T10:00:00Z",
    )
    monkeypatch.setattr(main, "EVIDENCE_QUEUE_FILE", queue)
    monkeypatch.setattr(main, "EVENT_ARCHIVE_FILE", archive)
    monkeypatch.setattr(main.official_sources, "collect_official_announcements", lambda *_args, **_kwargs: [announcement])

    assert main.mode_research_evidence() == 0

    import json
    assert json.loads(archive.read_text(encoding="utf-8").strip())["observed_at"].endswith("Z")
