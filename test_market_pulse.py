"""Contract tests for the observational delayed market-pulse artifact."""

import pandas as pd

import main
import market_pulse


def _bars(values, timestamps):
    return pd.DataFrame({"Close": values}, index=pd.to_datetime(timestamps, utc=True))


def test_market_pulse_is_current_only_with_index_and_seventy_percent_stock_coverage():
    """A mostly-empty source must not look like a quiet, current market."""
    result = market_pulse.build_market_pulse(
        {
            "^TASI.SR": _bars([11000.0, 11010.0], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z"]),
            "1303": _bars([15.0, 15.3], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z"]),
            "2320": _bars([60.0, 60.1], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z"]),
            "4164": _bars([90.0, 90.2], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z"]),
        },
        _bars(range(100, 152), pd.date_range("2026-07-01", periods=52, freq="B", tz="UTC")),
        ["1303", "2320", "4164", "6017"],
        source="yahoo-probe", fetched_at="2026-09-22T07:20:00Z", declared_delay_minutes=15,
    )

    assert result["status"] == "current"
    assert result["coverage"] == {"tracked": 4, "usable": 3, "required": 3}
    assert result["regime"]["status"] == "available"
    assert result["index"]["latestBarAt"] == "2026-09-22T07:15:00Z"
    assert {item["code"] for item in result["observations"]} == {"1303", "2320", "4164"}


def test_market_pulse_keeps_the_last_valid_artifact_as_stale_on_source_failure():
    """A transient fetch failure must preserve the last real pulse rather than erase it."""
    previous = {
        "status": "current", "fetchedAt": "2026-09-22T07:20:00Z", "observations": [{"code": "1303", "price": 15.3}],
        "coverage": {"tracked": 1, "usable": 1, "required": 1},
    }

    result = market_pulse.build_market_pulse(
        {"^TASI.SR": pd.DataFrame(), "1303": pd.DataFrame()}, pd.DataFrame(), ["1303"],
        source="yahoo-probe", fetched_at="2026-09-22T07:25:00Z", declared_delay_minutes=15, prior=previous,
    )

    assert result["status"] == "stale"
    assert result["fetchedAt"] == "2026-09-22T07:25:00Z"
    assert result["lastValidAt"] == "2026-09-22T07:20:00Z"
    assert result["observations"] == [{"code": "1303", "price": 15.3}]
    assert "index" in result["reason"].lower()


def test_market_pulse_excludes_an_open_five_minute_bar_from_the_completed_observation():
    """A bar stamped at fetch time is still forming, not evidence of a pulse."""
    result = market_pulse.build_market_pulse(
        {
            "^TASI.SR": _bars([11000.0, 11010.0, 11030.0], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z", "2026-09-22T07:20:00Z"]),
            "1303": _bars([15.0, 15.3, 15.6], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z", "2026-09-22T07:20:00Z"]),
        },
        _bars(range(100, 152), pd.date_range("2026-07-01", periods=52, freq="B", tz="UTC")), ["1303"],
        source="yahoo-probe", fetched_at="2026-09-22T07:20:00Z", declared_delay_minutes=15,
    )

    assert result["status"] == "current"
    assert result["index"]["latestBarAt"] == "2026-09-22T07:15:00Z"
    assert result["observations"][0]["price"] == 15.3


def test_market_pulse_does_not_fabricate_a_regime_from_one_index_point():
    """The SAHMK summary fallback is one point, not the 50-session series a regime needs."""
    result = market_pulse.build_market_pulse(
        {
            "^TASI.SR": _bars([11000.0, 11010.0], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z"]),
            "1303": _bars([15.0, 15.3], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z"]),
        },
        _bars([11010.0], ["2026-09-21T12:00:00Z"]), ["1303"],
        source="yahoo-probe", fetched_at="2026-09-22T07:20:00Z", declared_delay_minutes=15,
    )

    assert result["status"] == "current"
    assert result["regime"] == {"status": "unavailable", "reason": "Market regime unavailable: the index returned 1 usable daily bars; 50 are required."}


def test_market_pulse_mode_writes_an_observation_without_notifying_or_deciding(monkeypatch, tmp_path):
    """The five-minute path is a stored observation, never a hidden alert path."""
    pulse_path = tmp_path / "market_pulse.json"
    frames = {
        "^TASI.SR": _bars([11000.0, 11010.0], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z"]),
        "1303": _bars([15.0, 15.3], ["2026-09-22T07:10:00Z", "2026-09-22T07:15:00Z"]),
    }
    daily = _bars(range(100, 152), pd.date_range("2026-07-01", periods=52, freq="B", tz="UTC"))
    monkeypatch.setattr(main, "MARKET_PULSE_FILE", pulse_path)
    monkeypatch.setattr(main, "_holdings", lambda: [{"code": "1303"}])
    monkeypatch.setattr(main.cfg, "WATCHLIST", [])
    monkeypatch.setattr(main, "_active_top10", lambda: None)
    monkeypatch.setattr(main.dat, "get_intraday_histories", lambda codes, **_kwargs: {code: frames[code] for code in codes})
    monkeypatch.setattr(main.dat, "get_qualified_index_history", lambda *_args, **_kwargs: daily)
    monkeypatch.setattr(main.nt, "send_discord", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("pulse must not notify")))
    monkeypatch.setattr(main.time, "strftime", lambda *_args, **_kwargs: "2026-09-22T07:20:00Z")

    assert main.mode_market_pulse() == 0
    saved = main._load(pulse_path, {})
    assert saved["status"] == "current"
    assert saved["observations"][0]["code"] == "1303"
