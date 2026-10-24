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
    monkeypatch.setattr(main, "EVIDENCE_COLLECTION_FILE", tmp_path / "collection.json")
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
    monkeypatch.setattr(main, "EVIDENCE_COLLECTION_FILE", tmp_path / "collection.json")
    monkeypatch.setattr(main, "EVENT_ARCHIVE_FILE", archive)
    monkeypatch.setattr(main.official_sources, "collect_official_announcements", lambda *_args, **_kwargs: [announcement])

    assert main.mode_research_evidence() == 0

    import json
    assert json.loads(archive.read_text(encoding="utf-8").strip())["observed_at"].endswith("Z")


def test_failed_attempt_persists_a_failure_receipt_without_replacing_evidence(monkeypatch, tmp_path):
    """A failed source must not keep looking like its last successful collection."""
    queue = tmp_path / "queue.json"
    queue.write_text('{"announcements":[{"title":"old"}]}', encoding="utf-8")
    receipt = tmp_path / "receipt.json"
    monkeypatch.setattr(main, "EVIDENCE_QUEUE_FILE", queue)
    monkeypatch.setattr(main, "EVIDENCE_COLLECTION_FILE", receipt)
    monkeypatch.setattr(main.official_sources, "collect_official_announcements", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("HTTP 403")))
    assert main.mode_research_evidence(attempted_at="2026-10-22T05:15:00Z", run_id="run-1") == 1
    data = __import__('json').loads(receipt.read_text())
    assert data["receipt"] == {"runId":"run-1","attemptedAt":"2026-10-22T05:15:00Z","status":"failed","count":0,"error":"Official source collection failed (RuntimeError)."}
    assert __import__('json').loads(queue.read_text())["announcements"][0]["title"] == "old"


def test_successful_empty_attempt_is_distinct_from_failure(monkeypatch, tmp_path):
    """A completed zero-result check is dated and carries no invented evidence."""
    monkeypatch.setattr(main, "EVIDENCE_QUEUE_FILE", tmp_path / "queue.json")
    monkeypatch.setattr(main, "EVIDENCE_COLLECTION_FILE", tmp_path / "receipt.json")
    monkeypatch.setattr(main, "EVENT_ARCHIVE_FILE", tmp_path / "archive.jsonl")
    monkeypatch.setattr(main.official_sources, "collect_official_announcements", lambda *_a, **_k: [])
    assert main.mode_research_evidence(attempted_at="2026-10-22T05:15:00Z", run_id="run-2") == 0
    data = __import__('json').loads((tmp_path / "receipt.json").read_text())
    assert data["receipt"]["status"] == "empty"
    assert data["receipt"]["count"] == 0
    assert data["announcements"] == []


def test_holding_notifications_deduplicate_updates_and_retry_failed_delivery(monkeypatch, tmp_path):
    """Source failure churn must stay quiet; failed Discord delivery must remain retryable."""
    import json
    summary = tmp_path / "summary.json"
    state = tmp_path / "state.json"
    payload={"generatedAt":"2026-10-22T12:30:00Z","collection":{"runId":"one","attemptedAt":"2026-10-22T12:30:00Z","status":"content","count":1},"items":[{"symbol":"1150","name":"Example","reviewId":"review-1","status":"provisional","changed":"New dated filing","sourceRefs":["https://www.saudiexchange.sa/filing"]}],"notices":[]}
    summary.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(main,"HOLDING_REVIEWS_FILE",summary)
    monkeypatch.setattr(main,"STATE_FILE",state)
    messages=[]
    monkeypatch.setattr(main.nt,"send_discord",lambda text: messages.append(text) or False)
    assert main.mode_holding_reviews_notify()==1
    assert "?view=assistant" in messages[0]
    assert "?view=research" in main.nt.build_relevant_update_message([{"text":"Research notice"}],payload["generatedAt"])
    assert not state.exists()
    monkeypatch.setattr(main.nt,"send_discord",lambda text: messages.append(text) or True)
    assert main.mode_holding_reviews_notify()==0
    assert main.mode_holding_reviews_notify()==0
    assert len(messages)==2
    payload["collection"].update(status="failed",runId="two",count=0)
    summary.write_text(json.dumps(payload),encoding="utf-8")
    assert main.mode_holding_reviews_notify()==0
    assert "failed" in messages[-1].lower()
    payload["collection"]["runId"]="three"
    summary.write_text(json.dumps(payload),encoding="utf-8")
    assert main.mode_holding_reviews_notify()==0
    assert len(messages)==3
    payload["collection"].update(status="empty",runId="four")
    summary.write_text(json.dumps(payload),encoding="utf-8")
    assert main.mode_holding_reviews_notify()==0
    assert len(messages)==4
    assert "empty" in messages[-1].lower()


def test_morning_brief_distinguishes_failed_empty_and_content_official_checks():
    """A source outage cannot read like a quiet portfolio in the routine digest."""
    import notify
    snapshot={"holdingReviews":{"collection":{"status":"failed","attemptedAt":"2026-10-22T05:15:00Z"},"items":[],"notices":[]}}
    assert "failed" in notify.build_dashboard_digest(snapshot).lower()
    snapshot["holdingReviews"]["collection"]["status"]="empty"
    assert "empty" in notify.build_dashboard_digest(snapshot).lower()
    snapshot["holdingReviews"]["collection"].update(status="content",count=2)
    assert "2" in notify.build_dashboard_digest(snapshot)


def test_workflow_collects_twice_on_trading_days_without_replacing_the_morning_digest():
    """Collection and review refresh are independent of reconciliation delivery success."""
    text=Path(".github/workflows/tasi.yml").read_text(encoding="utf-8")
    assert 'cron: "15 5 * * 0,1,2,3,4"' in text
    assert 'cron: "30 5 * * 0,1,2,3,4"' in text
    assert 'cron: "30 12 * * 0,1,2,3,4"' in text
    assert "HOLDING_REVIEWS_ENABLED" in text
    assert "MODE: holding-reviews-notify" in text
    assert "@research/evidence_collection.json" in text


def test_workflow_can_qualify_authenticated_storage_before_enabling_ai_reviews():
    """A staged release needs a read receipt even while review generation is disabled."""
    import yaml
    workflow = yaml.safe_load(Path(".github/workflows/tasi.yml").read_text(encoding="utf-8"))
    step = next((step for step in workflow["jobs"]["watch"]["steps"]
                 if step.get("id") == "holding_status"), None)
    assert step is not None
    assert "steps.evidence_ingest.outcome == 'success'" in step["if"]
    assert "HOLDING_REVIEWS_ENABLED" not in step["if"]
    assert '"$COCKPIT_ORIGIN/api/holding-reviews"' in step["run"]
    assert "holding_summary_read=success" in step["run"]


def test_manual_release_checks_commit_state_to_their_checked_out_branch():
    """A shallow feature checkout rebased on main produced add/add conflicts after successful ingestion."""
    import yaml
    steps = yaml.safe_load(Path(".github/workflows/tasi.yml").read_text(encoding="utf-8"))["jobs"]["watch"]["steps"]
    checkout = next(step for step in steps if step.get("uses", "").startswith("actions/checkout@"))
    commit = next(step for step in steps if step.get("name") == "Commit state")
    assert checkout.get("with", {}).get("fetch-depth") == 0
    assert 'git pull --rebase origin "$(git branch --show-current)"' in commit["run"]


def test_malformed_official_feed_does_not_masquerade_as_successful_empty():
    """Feed schema drift must retain previous evidence and produce a failed receipt."""
    import pytest
    class InvalidFeed(_PortalSession):
        def post(self,*args,**kwargs):
            return _Response('{"announcementList":[{"unexpected":"schema"}],"totalCount":1}')
    with pytest.raises(ValueError,match="invalid announcement"):
        official_sources.collect_official_announcements(InvalidFeed(),"2026-10-22T05:15:00Z")


def test_source_receipt_survives_an_unrelated_local_archive_failure(monkeypatch,tmp_path):
    """A failed local append must not make ingestion replay an older source attempt."""
    import json
    import pytest
    monkeypatch.setattr(main,"EVIDENCE_QUEUE_FILE",tmp_path / "queue.json")
    monkeypatch.setattr(main,"EVIDENCE_COLLECTION_FILE",tmp_path / "receipt.json")
    monkeypatch.setattr(main.official_sources,"collect_official_announcements",lambda *_a,**_k:[])
    monkeypatch.setattr(main.official_sources,"append_event_archive",lambda *_a:(_ for _ in ()).throw(OSError("archive unavailable")))
    with pytest.raises(OSError,match="archive unavailable"):
        main.mode_research_evidence(attempted_at="2026-10-22T12:30:00Z",run_id="fresh-attempt")
    assert json.loads((tmp_path / "receipt.json").read_text())["receipt"]["runId"]=="fresh-attempt"
