"""Offline tests for the Stage 0 base-rate study. No network, no disk I/O
beyond what pytest's tmp_path gives a test — mirrors test_core.py's convention."""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from research.base_rate import base_rate_report, forward_max_return_pct, label_rockets


def _ohlc(closes):
    closes = list(closes)
    return pd.DataFrame({
        "Open": closes, "High": [c * 1.01 for c in closes],
        "Low": [c * 0.99 for c in closes], "Close": closes,
    })


def test_forward_max_return_flat_price_is_near_zero():
    df = _ohlc([100] * 100)
    fwd = forward_max_return_pct(df, t=10, window=60)
    assert fwd is not None
    assert abs(fwd) < 2.0  # High is 1% above Close, so max is ~+1%, not exactly 0.


def test_forward_max_return_catches_a_spike_mid_window():
    closes = [100] * 20 + [130] + [101] * 79  # spike at t+21
    df = _ohlc(closes)
    fwd = forward_max_return_pct(df, t=10, window=60)
    assert fwd > 25.0  # High of the spike bar is ~131.3, entry ~101 -> ~30%.


def test_forward_max_return_none_when_not_enough_future_bars():
    df = _ohlc([100] * 50)
    fwd = forward_max_return_pct(df, t=48, window=60)  # only 1 bar left after t+1.
    assert fwd is None


def test_forward_max_return_none_at_end_of_history():
    df = _ohlc([100] * 50)
    fwd = forward_max_return_pct(df, t=49, window=60)  # no bar after t at all.
    assert fwd is None


def test_label_rockets_drops_rows_with_no_future_data():
    feat = pd.DataFrame({"code": ["X", "X"], "date": pd.to_datetime(["2020-01-01", "2020-06-01"]),
                        "t": [10, 200]})
    hist = {"X": _ohlc([100] * 250)}
    labeled = label_rockets(feat, hist, threshold=15.0, window=60)
    assert len(labeled) == 1  # the t=200 row has no bar t+1 within a 250-bar frame minus buffer.
    assert labeled.iloc[0]["t"] == 10


def test_label_rockets_flags_is_rocket_correctly():
    feat = pd.DataFrame({"code": ["X"], "date": pd.to_datetime(["2020-01-01"]), "t": [10]})
    closes = [100] * 20 + [140] + [101] * 200  # clear spike, well above +15%.
    hist = {"X": _ohlc(closes)}
    labeled = label_rockets(feat, hist, threshold=15.0, window=60)
    assert bool(labeled.iloc[0]["is_rocket"]) is True


def test_label_rockets_skips_codes_missing_from_hist():
    feat = pd.DataFrame({"code": ["MISSING"], "date": pd.to_datetime(["2020-01-01"]), "t": [10]})
    labeled = label_rockets(feat, {}, threshold=15.0, window=60)
    assert labeled.empty


def test_base_rate_report_empty_input():
    rep = base_rate_report(pd.DataFrame())
    assert rep == {"rows": 0, "positives": 0, "base_rate_pct": None, "by_year": {}}


def test_base_rate_report_computes_overall_and_by_year():
    labeled = pd.DataFrame({
        "date": pd.to_datetime(["2020-01-01", "2020-06-01", "2021-01-01", "2021-06-01"]),
        "is_rocket": [True, False, False, False],
    })
    rep = base_rate_report(labeled)
    assert rep["rows"] == 4
    assert rep["positives"] == 1
    assert rep["base_rate_pct"] == 25.0
    assert rep["by_year"][2020]["positives"] == 1
    assert rep["by_year"][2020]["rows"] == 2
    assert rep["by_year"][2021]["positives"] == 0
    assert rep["by_year"][2021]["base_rate_pct"] == 0.0
