from __future__ import annotations

import json

from research.event_study import (
    event_outcomes,
    link_anomaly,
    main,
    normalize_events,
    validation_report,
    walk_forward,
)


def event(symbol="8200", observed="2026-09-10T05:00:00Z", published="2026-09-10T04:00:00Z", url="https://www.saudiexchange.sa/news/1"):
    return {"symbol": symbol, "title": "Verified insurance announcement", "url": url,
            "published_at": published, "observed_at": observed}


def test_event_becomes_available_only_after_publication_and_observation():
    rows, rejected = normalize_events([event()])
    assert not rejected
    assert rows[0]["available_at"] == "2026-09-10T05:00:00+00:00"


def test_legacy_date_only_and_news_redirects_are_not_backdated_into_events():
    rows, rejected = normalize_events([
        {**event(), "observed_at": "2026-09-10"},
        event(url="https://news.google.com/rss/articles/lead"),
    ])
    assert rows == []
    assert rejected == {"missing precise timestamp": 1, "unverified source URL": 1}


def test_duplicates_keep_the_earliest_observation_for_one_symbol():
    later = event(observed="2026-09-10T06:00:00Z")
    earlier = event(observed="2026-09-10T05:00:00Z")
    rows, _ = normalize_events([later, earlier])
    assert len(rows) == 1
    assert rows[0]["observed_at"] == "2026-09-10T05:00:00+00:00"


def test_pre_open_event_uses_that_day_open_and_matched_benchmark_close():
    events, _ = normalize_events([event()])
    histories = {
        "TASI": [{"date": "2026-09-10", "open": 100, "close": 101},
                 {"date": "2026-09-13", "open": 100, "close": 102}],
        "8200": [{"date": "2026-09-10", "open": 10, "close": 10.5},
                 {"date": "2026-09-13", "open": 10, "close": 11}],
    }
    row = event_outcomes(events, histories, horizon=1)[0]
    assert row["entry_date"] == "2026-09-10"
    assert row["return_pct"] == 5.0
    assert round(row["excess_return_pct"], 6) == 4.0
    assert row["outcome"] == 1


def test_incomplete_reaction_window_is_censored_not_scored_negative():
    events, _ = normalize_events([event()])
    row = event_outcomes(events, {"TASI": [], "8200": []}, horizon=5)[0]
    assert row["status"] == "censored"
    assert "outcome" not in row


def test_reaction_window_is_censored_when_an_intermediate_stock_session_is_missing():
    events, _ = normalize_events([event()])
    dates = ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"]
    histories = {
        "TASI": [{"date": day, "open": 100, "close": 101} for day in dates],
        "8200": [
            {"date": day, "open": 10, "close": 11}
            for day in dates if day != "2026-09-15"
        ],
    }

    row = event_outcomes(events, histories, horizon=5)[0]

    assert row["status"] == "censored"
    assert row["reason"] == "unmatched stock dates"


def test_later_news_does_not_rewrite_an_unexplained_move():
    events, _ = normalize_events([event(observed="2026-09-10T07:00:00Z")])
    linked = link_anomaly("2026-09-10T06:00:00Z", "8200", events, "empty")
    assert linked["status"] == "unexplained"
    assert linked["timely_events"] == []
    assert linked["possible_later_explanations"] == [events[0]["event_id"]]
    assert linked["causation"] == "not-proven"


def complete(event_id, available, label_available, outcome, event_class="saudiexchange.sa", symbol="8200"):
    return {"event_id": event_id, "symbol": symbol, "event_class": event_class,
            "available_at": available, "label_available_at": label_available,
            "horizon_sessions": 5, "status": "complete", "outcome": outcome}


def test_walk_forward_uses_only_labels_known_before_each_decision():
    rows = [
        complete("train-known", "2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 1),
        complete("train-unresolved", "2026-01-02T00:00:00Z", "2026-03-01T00:00:00Z", 0),
        complete("test", "2026-02-01T00:00:00Z", "2026-02-10T00:00:00Z", 1),
    ]
    predictions = walk_forward(rows, min_training_events=1)
    test_prediction = next(row for row in predictions if row["event_id"] == "test")
    assert test_prediction["training_events"] == 1
    assert test_prediction["latest_training_label"] == "2026-01-10T00:00:00Z"


def test_walk_forward_compares_timestamp_instants_not_iso_text():
    rows = [
        complete("train", "2026-01-01T00:00:00Z", "2026-01-10T03:00:00+03:00", 1),
        complete("test", "2026-01-10T00:30:00Z", "2026-01-20T00:00:00Z", 0),
    ]

    prediction = next(row for row in walk_forward(rows, 1) if row["event_id"] == "test")

    assert prediction["training_events"] == 1


def test_walk_forward_uses_every_related_stock_with_equal_event_weight():
    rows = [
        complete("training-event", "2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 1, symbol="1111"),
        complete("training-event", "2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z", 0, symbol="2222"),
        complete("test-event", "2026-02-01T00:00:00Z", "2026-02-10T00:00:00Z", 1),
    ]

    prediction = next(row for row in walk_forward(rows, 1) if row["event_id"] == "test-event")

    assert prediction["training_events"] == 1
    assert prediction["base_probability"] == 0.5


def test_validation_report_never_enables_probability_release():
    report = validation_report([], [])
    assert report["status"] == "unavailable"
    assert report["probability_release_enabled"] is False
    assert report["release_blockers"]


def test_cli_reports_legacy_archive_as_ineligible_instead_of_backdating(tmp_path):
    news_path = tmp_path / "legacy.jsonl"
    output_path = tmp_path / "report.json"
    news_path.write_text(json.dumps({
        "date": "2026-09-10", "code": "8200", "title": "Lead",
        "link": "https://news.google.com/rss/articles/lead",
        "published": "Wed, 10 Sep 2026 04:00:00 GMT",
    }) + "\n", encoding="utf-8")

    assert main(["--news", str(news_path), "--output", str(output_path)]) == 0

    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["events"] == []
    assert payload["exclusions"] == {"missing precise timestamp": 1}
    assert payload["report"]["data_status"] == "missing-bars"


def test_cli_labels_an_empty_benchmark_file_as_empty_not_available(tmp_path):
    news_path = tmp_path / "events.jsonl"
    bars_path = tmp_path / "bars.json"
    output_path = tmp_path / "report.json"
    news_path.write_text(json.dumps(event()) + "\n", encoding="utf-8")
    bars_path.write_text(json.dumps({"TASI": []}), encoding="utf-8")

    assert main(["--news", str(news_path), "--bars", str(bars_path), "--output", str(output_path)]) == 0

    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["report"]["data_status"] == "empty-bars"
