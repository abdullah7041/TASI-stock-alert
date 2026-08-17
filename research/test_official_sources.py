from pathlib import Path

import main
from research import official_sources


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
