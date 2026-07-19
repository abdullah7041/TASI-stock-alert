"""
Offline unit tests. No network. Run: python -m pytest -q  (or python test_core.py)

Covers the logic that decisions depend on: RSI, trend, support/resistance,
regime filter, conviction, position sizing, level derivation, and the two
evaluators. Data is synthetic so these are deterministic.
"""

import numpy as np
import pandas as pd

import indicators as ind
import analyze as az
import news
import notify as nt


def _frame(closes, highs=None, lows=None):
    closes = list(closes)
    highs = highs or [c * 1.01 for c in closes]
    lows = lows or [c * 0.99 for c in closes]
    return pd.DataFrame({
        "Open": closes, "High": highs, "Low": lows,
        "Close": closes, "Volume": [1000] * len(closes),
    })


# --- RSI --------------------------------------------------------------------
def test_rsi_all_gains_is_100():
    assert ind.rsi(range(1, 40)) == 100.0

def test_rsi_all_losses_is_low():
    assert ind.rsi(range(40, 1, -1)) < 5

def test_rsi_insufficient_data_is_nan():
    assert np.isnan(ind.rsi([1, 2, 3]))

def test_rsi_midrange_between_0_and_100():
    prices = [10 + (i % 5) - 2 for i in range(60)]  # choppy
    r = ind.rsi(prices)
    assert 0 <= r <= 100


# --- trend ------------------------------------------------------------------
def test_trend_up():
    assert ind.trend(list(range(1, 120)), 20, 50) == "up"

def test_trend_down():
    assert ind.trend(list(range(120, 1, -1)), 20, 50) == "down"

def test_trend_unknown_when_short():
    assert ind.trend([1, 2, 3], 20, 50) == "unknown"


# --- support / resistance ---------------------------------------------------
def test_support_below_resistance_above():
    # V shape: falls to 90 then rises to 110, current ~105.
    closes = list(range(110, 89, -1)) + list(range(90, 106))
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    sup, res = ind.support_resistance(highs, lows, closes, lookback=60)
    price = closes[-1]
    assert sup is None or sup < price
    assert res is None or res > price


# --- regime -----------------------------------------------------------------
def test_regime_breakdown():
    df = _frame(list(range(200, 100, -1)))  # falling index
    assert az.market_regime(df, 50) == "breakdown"

def test_regime_ok_when_rising():
    df = _frame(list(range(100, 200)))
    assert az.market_regime(df, 50) == "ok"

def test_regime_unknown_when_empty():
    assert az.market_regime(pd.DataFrame(), 50) == "unknown"


# --- conviction -------------------------------------------------------------
def test_conviction_uptrend_beats_downtrend():
    cfg_t = {"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70}
    up_score = az.conviction_score("up", 55.0, cfg_t, 0.5)
    down_score = az.conviction_score("down", 55.0, cfg_t, 0.5)
    assert up_score > down_score
    assert 0 <= up_score <= 100 and 0 <= down_score <= 100


# --- BUY decision -----------------------------------------------------------
CRITERIA = {"conviction_min": 65, "conviction_min_breakdown": 80,
            "rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
GOOD_LONG = {"trend": "up", "momentum_pct": 10.0, "rsi": 45.0}

def test_buy_fires_when_all_criteria_met():
    ok, failed = az.buy_decision(90, 0.0, GOOD_LONG, "ok", CRITERIA)
    assert ok and not failed

def test_breakdown_raises_bar_instead_of_blocking():
    # conviction 70 passes in 'ok' regime but not the raised breakdown bar...
    assert az.buy_decision(70, 0.0, GOOD_LONG, "ok", CRITERIA)[0]
    assert not az.buy_decision(70, 0.0, GOOD_LONG, "breakdown", CRITERIA)[0]
    # ...yet a strong enough setup still fires in a breakdown (no hard veto).
    assert az.buy_decision(85, 0.0, GOOD_LONG, "breakdown", CRITERIA)[0]

def test_negative_news_vetoes_buy():
    ok, failed = az.buy_decision(90, -0.5, GOOD_LONG, "ok", CRITERIA)
    assert not ok and any("news" in f for f in failed)

def test_rsi_outside_recovery_band_vetoes_buy():
    hot = {**GOOD_LONG, "rsi": 75.0}
    assert not az.buy_decision(90, 0.0, hot, "ok", CRITERIA)[0]
    capitulating = {**GOOD_LONG, "rsi": 15.0}
    assert not az.buy_decision(90, 0.0, capitulating, "ok", CRITERIA)[0]

def test_deteriorating_long_term_vetoes_buy():
    bad = {"trend": "down", "momentum_pct": -20.0, "rsi": 45.0}
    ok, failed = az.buy_decision(90, 0.0, bad, "ok", CRITERIA)
    assert not ok and any("deteriorating" in f for f in failed)

def test_mild_long_weakness_allowed():
    soft = {"trend": "flat", "momentum_pct": -3.0, "rsi": 45.0}  # above -5 floor
    assert az.buy_decision(90, 0.0, soft, "ok", CRITERIA)[0]


# --- budget allocation ------------------------------------------------------
def _buy(code, conviction, price):
    return {"kind": "watchlist", "code": code, "name": code, "price": price,
            "action": "BUY", "conviction": conviction}

def test_allocate_whole_shares_within_budget():
    buys = [_buy("A", 90, 33.4), _buy("B", 60, 13.7)]
    summary = az.allocate_budget(buys, 500.0)
    total = sum(b["sizing"]["spend"] for b in buys if not b["sizing"].get("skip"))
    for b in buys:
        if not b["sizing"].get("skip"):
            assert b["sizing"]["shares"] == int(b["sizing"]["shares"])
            assert abs(b["sizing"]["shares"] * b["price"] - b["sizing"]["spend"]) < 0.01
    assert total <= 500.0 + 1e-9
    assert abs(summary["allocated"] - total) < 0.01
    assert abs(summary["leftover"] - (500.0 - total)) < 0.01

def test_allocate_higher_conviction_gets_more():
    buys = [_buy("A", 90, 10.0), _buy("B", 45, 10.0)]
    az.allocate_budget(buys, 500.0)
    a = next(b for b in buys if b["code"] == "A")["sizing"]["spend"]
    b_ = next(b for b in buys if b["code"] == "B")["sizing"]["spend"]
    assert a > b_

def test_allocate_min_one_share_when_slice_small_but_budget_allows():
    buys = [_buy("A", 90, 10.0), _buy("B", 10, 45.0)]  # B's slice ~45 SAR
    az.allocate_budget(buys, 500.0)
    assert next(b for b in buys if b["code"] == "B")["sizing"]["shares"] >= 1

def test_allocate_skips_share_pricier_than_budget():
    buys = [_buy("A", 95, 600.0)]
    summary = az.allocate_budget(buys, 500.0)
    assert buys[0]["sizing"]["shares"] == 0 and "skip" in buys[0]["sizing"]
    assert summary["allocated"] == 0.0 and summary["leftover"] == 500.0

def test_allocate_zero_budget_skips_all():
    buys = [_buy("A", 95, 10.0)]
    az.allocate_budget(buys, 0.0)
    assert buys[0]["sizing"]["skip"] == "monthly budget exhausted"


# --- position sizing --------------------------------------------------------
BASE_RISK = {
    "deployable_cash": 3000.0, "max_positions": 5, "position_pct": 0.25,
    "stop_loss_pct": 0.09, "max_single_pct": 0.35, "cash_buffer_pct": 0.12,
    "commission_rate": 0.00155, "min_commission": 0.0, "commission_floor_pct": 0.01,
}

def test_position_size_buys_whole_shares():
    r = az.position_size(20.0, BASE_RISK)
    assert r["shares"] >= 1
    assert r["spend"] <= 3000 * 0.35 + 0.001
    assert r["shares"] * 20.0 == r["spend"]

def test_position_size_skips_when_share_too_expensive():
    r = az.position_size(5000.0, BASE_RISK)  # one share > target spend
    assert r["shares"] == 0 and "skip" in r

def test_position_size_respects_single_name_cap():
    r = az.position_size(1.0, {**BASE_RISK, "position_pct": 0.99})
    assert r["spend"] <= 3000 * 0.35 + 1


# --- level derivation -------------------------------------------------------
def test_derive_levels_has_stop_below_buyzone():
    closes = list(range(110, 89, -1)) + list(range(90, 106))
    df = _frame(closes)
    tech = {"sr_lookback": 60}
    lv = az.derive_levels(df, tech, 0.09)
    if "buy_zone_low" in lv and "stop" in lv:
        assert lv["stop"] < lv["buy_zone_low"]


# --- evaluators ------------------------------------------------------------
def test_holding_stop_triggers_sell():
    df = _frame(list(range(100, 160)))
    h = {"code": "1303", "name": "EIC", "shares": 100, "avg_cost": 120.0}
    rec = az.evaluate_holding(h, price=110.0, df=df,
                              levels={"stop": 115.0}, horizon_cfg={
                                  "short_lookback_days": 10, "long_lookback_days": 50,
                                  "short_ma": 20, "long_ma": 50},
                              tech={"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70})
    assert rec["action"].startswith("SELL")

_WL_HORIZON = {"short_lookback_days": 10, "long_lookback_days": 50,
               "short_ma": 20, "long_ma": 50}
_WL_TECH = {"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70}

def test_watchlist_buy_fires_via_criteria_no_zone_needed():
    # Wide-open criteria isolate the wiring: no buy zone, uptrend frame -> BUY.
    df = _frame(list(range(1, 160)))
    w = {"code": "4015", "name": "Jamjoom", "sector": "pharma"}
    relaxed = {"conviction_min": 0, "conviction_min_breakdown": 0,
               "rsi_recovery_band": (0, 100), "long_mom_floor_pct": -100.0}
    rec = az.evaluate_watchlist(w, price=100.0, df=df, levels={},
                                regime="ok", risk=BASE_RISK,
                                horizon_cfg=_WL_HORIZON, tech=_WL_TECH,
                                buy_criteria=relaxed)
    assert rec["action"] == "BUY"
    assert rec["sizing"] is None  # sizing happens later, pooled per run.
    assert 0 <= rec["conviction"] <= 100

def test_watchlist_watch_when_criteria_fail_with_reason():
    df = _frame(list(range(1, 160)))
    w = {"code": "4015", "name": "Jamjoom", "sector": "pharma"}
    strict = {"conviction_min": 101, "conviction_min_breakdown": 101,
              "rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
    rec = az.evaluate_watchlist(w, price=100.0, df=df, levels={},
                                regime="breakdown", risk=BASE_RISK,
                                horizon_cfg=_WL_HORIZON, tech=_WL_TECH,
                                buy_criteria=strict)
    assert rec["action"] == "WATCH"
    assert any("conviction" in r for r in rec["reason"])


# --- news sentiment (offline, no fetch) ------------------------------------
def test_sentiment_positive():
    score, label = news.score_headlines(["Company profit surges, beats estimate", "record growth"])
    assert score > 0 and label == "positive"

def test_sentiment_negative():
    score, label = news.score_headlines(["Shares plunge on loss", "probe and lawsuit"])
    assert score < 0 and label == "negative"

def test_sentiment_neutral_empty():
    score, label = news.score_headlines([])
    assert score == 0.0 and label == "neutral"

def test_sentiment_arabic():
    score, label = news.score_headlines(["ارتفاع أرباح الشركة ونمو قياسي"])
    assert score > 0


# --- notify formatting (offline) -------------------------------------------
def test_format_and_build_message():
    rec = {
        "kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
        "action": "BUY", "reason": ["in zone"], "conviction": 72,
        "sizing": {"shares": 7, "spend": 700.0, "pct_of_cash": 23.3},
        "short_term": {"momentum_pct": 2.1, "rsi": 55, "confidence": "low"},
        "long_term": {"trend": "up", "momentum_pct": 8.0, "rsi": 60, "confidence": "medium"},
        "news": {"label": "positive", "score": 0.4, "count": 5, "confidence": "low"},
    }
    block = nt.format_recommendation(rec)
    assert "4015" in block and "BUY" in block and "conviction: 72" in block
    msg = nt.build_message([rec], "Test header")
    assert "Test header" in msg and "Not financial advice" in msg

def test_build_message_empty():
    msg = nt.build_message([], "Empty")
    assert "No actionable levels" in msg


if __name__ == "__main__":
    import sys
    fns = [f for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    passed = 0
    for f in fns:
        f()
        passed += 1
        print(f"ok  {f.__name__}")
    print(f"\n{passed} passed")
    sys.exit(0)
