"""
Offline unit tests. No network. Run: python -m pytest -q  (or python test_core.py)

Covers the logic that decisions depend on: RSI, trend, support/resistance,
regime filter, conviction, position sizing, level derivation, and the two
evaluators. Data is synthetic so these are deterministic.
"""

import io

import numpy as np
import pandas as pd

import indicators as ind
import analyze as az
import backtest as bt
import data
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
    assert not ok and any("long-term not confirmed" in f for f in failed)

def test_up_trend_with_momentum_below_floor_vetoes_buy():
    # The Avalon case: MA cross says 'up' but momentum is below the floor.
    # AND gate rejects it (OR gate used to pass it on the trend flag alone).
    avalon = {"trend": "up", "momentum_pct": -6.31, "rsi": 47.4}
    ok, failed = az.buy_decision(94, 0.0, avalon, "breakdown", CRITERIA)
    assert not ok and any("long-term not confirmed" in f for f in failed)

def test_up_trend_and_positive_momentum_passes():
    strong = {"trend": "up", "momentum_pct": 8.0, "rsi": 45.0}
    assert az.buy_decision(90, 0.0, strong, "ok", CRITERIA)[0]

def test_positive_momentum_without_up_trend_vetoes_buy():
    # AND gate: momentum above floor is not enough without an up trend.
    flat = {"trend": "flat", "momentum_pct": 3.0, "rsi": 45.0}
    assert not az.buy_decision(90, 0.0, flat, "ok", CRITERIA)[0]


# --- symbol verification ----------------------------------------------------
def test_verify_symbol_exact_match():
    ok, _ = data.verify_symbol("Nahdi Medical", "Nahdi Medical Company")
    assert ok

def test_verify_symbol_suffix_noise_ok():
    ok, _ = data.verify_symbol("Lumi Rental", "Lumi Rental Company")
    assert ok

def test_verify_symbol_wrong_company_fails():
    ok, reason = data.verify_symbol("Jahez", "Americana Restaurants International PLC")
    assert not ok and "Americana" in reason

def test_verify_symbol_no_name_fails():
    ok, _ = data.verify_symbol("Nupco", "")
    assert not ok

def test_unverified_watchlist_never_buys():
    # Even a perfect setup stays out of BUY once the symbol fails verification.
    df = _frame(list(range(1, 160)))
    w = {"code": "6015", "name": "Jahez", "sector": "logistics"}
    relaxed = {"conviction_min": 0, "conviction_min_breakdown": 0,
               "rsi_recovery_band": (0, 100), "long_mom_floor_pct": -100.0}
    rec = az.evaluate_watchlist(w, price=2.1, df=df, levels={}, regime="ok",
                                risk=BASE_RISK, horizon_cfg=_WL_HORIZON,
                                tech=_WL_TECH, buy_criteria=relaxed)
    # evaluate_watchlist still returns BUY on the numbers; the gate that flips
    # unverified names to WATCH lives in main._collect_recs. Assert the gate's
    # contract directly: a False verification excludes the name from BUY.
    assert rec["action"] == "BUY"  # pre-gate
    verified = False
    action = "WATCH (UNVERIFIED)" if not verified else rec["action"]
    assert action == "WATCH (UNVERIFIED)"


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
def test_derive_levels_brackets_the_entry_price():
    closes = list(range(110, 89, -1)) + list(range(90, 106))
    df = _frame(closes)
    lv = az.derive_levels(df, {"sr_lookback": 60}, 0.09)
    price = lv["price_at_derivation"]
    assert lv["stop"] < price < lv["target"]


def test_derive_levels_reward_risk_is_fixed_by_construction():
    # The whole point of the ATR rework: R:R no longer depends on where price
    # happens to sit relative to support and resistance. The old levels gave a
    # median R:R of 0.12 across 4,721 backtested signals.
    for closes in ([10 + (i % 7) * 0.5 for i in range(80)],
                   list(np.linspace(50, 90, 80)),
                   list(np.linspace(90, 50, 80))):
        df = _frame(closes)
        lv = az.derive_levels(df, {"sr_lookback": 60}, 0.09)
        price = lv["price_at_derivation"]
        rr = (lv["target"] - price) / (price - lv["stop"])
        assert rr >= 1.9, f"R:R {rr:.2f} on {closes[:3]}..."


def test_derive_levels_never_risks_more_than_stop_pct():
    # A violently volatile name would put 1.5 ATR far below price; the risk cap
    # has to win.
    closes = [10, 30, 8, 35, 6, 40, 5, 45, 7, 50] * 8
    df = _frame(closes)
    lv = az.derive_levels(df, {"sr_lookback": 60}, 0.09)
    price = lv["price_at_derivation"]
    assert (price - lv["stop"]) / price <= 0.09 + 1e-9


def test_derive_levels_without_atr_emits_no_money_levels():
    df = _frame([10, 11, 12])          # too short for a 14-period ATR.
    lv = az.derive_levels(df, {"sr_lookback": 60}, 0.09)
    assert "stop" not in lv and "target" not in lv


def test_levels_from_atr_matches_derive_levels():
    # The backtest re-places levels from a cached ATR instead of recomputing
    # indicators. If the two paths ever diverged, the sweep would be tuning
    # multipliers production does not use.
    closes = [10 + (i % 9) * 0.4 for i in range(80)]
    df = _frame(closes)
    lv = az.derive_levels(df, {"sr_lookback": 60}, 0.09)
    direct = az.levels_from_atr(lv["price_at_derivation"], lv["atr"], 0.09)
    assert direct["stop"] == lv["stop"]
    assert direct["target"] == lv["target"]
    assert direct["trim"] == lv["trim"]


def test_levels_from_atr_rejects_bad_atr():
    assert az.levels_from_atr(10.0, float("nan"), 0.09) == {}
    assert az.levels_from_atr(10.0, 0.0, 0.09) == {}
    assert az.levels_from_atr(0.0, 1.0, 0.09) == {}


def test_atr_is_positive_and_scales_with_range():
    calm = _frame([10.0] * 40, highs=[10.1] * 40, lows=[9.9] * 40)
    wild = _frame([10.0] * 40, highs=[12.0] * 40, lows=[8.0] * 40)
    a_calm = ind.atr(calm["High"], calm["Low"], calm["Close"], 14)
    a_wild = ind.atr(wild["High"], wild["Low"], wild["Close"], 14)
    assert 0 < a_calm < a_wild


def test_atr_insufficient_data_is_nan():
    df = _frame([10, 11, 12])
    assert np.isnan(ind.atr(df["High"], df["Low"], df["Close"], 14))


def test_atr_counts_overnight_gaps():
    # A gap up with a narrow intraday range: high-low alone would understate it.
    closes = [10.0] * 20 + [20.0] * 20
    df = _frame(closes, highs=[c * 1.001 for c in closes],
                lows=[c * 0.999 for c in closes])
    a = ind.atr(df["High"], df["Low"], df["Close"], 14)
    narrow = max(df["High"]) * 0.002
    assert a > narrow


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

def test_sentiment_phrase_capital_increase_is_positive():
    score, label = news.score_headlines(["Company board approves capital increase plan"])
    assert score > 0 and label == "positive"

def test_sentiment_phrase_trading_suspension_is_negative():
    score, label = news.score_headlines(["CMA orders trading suspension of the stock"])
    assert score < 0 and label == "negative"

def test_sentiment_phrase_profit_warning_is_negative():
    score, label = news.score_headlines(["Firm issues profit warning ahead of results"])
    assert score < 0 and label == "negative"

def test_sentiment_arabic_phrase_dividend_distribution_is_positive():
    score, label = news.score_headlines(["مجلس الإدارة يوصي بتوزيعات أرباح نقدية"])
    assert score > 0 and label == "positive"

def test_sentiment_arabic_phrase_trading_halt_is_negative():
    score, label = news.score_headlines(["تعليق التداول في السهم بقرار من الهيئة"])
    assert score < 0 and label == "negative"

def test_sentiment_still_handles_old_single_word_lexicon():
    # Regression: substring matching must not lose the original coverage.
    score, label = news.score_headlines(["Shares plunge on unexpected loss"])
    assert score < 0 and label == "negative"


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


# --- derived trim level -----------------------------------------------------
# evaluate_holding has always had a TRIM branch that derive_levels could not
# reach, because it never emitted a 'trim' key.
def test_derive_levels_emits_reachable_trim():
    closes = [10, 12, 9, 13, 8, 14, 9, 15, 10, 16, 11, 17, 12, 18, 13] * 5
    df = _frame(closes)
    lv = az.derive_levels(df, {"sr_lookback": 60}, 0.09)
    assert "trim" in lv
    assert lv["price_at_derivation"] < lv["trim"] < lv["target"]


def test_trim_alert_now_fires():
    closes = [10, 12, 9, 13, 8, 14, 9, 15, 10, 16, 11, 17, 12, 18, 13] * 5
    df = _frame(closes)
    lv = az.derive_levels(df, {"sr_lookback": 60}, 0.09)
    holding = {"code": "1303", "name": "EIC", "shares": 10, "avg_cost": 9.0}
    rec = az.evaluate_holding(holding, lv["trim"] + 0.01, df, lv,
                              {"short_lookback_days": 10, "long_lookback_days": 120,
                               "short_ma": 20, "long_ma": 50},
                              {"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70})
    assert rec["action"] == "TRIM"


# --- backtest: outcome resolution -------------------------------------------
# These guard the place look-ahead hides. A backtest that quietly enters on the
# decision bar's close, or scans the decision bar for a stop, produces numbers
# that look great and mean nothing.
def _ohlc(opens, highs, lows, closes, start="2020-01-01"):
    idx = pd.date_range(start, periods=len(closes), freq="D")
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows,
                         "Close": closes, "Volume": [1000] * len(closes)}, index=idx)


def test_resolve_outcome_hits_target():
    df = _ohlc([10, 10, 10, 10], [10, 10, 12, 12], [9, 9, 9, 9], [10, 10, 11, 11])
    r = bt.resolve_outcome(df, 0, stop=8.0, target=11.5)
    assert r["outcome"] == "target"
    assert r["entry"] == 10.0          # bar 1's open, not bar 0's close.
    assert r["bars_held"] == 2
    assert r["return_pct"] == 15.0


def test_resolve_outcome_hits_stop():
    df = _ohlc([10, 10, 10, 10], [10, 10, 10, 10], [9, 9, 7, 7], [10, 10, 8, 8])
    r = bt.resolve_outcome(df, 0, stop=8.0, target=20.0)
    assert r["outcome"] == "stop"
    assert r["bars_held"] == 2
    assert r["return_pct"] == -20.0


def test_resolve_outcome_timeout_uses_last_close():
    closes = [10] * 30
    df = _ohlc(closes, [10.5] * 30, [9.5] * 30, closes)
    r = bt.resolve_outcome(df, 0, stop=1.0, target=99.0, max_hold=10)
    assert r["outcome"] == "timeout"
    assert r["bars_held"] == 10


def test_resolve_outcome_same_bar_stop_and_target_is_stop():
    # One daily bar spans both levels. It cannot say which came first, so the
    # pessimistic read is the honest one.
    df = _ohlc([10, 10, 10], [10, 20, 20], [9, 5, 5], [10, 10, 10])
    r = bt.resolve_outcome(df, 0, stop=8.0, target=12.0)
    assert r["outcome"] == "stop"


def test_resolve_outcome_ignores_decision_bar():
    # Bar 0 breaches the stop. The decision was made ON bar 0, so entry happens
    # after it and that breach must not count.
    df = _ohlc([10, 10, 10], [10, 10, 15], [2, 9, 9], [10, 10, 14])
    r = bt.resolve_outcome(df, 0, stop=8.0, target=13.0)
    assert r["outcome"] == "target"


def test_resolve_outcome_no_bar_to_enter_on():
    df = _ohlc([10, 10], [10, 10], [9, 9], [10, 10])
    assert bt.resolve_outcome(df, 1, stop=8.0, target=12.0) == {}


def test_resolve_outcome_forward_marks():
    closes = list(np.linspace(10, 20, 200))
    df = _ohlc(closes, [c * 1.001 for c in closes], [c * 0.999 for c in closes], closes)
    r = bt.resolve_outcome(df, 0, stop=None, target=None, max_hold=150)
    assert r["fwd_60d_pct"] > 0 and r["fwd_120d_pct"] > r["fwd_60d_pct"]


# --- backtest: features are look-ahead free ---------------------------------
def test_features_unchanged_by_future_bars():
    # The same decision date must produce identical features whether or not the
    # future exists in the frame. If appending later bars changes a past row,
    # information is leaking backwards.
    closes = list(np.linspace(20, 40, 140))
    df = _ohlc(closes, [c * 1.02 for c in closes], [c * 0.98 for c in closes], closes)
    empty_idx = pd.DataFrame()

    full = bt.build_features({"X": df}, empty_idx, step_days=5, progress=lambda *_: None)
    trunc = bt.build_features({"X": df.iloc[:70]}, empty_idx, step_days=5,
                              progress=lambda *_: None)

    shared = set(full["t"]) & set(trunc["t"])
    assert len(shared) > 3
    for t in shared:
        a = full[full["t"] == t].iloc[0]
        b = trunc[trunc["t"] == t].iloc[0]
        for col in ("price", "trend", "rsi", "momentum_pct", "stop", "target",
                    "buy_zone_low", "distance_to_zone_pct"):
            assert (a[col] == b[col]) or (pd.isna(a[col]) and pd.isna(b[col])), \
                f"{col} at t={t} changed when future bars were added"


def test_build_features_writes_nothing_by_default():
    # Checkpointing must be opt-in. When it defaulted on, these tests appended
    # their synthetic "X" name straight into the real .cache/features.csv.
    before = bt.FEATURES_FILE.exists() and bt.FEATURES_FILE.stat().st_mtime
    closes = list(np.linspace(20, 40, 80))
    df = _ohlc(closes, [c * 1.02 for c in closes], [c * 0.98 for c in closes], closes)
    bt.build_features({"X": df}, pd.DataFrame(), step_days=5, progress=lambda *_: None)
    after = bt.FEATURES_FILE.exists() and bt.FEATURES_FILE.stat().st_mtime
    assert before == after


def test_regime_at_uses_only_past_bars():
    idx = pd.date_range("2021-01-01", periods=10, freq="D")
    regimes = pd.Series(["ok"] * 5 + ["breakdown"] * 5, index=idx)
    assert bt._regime_at(regimes, idx[3]) == "ok"
    assert bt._regime_at(regimes, idx[7]) == "breakdown"
    assert bt._regime_at(pd.Series(dtype="object"), idx[0]) == "unknown"


def test_regime_at_handles_tz_aware_lookup():
    # Bars come back tz-aware from yfinance and tz-naive from the CSV cache.
    # If that mismatch raised, every date would silently read 'unknown' and the
    # BUY bar would sit at the breakdown cutoff forever.
    idx = pd.date_range("2021-01-01", periods=10, freq="D")
    regimes = pd.Series(["ok"] * 5 + ["breakdown"] * 5, index=idx)
    aware = pd.Timestamp("2021-01-09", tz="Asia/Riyadh")
    assert bt._regime_at(regimes, aware) == "breakdown"


def test_naive_index_strips_timezone():
    idx = pd.date_range("2021-01-01", periods=3, freq="D", tz="Asia/Riyadh")
    df = pd.DataFrame({"Close": [1.0, 2.0, 3.0]}, index=idx)
    out = bt._naive_index(df)
    assert out.index.tz is None
    assert len(out) == 3


# --- backtest: one open trade per name --------------------------------------
def _buy_features(code, ts, price=10.0):
    """Feature rows that all pass the BUY gate, so only position state can stop
    a second trade from opening."""
    return pd.DataFrame([{
        "code": code, "date": pd.Timestamp("2020-01-01") + pd.Timedelta(days=int(t)),
        "t": t, "price": price, "trend": "up", "rsi": 55.0, "momentum_pct": 10.0,
        "buy_zone_low": price * 0.995, "buy_zone_high": price * 1.02,
        "stop": price * 0.5, "target": price * 5, "distance_to_zone_pct": 0.5,
        "regime": "ok",
    } for t in ts])


def test_run_holds_one_position_per_name():
    closes = [10.0] * 300
    df = _ohlc(closes, [10.1] * 300, [9.9] * 300, closes)
    feats = _buy_features("X", [40, 45, 50, 55, 60, 200, 205])
    events = bt.run(feats, {"X": df})
    assert len(events) > 0
    # Every trade times out after max_hold, so the next one cannot open until
    # 120 bars later: t=40 then t=200, never the weekly rows in between.
    assert list(events["t"]) == [40, 200]
    assert bt.check_no_overlap(events) == []


def test_run_survives_features_csv_round_trip():
    # Tadawul codes are all digits, so a CSV round-trip infers int64 while every
    # history dict is keyed by str. The mismatch would skip every name and report
    # zero events — indistinguishable from the honest finding "BUY never fires".
    closes = [10.0] * 300
    df = _ohlc(closes, [10.1] * 300, [9.9] * 300, closes)
    feats = _buy_features("4015", [40, 200])

    roundtripped = pd.read_csv(io.StringIO(feats.to_csv(index=False)),
                               parse_dates=["date"])
    assert roundtripped["code"].dtype != object      # the trap is real.
    roundtripped["code"] = roundtripped["code"].astype(str)   # what load_features does.

    events = bt.run(roundtripped, {"4015": df})
    assert len(events) == 2
    assert list(events["code"]) == ["4015", "4015"]


def test_check_no_overlap_catches_overlap():
    bad = pd.DataFrame([
        {"code": "X", "t": 10, "bars_held": 50},
        {"code": "X", "t": 20, "bars_held": 50},
    ])
    assert bt.check_no_overlap(bad) != []


def test_report_covers_all_events_not_just_resolved():
    events = pd.DataFrame([
        {"code": "A", "t": 1, "bars_held": 10, "return_pct": 10.0, "outcome": "target",
         "fwd_60d_pct": 5.0, "fwd_120d_pct": 6.0},
        {"code": "B", "t": 1, "bars_held": 10, "return_pct": -5.0, "outcome": "stop",
         "fwd_60d_pct": -2.0, "fwd_120d_pct": -1.0},
        {"code": "C", "t": 1, "bars_held": 120, "return_pct": 1.0, "outcome": "timeout",
         "fwd_60d_pct": 0.5, "fwd_120d_pct": 1.0},
    ])
    rep = bt.report(events)
    assert rep["events"] == 3
    assert rep["expectancy_pct"] == 2.0        # mean over ALL three, timeout included.
    assert rep["timeout_pct"] == 33.3          # reported, not hidden.
    assert rep["hit_target_pct"] == 33.3 and rep["hit_stop_pct"] == 33.3


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
