"""Regression guarantees for the dated cockpit and concise notification contract."""

from datetime import date

import artifacts
import session_gate
import notify
import summary_contract


def test_an_old_watchlist_quote_cannot_be_presented_as_a_current_opportunity():
    """A new artifact save time must not refresh a quote from two sessions ago."""
    record = artifacts.decision_record(
        {"kind": "watchlist", "code": "4016", "name": "Avalon", "action": "WATCH",
         "verified": True, "price": 63.35, "priceDate": "2026-10-11"},
        [], trade_date="2026-10-13",
    )
    assert record["decision"]["label"] == "Insufficient data"
    assert "2026-10-11" in record["decision"]["reason"]


def test_the_previous_completed_trading_date_skips_weekends_and_recorded_holidays():
    """Both delivery surfaces need the same calendar cutoff, not duplicate guesses."""
    assert session_gate.previous_trading_date(date(2026, 10, 11), holidays=set()) == "2026-10-08"
    assert session_gate.previous_trading_date(date(2026, 9, 24), holidays={"2026-09-23"}) == "2026-09-22"


def brief_fixture():
    return {
        "tradeDate": "2026-10-13", "asOf": "2026-10-13T05:30:00Z",
        "expectedPriceDate": "2026-10-12", "regime": "unknown", "warnings": [],
        "portfolio": {"policyStatus": "unconfigured", "accountBook": {"accounts": [
            {"initialized": False}, {"initialized": False}]}},
        "summaryV1": {"cards": [{"kind": "portfolio", "state": "evidence-pending",
                               "text": "Confirm your broker account opening snapshots."}]},
        "digestRecords": [{"code": str(4000 + i), "name": "A long company name " * 10,
                           "kind": "watchlist", "price": 60, "priceDate": "2026-10-12",
                           "delta": {"trend_flipped": True}, "news": {"ok": False}}
                          for i in range(8)],
    }


def test_the_normal_daily_digest_is_one_short_message_with_dated_quotes_and_no_chart_dump():
    """Long company names must not cause the everyday digest to become several posts."""
    embeds = notify.build_digest_embeds(artifact=brief_fixture())
    assert len(embeds) == 1
    text = embeds[0]["title"] + embeds[0]["description"]
    assert len(text) <= 900
    assert "2026-10-12" in text
    assert "opening" in text
    assert "news" in text.lower() and "unavailable" in text.lower()
    assert "attachment://" not in text and "Forecast" not in text
    assert text.count("Trend changed") <= 3
    assert "workers.dev" in text


def test_relevant_updates_ignore_old_or_unrelated_events_and_deduplicate_status_transitions():
    """A repeated news item or provider failure must not notify on every scheduled run."""
    snapshot = brief_fixture()
    snapshot["digestRecords"] = [snapshot["digestRecords"][0]]
    event = {"symbol": "4000", "title": "Results published",
             "url": "https://www.saudiexchange.sa/wps/issuer-announcements-details/result",
             "published_at": "2026-10-13T04:00:00Z"}
    prior = {}
    updates, next_state = summary_contract.notification_updates(snapshot, prior, tracked_codes={"4000"},
                                               events=[event, {**event, "symbol": "9999"}])
    assert len([u for u in updates if u["kind"] == "event"]) == 1
    assert any(u["kind"] == "health" for u in updates)
    repeated, _ = summary_contract.notification_updates(snapshot, next_state, tracked_codes={"4000"}, events=[event])
    assert repeated == []
    snapshot["digestRecords"][0]["news"] = {"ok": True, "headlines": []}
    recovered, _ = summary_contract.notification_updates(snapshot, next_state, tracked_codes={"4000"}, events=[])
    assert len(recovered) == 1 and "restored" in recovered[0]["text"]
    old = {**event, "published_at": "2026-09-01T04:00:00Z"}
    assert not any(u["kind"] == "event" for u in summary_contract.notification_updates(
        snapshot, {}, tracked_codes={"4000"}, events=[old])[0])
