"""Regression guarantees for the dated cockpit and concise notification contract."""

from datetime import date

import artifacts
import session_gate


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
