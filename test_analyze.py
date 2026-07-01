"""Unit tests for the pure analysis logic. Run: pytest -q"""
import analyze as A


def test_rsi_all_gains_is_100():
    closes = [i for i in range(1, 30)]  # strictly rising
    assert A.rsi(closes, 14) == 100.0


def test_rsi_needs_enough_data():
    assert A.rsi([1, 2, 3], 14) is None


def test_rsi_midrange_for_choppy():
    closes = []
    p = 100.0
    for i in range(40):
        p += 1 if i % 2 == 0 else -1
        closes.append(p)
    val = A.rsi(closes, 14)
    assert val is not None and 30 < val < 70


def test_support_resistance():
    closes = [10, 12, 9, 15, 11, 8, 14]
    s, r = A.support_resistance(closes, 20)
    assert s == 8 and r == 15


def test_regime_blocks_on_down_day():
    ok, reason = A.regime_ok_for_buys(
        {"index_change_percent": -2.0, "market_mood": "Bullish"}, [], _regime())
    assert ok is False


def test_regime_blocks_on_bearish_mood():
    ok, _ = A.regime_ok_for_buys(
        {"index_change_percent": 0.2, "market_mood": "Bearish"}, [], _regime())
    assert ok is False


def test_regime_ok_when_calm():
    ok, _ = A.regime_ok_for_buys(
        {"index_change_percent": 0.3, "market_mood": "Bullish"}, [], _regime())
    assert ok is True


def test_conviction_in_zone_beats_far_away():
    closes = [90 + i * 0.2 for i in range(60)]  # gentle uptrend, price ~101
    price = closes[-1]
    in_zone = A.conviction_score(price, 52, closes, (price - 0.5, price + 0.5))
    far = A.conviction_score(price, 52, closes, (price * 0.6, price * 0.65))
    assert in_zone > far


def test_conviction_penalises_overbought():
    closes = [90 + i * 0.2 for i in range(60)]
    price = closes[-1]
    hot = A.conviction_score(price, 78, closes, (price - 0.5, price + 0.5))
    good = A.conviction_score(price, 50, closes, (price - 0.5, price + 0.5))
    assert good > hot


def test_conviction_none_without_any_inputs():
    assert A.conviction_score(100, None, [], None) is None


def test_position_size_basic():
    risk = _risk(deployable_cash=10000, price_ok=True)
    out = A.position_size(50.0, risk)
    assert out["skip"] is None
    assert out["shares"] > 0
    # 25% of (10000*0.88)=2200 budget, capped by 35% of 10000=3500 -> 2200/50=44
    assert out["shares"] == 44
    assert out["stop_price"] == round(50 * 0.91, 2)


def test_position_size_zero_cash():
    out = A.position_size(50.0, _risk(deployable_cash=0))
    assert out["shares"] == 0 and "cash" in out["skip"]


def test_position_size_commission_floor_skips_tiny_trade():
    # small cash -> buys 1 share -> min commission dominates -> skip on commission floor
    out = A.position_size(50.0, _risk(deployable_cash=300))
    assert out["shares"] == 0 and "commission" in out["skip"]


def test_derive_levels_watchlist_zone_near_support():
    out = A.derive_levels("watchlist", price=20, support=18, resistance=25)
    assert out["buy_zone"][0] == 18 and out["buy_zone"][1] == round(18 * 1.03, 2)


def test_derive_levels_watchlist_empty_without_history():
    assert A.derive_levels("watchlist", price=20, support=None, resistance=None) == {}


def test_derive_levels_holding_from_sr():
    out = A.derive_levels("holding", price=20, support=18, resistance=25)
    assert out["stop"] == round(18 * 0.97, 2)
    assert out["trim"] == 25 and out["target"] == round(25 * 1.05, 2)


def test_derive_levels_holding_falls_back_to_pct_stop():
    out = A.derive_levels("holding", price=20, support=None, resistance=None, stop_loss_pct=0.09)
    assert out["stop"] == round(20 * 0.91, 2) and "trim" not in out


def _regime():
    return {"index_down_day_pct": -1.5, "bearish_moods": {"Bearish", "Very Bearish"},
            "index_below_ma_days": 20}


def _risk(deployable_cash, price_ok=True):
    return {"deployable_cash": deployable_cash, "max_open_positions": 5, "position_pct": 0.25,
            "max_single_position_pct": 0.35, "stop_loss_pct": 0.09, "cash_buffer_pct": 0.12,
            "commission_rate": 0.00155, "min_commission_sar": 1.0, "commission_floor_pct": 0.01}
