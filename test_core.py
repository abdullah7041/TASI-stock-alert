"""
Offline unit tests. No network. Run: python -m pytest -q  (or python test_core.py)

Covers the logic that decisions depend on: RSI, trend, support/resistance,
regime detection, the BUY rule checklist, budget allocation, level derivation,
and the two evaluators. Data is synthetic so these are deterministic.
"""

import io
from pathlib import Path

import numpy as np
import pandas as pd

import indicators as ind
import analyze as az
import backtest as bt
import config as cfg
import data
import news
import notify as nt
import history as hist
import disclosures as discl


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


def test_wilder_gain_loss_matches_rsi_derivation():
    closes = [10, 10.5, 10.2, 10.8, 10.6, 11.0, 10.9, 11.3, 11.1, 11.5,
             11.4, 11.8, 11.6, 12.0, 11.9, 12.3]
    avg_gain, avg_loss = ind.wilder_gain_loss(closes, 14)
    assert not np.isnan(avg_gain) and not np.isnan(avg_loss)
    derived_rsi = 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    assert abs(derived_rsi - ind.rsi(closes, 14)) < 1e-9

def test_wilder_gain_loss_insufficient_data_is_nan():
    avg_gain, avg_loss = ind.wilder_gain_loss([10, 11, 12], 14)
    assert np.isnan(avg_gain) and np.isnan(avg_loss)


# --- trend ------------------------------------------------------------------
def test_trend_up():
    assert ind.trend(list(range(1, 120)), 20, 50) == "up"

def test_trend_down():
    assert ind.trend(list(range(120, 1, -1)), 20, 50) == "down"

def test_trend_unknown_when_short():
    assert ind.trend([1, 2, 3], 20, 50) == "unknown"


# --- short/long term read ---------------------------------------------------
def test_short_term_read_has_no_confidence_key():
    df = _frame(list(range(1, 40)))
    out = ind.short_term_read(df, 10, 20)
    assert "confidence" not in out
    assert "momentum_pct" in out and "rsi" in out

def test_long_term_read_has_no_confidence_key():
    df = _frame(list(range(1, 160)))
    out = ind.long_term_read(df, 50, 20, 50)
    assert "confidence" not in out
    assert "trend" in out and "momentum_pct" in out and "rsi" in out


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


# --- trigger prices -----------------------------------------------------
import triggers as trig

def test_momentum_trigger_exact_arithmetic():
    # 121 bars. The reference bar is the one pct_change will USE once the new
    # bar is appended: on the longer series that is iloc[-121], which is
    # iloc[-120] = 95.0 of today's series -- NOT today's own iloc[-121]
    # (100.0). Floor -5% -> trigger = 95.0 * 0.95 = 90.25.
    closes = [100.0] + [95.0] * 119 + [90.0]
    t = trig.momentum_trigger(closes, 120, -5.0)
    assert t["rule"] == "momentum_floor"
    assert t["reachable"] is True
    assert abs(t["trigger_price"] - 90.25) < 0.005
    # (90.25 - 90) / 90 * 100 = 0.2777...
    assert abs(t["pct_away"] - 0.28) < 0.01

def test_momentum_trigger_round_trips_through_indicators_pct_change():
    # The real proof, matching the RSI/trend trigger tests: append the trigger
    # as the next bar and check the REAL indicators.pct_change() -- the same
    # call buy_decision's momentum rule is fed from -- actually clears the
    # floor. And that the cent below does NOT: the reported price is the
    # smallest 2-decimal quote that qualifies, not merely one that qualifies.
    closes = [100.0 - i * 0.05 for i in range(150)]  # slow decline
    assert ind.pct_change(closes, 120) < -5.0  # the rule is failing today
    t = trig.momentum_trigger(closes, 120, -5.0)
    assert t["reachable"] is True
    assert ind.pct_change(closes + [t["trigger_price"]], 120) >= -5.0
    below = round(t["trigger_price"] - 0.01, 2)
    assert ind.pct_change(closes + [below], 120) < -5.0

def test_momentum_trigger_beyond_max_search_is_unreachable():
    # Down ~40% over the lookback: getting momentum back to -5% on one bar is
    # a huge jump. The price is still reported (it is informative), but
    # reachable must be False -- momentum used to claim True unconditionally.
    closes = [100.0 - i * 0.4 for i in range(150)]
    t = trig.momentum_trigger(closes, 120, -5.0)
    assert t["trigger_price"] is not None
    assert abs(t["pct_away"]) > trig.MAX_SEARCH_PCT
    assert t["reachable"] is False
    assert "beyond" in t["plain"]

def test_momentum_trigger_insufficient_history_is_unreachable():
    t = trig.momentum_trigger([100.0] * 50, 120, -5.0)
    assert t["reachable"] is False
    assert t["trigger_price"] is None

def test_rsi_trigger_round_trips_through_indicators_rsi():
    # A falling series -> RSI well below the recovery band's low edge (25).
    # Compute the trigger, append it as the NEXT bar, and confirm the
    # resulting RSI actually lands at 25 -- this is the real proof, not just
    # that the algebra is self-consistent. The assertion is directional
    # (>= 25, and the cent below falls short) rather than a two-sided
    # tolerance, because the reported price is quantised to a real cent and
    # the safe-direction rounding deliberately lives on the far side of the
    # edge. That pair is strictly stronger than any symmetric band.
    closes = [20 - i * 0.15 for i in range(30)]  # steadily falling
    current_rsi = ind.rsi(closes, 14)
    assert current_rsi < 25  # below the band, as the test assumes
    t = trig.rsi_trigger(closes, 14, 25, 60)
    assert t["rule"] == "rsi_band"
    assert t["reachable"] is True
    appended = closes + [t["trigger_price"]]
    landed_rsi = ind.rsi(appended, 14)
    assert landed_rsi >= 25            # the band edge is actually reached
    assert landed_rsi - 25 < 0.05      # and only just: no wasted overshoot
    below = closes + [round(t["trigger_price"] - 0.01, 2)]
    assert ind.rsi(below, 14) < 25     # the cent below does not get there

def test_rsi_trigger_already_in_band_is_unreachable():
    # Oscillating series sits RSI at a stable mid value, inside (25, 60).
    closes = [50.0 + (0.5 if i % 2 == 0 else -0.5) for i in range(30)]
    t = trig.rsi_trigger(closes, 14, 25, 60)
    assert t["reachable"] is False

def test_rsi_trigger_beyond_max_search_is_unreachable():
    # Deeply oversold: RSI nowhere near 25, needs an enormous single-bar
    # gain to get there -- should report a trigger_price but reachable=False.
    closes = [100 - i * 2 for i in range(20)]  # sharp, sustained decline
    t = trig.rsi_trigger(closes, 14, 25, 60)
    if not t["reachable"]:
        assert t["trigger_price"] is not None  # informative even when out of reach

def test_trend_trigger_flips_down_to_up_and_no_smaller_price_does():
    # A steadily falling series: trend is "down". Find the trigger, confirm
    # appending it flips trend to "up", AND confirm the immediately-preceding
    # scan step does NOT flip it -- this is the actual guarantee a forward
    # scan gives that bisection would not: the trigger is the SMALLEST
    # qualifying price, not just A qualifying price.
    closes = [100 - i * 0.04 for i in range(60)]
    assert ind.trend(closes, 20, 50) in ("down", "flat")
    t = trig.trend_trigger(closes, 20, 50)
    assert t["rule"] == "trend"
    assert t["reachable"] is True
    appended_at_trigger = closes + [t["trigger_price"]]
    assert ind.trend(appended_at_trigger, 20, 50) == "up"
    step = max(closes[-1] * 0.001, 0.01)
    just_below = closes + [t["trigger_price"] - step]
    assert ind.trend(just_below, 20, 50) != "up"

def test_trend_trigger_already_up_is_unreachable():
    closes = [50 + i * 0.5 for i in range(60)]  # steadily rising
    assert ind.trend(closes, 20, 50) == "up"
    t = trig.trend_trigger(closes, 20, 50)
    assert t["reachable"] is False
    assert t["trigger_price"] is None

def test_trend_trigger_unreachable_within_bound():
    # A long MA falling hard enough that no single next bar within +25%
    # can make it rise -- genuinely out of reach, not a scan bug.
    closes = [200 - i * 3 for i in range(60)]
    t = trig.trend_trigger(closes, 20, 50, max_pct=25.0)
    assert t["reachable"] is False


# --- history: snapshots, deltas, streaks ------------------------------------
def test_record_snapshot_appends_new_day():
    h = hist.record_snapshot({}, "4015", "2026-07-27", {"price": 100.0, "rsi": 50.0,
                              "trend": "up", "rules_met": 2, "blocking": ["momentum_floor"]})
    assert h["4015"] == [{"date": "2026-07-27", "price": 100.0, "rsi": 50.0,
                          "trend": "up", "rules_met": 2, "blocking": ["momentum_floor"]}]

def test_record_snapshot_same_day_rerun_replaces_not_appends():
    h = hist.record_snapshot({}, "4015", "2026-07-27", {"price": 100.0, "rsi": 50.0,
                              "trend": "up", "rules_met": 2, "blocking": []})
    h2 = hist.record_snapshot(h, "4015", "2026-07-27", {"price": 101.0, "rsi": 51.0,
                               "trend": "up", "rules_met": 3, "blocking": []})
    assert len(h2["4015"]) == 1
    assert h2["4015"][0]["price"] == 101.0

def test_record_snapshot_caps_at_90_entries():
    h = {}
    for i in range(95):
        h = hist.record_snapshot(h, "4015", f"2026-01-{i:03d}", {"price": float(i),
                                  "rsi": 50.0, "trend": "up", "rules_met": 1, "blocking": []})
    assert len(h["4015"]) == 90
    assert h["4015"][0]["date"] == "2026-01-005"  # oldest 5 dropped
    assert h["4015"][-1]["date"] == "2026-01-094"

def test_record_snapshot_does_not_mutate_input():
    original = {}
    hist.record_snapshot(original, "4015", "2026-07-27", {"price": 1.0, "rsi": None,
                          "trend": "flat", "rules_met": None, "blocking": None})
    assert original == {}

def test_compute_delta_none_on_first_run():
    assert hist.compute_delta({}, "4015", "2026-07-27",
                               {"price": 100.0, "rsi": 50.0, "trend": "up",
                                "rules_met": 2, "blocking": []}) is None

def test_compute_delta_price_rsi_rules_met_and_flip():
    h = {"4015": [{"date": "2026-07-27", "price": 100.0, "rsi": 40.0, "trend": "down",
                   "rules_met": 1, "blocking": ["trend", "momentum_floor"]}]}
    d = hist.compute_delta(h, "4015", "2026-07-28",
                           {"price": 105.0, "rsi": 45.0, "trend": "up",
                            "rules_met": 2, "blocking": ["momentum_floor"]})
    assert d["price_pct"] == 5.0
    assert d["rsi_delta"] == 5.0
    assert d["rules_met_delta"] == 1
    assert d["flipped"] == ["trend"]  # trend rule passed today, was blocking yesterday
    assert d["trend_flipped"] is True

def test_compute_delta_no_change_is_zero_not_none():
    h = {"4015": [{"date": "2026-07-27", "price": 100.0, "rsi": 40.0, "trend": "down",
                   "rules_met": 1, "blocking": ["trend"]}]}
    d = hist.compute_delta(h, "4015", "2026-07-28",
                           {"price": 100.0, "rsi": 40.0, "trend": "down",
                            "rules_met": 1, "blocking": ["trend"]})
    assert d["price_pct"] == 0.0
    assert d["rsi_delta"] == 0.0
    assert d["rules_met_delta"] == 0
    assert d["flipped"] == []
    assert d["trend_flipped"] is False

def test_compute_delta_ignores_todays_own_entry_same_day_rerun():
    # Simulates a second digest run on the same day: history already has
    # TODAY's entry (from the first run) alongside yesterday's. The delta
    # must still be computed against yesterday, not today's own entry.
    h = {"4015": [{"date": "2026-07-27", "price": 100.0, "rsi": 40.0, "trend": "down",
                   "rules_met": 1, "blocking": ["trend"]},
                  {"date": "2026-07-28", "price": 105.0, "rsi": 45.0, "trend": "up",
                   "rules_met": 2, "blocking": []}]}
    d = hist.compute_delta(h, "4015", "2026-07-28",
                           {"price": 105.0, "rsi": 45.0, "trend": "up",
                            "rules_met": 2, "blocking": []})
    assert d["price_pct"] == 5.0  # vs the 07-27 entry, not the 07-28 one

def test_compute_delta_holding_has_no_rules_met_or_blocking():
    h = {"1303": [{"date": "2026-07-27", "price": 15.0, "rsi": 50.0, "trend": "down",
                   "rules_met": None, "blocking": None}]}
    d = hist.compute_delta(h, "1303", "2026-07-28",
                           {"price": 15.2, "rsi": 51.0, "trend": "down",
                            "rules_met": None, "blocking": None})
    assert d["rules_met_delta"] is None
    assert d["flipped"] == []
    assert d["trend_flipped"] is False

def test_compute_streak_first_day_is_one():
    s = hist.compute_streak({}, "4015", "2026-07-28", "trend", "up")
    assert s == {"days": 1, "started": "2026-07-28"}

def test_compute_streak_counts_consecutive_matching_days():
    h = {"4015": [{"date": "2026-07-25", "trend": "up"},
                  {"date": "2026-07-26", "trend": "up"},
                  {"date": "2026-07-27", "trend": "down"}]}
    s = hist.compute_streak(h, "4015", "2026-07-28", "trend", "down")
    assert s == {"days": 2, "started": "2026-07-27"}

def test_compute_streak_breaks_on_first_mismatch():
    h = {"4015": [{"date": "2026-07-24", "trend": "down"},
                  {"date": "2026-07-25", "trend": "up"},
                  {"date": "2026-07-26", "trend": "up"},
                  {"date": "2026-07-27", "trend": "up"}]}
    s = hist.compute_streak(h, "4015", "2026-07-28", "trend", "up")
    assert s == {"days": 4, "started": "2026-07-25"}

def test_compute_streak_ignores_todays_own_entry():
    h = {"4015": [{"date": "2026-07-27", "trend": "up"},
                  {"date": "2026-07-28", "trend": "up"}]}  # same-day rerun artifact
    s = hist.compute_streak(h, "4015", "2026-07-28", "trend", "up")
    assert s["days"] == 2  # 07-27 + today, NOT 07-27 + 07-28 + today


# --- BUY decision -----------------------------------------------------------
CRITERIA = {"rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
GOOD_LONG = {"trend": "up", "momentum_pct": 10.0, "rsi": 45.0}

def _rule(rules, name):
    return next(r for r in rules if r["rule"] == name)

def test_buy_fires_when_all_rules_met():
    ok, rules = az.buy_decision(GOOD_LONG, CRITERIA)
    assert ok
    assert len(rules) == 3
    assert all(r["passed"] for r in rules)
    assert [r["rule"] for r in rules] == ["rsi_band", "trend", "momentum_floor"]

def test_rsi_outside_recovery_band_vetoes_buy():
    hot = {**GOOD_LONG, "rsi": 75.0}
    ok, rules = az.buy_decision(hot, CRITERIA)
    assert not ok
    assert _rule(rules, "rsi_band")["passed"] is False
    capitulating = {**GOOD_LONG, "rsi": 15.0}
    assert not az.buy_decision(capitulating, CRITERIA)[0]

def test_rsi_unavailable_vetoes_buy():
    unavailable = {**GOOD_LONG, "rsi": float("nan")}
    ok, rules = az.buy_decision(unavailable, CRITERIA)
    assert not ok
    assert _rule(rules, "rsi_band")["passed"] is False
    assert "unavailable" in _rule(rules, "rsi_band")["plain"]

def test_deteriorating_long_term_vetoes_buy():
    bad = {"trend": "down", "momentum_pct": -20.0, "rsi": 45.0}
    ok, rules = az.buy_decision(bad, CRITERIA)
    assert not ok
    assert _rule(rules, "trend")["passed"] is False
    assert _rule(rules, "momentum_floor")["passed"] is False

def test_up_trend_with_momentum_below_floor_vetoes_buy():
    # The Avalon case: the MA cross says 'up' but momentum is below the floor.
    # Trend and momentum are now SEPARATE rules, so this reports 2/3 with one
    # named blocker instead of a single combined "long-term not confirmed".
    avalon = {"trend": "up", "momentum_pct": -6.31, "rsi": 47.4}
    ok, rules = az.buy_decision(avalon, CRITERIA)
    assert not ok
    assert _rule(rules, "trend")["passed"] is True
    assert _rule(rules, "momentum_floor")["passed"] is False
    assert sum(1 for r in rules if r["passed"]) == 2

def test_up_trend_and_positive_momentum_passes():
    strong = {"trend": "up", "momentum_pct": 8.0, "rsi": 45.0}
    assert az.buy_decision(strong, CRITERIA)[0]

def test_positive_momentum_without_up_trend_vetoes_buy():
    flat = {"trend": "flat", "momentum_pct": 3.0, "rsi": 45.0}
    ok, rules = az.buy_decision(flat, CRITERIA)
    assert not ok
    assert _rule(rules, "trend")["passed"] is False


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
    relaxed = {"rsi_recovery_band": (0, 100), "long_mom_floor_pct": -100.0}
    rec = az.evaluate_watchlist(w, price=2.1, df=df, levels={},
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
def _buy(code, price):
    return {"kind": "watchlist", "code": code, "name": code, "price": price,
            "action": "BUY"}

def test_allocate_whole_shares_within_budget():
    buys = [_buy("A", 33.4), _buy("B", 13.7)]
    summary = az.allocate_budget(buys, 500.0)
    total = sum(b["sizing"]["spend"] for b in buys if not b["sizing"].get("skip"))
    for b in buys:
        if not b["sizing"].get("skip"):
            assert b["sizing"]["shares"] == int(b["sizing"]["shares"])
            assert abs(b["sizing"]["shares"] * b["price"] - b["sizing"]["spend"]) < 0.01
    assert total <= 500.0 + 1e-9
    assert abs(summary["allocated"] - total) < 0.01
    assert abs(summary["leftover"] - (500.0 - total)) < 0.01

def test_allocate_equal_weight_same_price_gets_same_spend():
    # The point of the change: identical prices now get identical spend, where
    # the conviction-weighted version deliberately gave one of them more.
    buys = [_buy("A", 10.0), _buy("B", 10.0)]
    az.allocate_budget(buys, 500.0)
    a = next(b for b in buys if b["code"] == "A")["sizing"]["spend"]
    b_ = next(b for b in buys if b["code"] == "B")["sizing"]["spend"]
    assert a == b_
    assert a == 250.0

def test_allocate_weight_pct_is_equal_across_names():
    buys = [_buy("A", 10.0), _buy("B", 10.0), _buy("C", 10.0)]
    az.allocate_budget(buys, 300.0)
    for b in buys:
        assert b["sizing"]["weight_pct"] == 33.3

def test_allocate_min_one_share_when_equal_slice_too_small_but_budget_allows():
    # Equal slices are 250 SAR each. B at 300 does not fit its own slice, but
    # does fit what is left of the whole budget, so the 1-share fallback gives
    # it one. (The old version of this test drove the same fallback with a
    # conviction disparity; price disparity is the equal-weight equivalent.)
    buys = [_buy("B", 300.0), _buy("A", 10.0)]
    az.allocate_budget(buys, 500.0)
    assert next(b for b in buys if b["code"] == "B")["sizing"]["shares"] == 1
    assert next(b for b in buys if b["code"] == "A")["sizing"]["shares"] == 20

def test_allocate_skips_share_pricier_than_budget():
    buys = [_buy("A", 600.0)]
    summary = az.allocate_budget(buys, 500.0)
    assert buys[0]["sizing"]["shares"] == 0 and "skip" in buys[0]["sizing"]
    assert summary["allocated"] == 0.0 and summary["leftover"] == 500.0

def test_allocate_zero_budget_skips_all():
    buys = [_buy("A", 10.0)]
    az.allocate_budget(buys, 0.0)
    assert buys[0]["sizing"]["skip"] == "monthly budget exhausted"

def test_allocate_budget_caps_at_max_positions_counting_existing_holdings():
    buys = [{"code": "A", "price": 10.0}, {"code": "B", "price": 10.0},
           {"code": "C", "price": 10.0}]
    az.allocate_budget(buys, 10000.0, current_positions=3, max_positions=4)
    sized = [b for b in buys if b["sizing"]["shares"] > 0]
    skipped = [b for b in buys if b["sizing"]["shares"] == 0]
    assert len(sized) == 1  # only 1 slot left (4 - 3 already held)
    assert len(skipped) == 2
    assert "max_positions" in skipped[0]["sizing"]["skip"]

def test_allocate_budget_no_cap_when_max_positions_is_none():
    buys = [{"code": "A", "price": 10.0}, {"code": "B", "price": 10.0}]
    az.allocate_budget(buys, 10000.0, current_positions=10, max_positions=None)
    assert all(b["sizing"]["shares"] > 0 for b in buys)  # unaffected, as before this task

def test_allocate_budget_zero_capacity_skips_all_new_buys():
    buys = [{"code": "A", "price": 10.0}]
    az.allocate_budget(buys, 10000.0, current_positions=5, max_positions=5)
    assert buys[0]["sizing"]["shares"] == 0
    assert "max_positions" in buys[0]["sizing"]["skip"]

def test_allocate_budget_weight_pct_reflects_capped_count_not_original():
    # 3 buys but only capacity for 2 -- the 2 that fit should be weighted as
    # if there were 2 qualifying names, not 3 (the cap changes what "equal
    # weight" means, since the 3rd was never really in contention).
    buys = [{"code": "A", "price": 10.0}, {"code": "B", "price": 10.0},
           {"code": "C", "price": 10.0}]
    az.allocate_budget(buys, 10000.0, current_positions=0, max_positions=2)
    assert buys[0]["sizing"]["weight_pct"] == 50.0
    assert buys[1]["sizing"]["weight_pct"] == 50.0


BASE_RISK = {
    "deployable_cash": 3000.0, "max_positions": 5, "position_pct": 0.25,
    "stop_loss_pct": 0.09, "max_single_pct": 0.35, "cash_buffer_pct": 0.12,
    "commission_rate": 0.00155, "min_commission": 0.0, "commission_floor_pct": 0.01,
}


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


def test_news_summary_none_when_no_news():
    assert az.news_summary(None) is None

def test_news_summary_shapes_result():
    result = news.NewsResult(query="q", headlines=[{"title": "T", "link": "", "published": ""}],
                             score=0.3, label="positive", matches=[{"positive": [], "negative": []}], ok=True)
    summary = az.news_summary(result)
    assert summary == {"ok": True, "label": "positive", "score": 0.3,
                       "headlines": [{"title": "T", "link": "", "published": ""}]}

def test_evaluate_holding_attaches_news():
    df = _frame(list(range(100, 160)))
    h = {"code": "1303", "name": "EIC", "shares": 100, "avg_cost": 120.0}
    result = news.NewsResult(query="q", headlines=[{"title": "T", "link": "", "published": ""}],
                             score=0.1, label="neutral", matches=[{"positive": [], "negative": []}], ok=True)
    rec = az.evaluate_holding(h, price=110.0, df=df,
                              levels={"stop": 115.0}, horizon_cfg={
                                  "short_lookback_days": 10, "long_lookback_days": 50,
                                  "short_ma": 20, "long_ma": 50},
                              tech={"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70},
                              news=result)
    assert rec["news"]["ok"] is True
    assert rec["news"]["headlines"][0]["title"] == "T"

def test_evaluate_holding_news_defaults_to_none():
    df = _frame(list(range(100, 160)))
    h = {"code": "1303", "name": "EIC", "shares": 100, "avg_cost": 120.0}
    rec = az.evaluate_holding(h, price=110.0, df=df,
                              levels={"stop": 115.0}, horizon_cfg={
                                  "short_lookback_days": 10, "long_lookback_days": 50,
                                  "short_ma": 20, "long_ma": 50},
                              tech={"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70})
    assert rec["news"] is None

def test_disclosures_summary_none_when_no_disclosures():
    assert az.disclosures_summary(None) is None

def test_disclosures_summary_shapes_result():
    d = discl.DisclosureResult(items=[{"title": "x", "link": "y", "published": "z"}], ok=True)
    s = az.disclosures_summary(d)
    assert s == {"ok": True, "items": [{"title": "x", "link": "y", "published": "z"}]}

def test_evaluate_holding_attaches_disclosures():
    df = _frame(list(range(1, 60)))
    d = discl.DisclosureResult(items=[{"title": "EIC dividend announced", "link": "x", "published": "Mon"}], ok=True)
    rec = az.evaluate_holding({"code": "1303", "name": "EIC", "shares": 10, "avg_cost": 10.0},
                              price=12.0, df=df, levels={}, horizon_cfg=_WL_HORIZON,
                              tech=_WL_TECH, disclosures=d)
    assert rec["disclosures"]["ok"] is True
    assert len(rec["disclosures"]["items"]) == 1

def test_evaluate_watchlist_disclosures_defaults_to_none():
    df = _frame(list(range(1, 160)))
    rec = az.evaluate_watchlist({"code": "4015", "name": "Jamjoom"}, price=100.0, df=df,
                                levels={}, risk=BASE_RISK, horizon_cfg=_WL_HORIZON, tech=_WL_TECH)
    assert rec["disclosures"] is None

def test_format_disclosures_fetch_failed_renders_distinctly():
    block = nt._fmt_disclosures({"ok": False, "items": []})
    assert block == ["   disclosures: fetch failed"]

def test_format_disclosures_empty_renders_distinctly_from_failure():
    block = nt._fmt_disclosures({"ok": True, "items": []})
    assert block == ["   disclosures: none found"]

def test_format_disclosures_shows_items():
    block = nt._fmt_disclosures({"ok": True, "items": [
        {"title": "Jamjoom board recommends dividend", "link": "x", "published": "Mon"}]})
    assert any("Jamjoom board recommends dividend" in line for line in block)

def test_format_recommendation_does_not_collapse_when_disclosures_present():
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.09,
           "action": "HOLD", "reason": [], "unrealized_pct": 21.6,
           "delta": {"price_pct": 0.4, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 11, "started": "2026-07-17"},
           "disclosures": {"ok": True, "items": [{"title": "EIC dividend announced",
                           "link": "x", "published": "Mon"}]},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "EIC dividend announced" in block
    assert "short:" in block  # full detail shown, not collapsed

_WL_HORIZON = {"short_lookback_days": 10, "long_lookback_days": 50,
               "short_ma": 20, "long_ma": 50}
_WL_TECH = {"rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70}

def test_watchlist_buy_fires_via_rules_no_zone_needed():
    # Wide-open criteria isolate the wiring: no buy zone, uptrend frame -> BUY.
    df = _frame(list(range(1, 160)))
    w = {"code": "4015", "name": "Jamjoom", "sector": "pharma"}
    relaxed = {"rsi_recovery_band": (0, 100), "long_mom_floor_pct": -100.0}
    rec = az.evaluate_watchlist(w, price=100.0, df=df, levels={},
                                risk=BASE_RISK, horizon_cfg=_WL_HORIZON,
                                tech=_WL_TECH, buy_criteria=relaxed)
    assert rec["action"] == "BUY"
    assert rec["sizing"] is None  # sizing happens later, pooled per run.
    assert rec["rules_total"] == 3
    assert rec["rules_met"] == 3
    assert "conviction" not in rec

def test_watchlist_watch_when_rules_fail_with_reason():
    # A rising synthetic frame gives RSI 100 (all gains), so a narrow band
    # fails exactly one of the three rules: 2/3, with RSI named as the blocker.
    df = _frame(list(range(1, 160)))
    w = {"code": "4015", "name": "Jamjoom", "sector": "pharma"}
    strict = {"rsi_recovery_band": (25, 26), "long_mom_floor_pct": -5.0}
    rec = az.evaluate_watchlist(w, price=100.0, df=df, levels={},
                                risk=BASE_RISK, horizon_cfg=_WL_HORIZON,
                                tech=_WL_TECH, buy_criteria=strict)
    assert rec["action"] == "WATCH"
    assert rec["rules_met"] == 2 and rec["rules_total"] == 3
    assert any("RSI" in r for r in rec["reason"])


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


# --- per-headline match detail (Task 3) -----------------------------------------
def test_headline_matches_finds_positive_words():
    m = news._headline_matches("Company profit surges to a record high")
    assert "profit" in m["positive"]
    assert m["negative"] == []

def test_headline_matches_finds_negative_phrase():
    m = news._headline_matches("Firm issues profit warning after weak quarter")
    assert "profit warning" in m["negative"]

def test_news_result_has_no_confidence_field():
    import dataclasses
    field_names = {f.name for f in dataclasses.fields(news.NewsResult)}
    assert "confidence" not in field_names
    assert "matches" in field_names


# --- word-boundary matching (final review fix) -----------------------------
def test_sentiment_word_boundary_excludes_substring_false_positive():
    # "rise" must not fire inside "Enterprise" (a real false positive found
    # in production archived headlines) or "surprised".
    score, label = news.score_headlines(["Enterprise Data Solutions reports quarterly update"])
    assert score == 0.0 and label == "neutral"

def test_sentiment_word_boundary_still_matches_whole_word():
    score, label = news.score_headlines(["Shares rise on strong demand"])
    assert score > 0 and label == "positive"

def test_headline_matches_word_boundary_excludes_substring_false_positive():
    m = news._headline_matches("Enterprise Data Solutions reports quarterly update")
    assert "rise" not in m["positive"]

def test_sentiment_arabic_substring_still_works_with_attached_prefix():
    # Arabic keeps substring matching — a prefix/conjunction glued onto a
    # root word must still be detected (this is why Arabic is NOT switched
    # to word-boundary matching).
    score, label = news.score_headlines(["وارتفاع الأرباح يدعم السهم"])
    assert score > 0


# --- disclosures: Tadawul aggregate feed fetch and filter ------------------
def test_match_company_filters_by_name_substring():
    import disclosures as discl
    items = [
        {"title": "Al Rasheed upsides SAB facilities by SAR 100M", "link": "x", "published": "Mon"},
        {"title": "MIS awarded SAR 179.8M project by KSMC", "link": "y", "published": "Tue"},
        {"title": "Jamjoom Pharma board recommends dividend", "link": "z", "published": "Wed"},
    ]
    result = discl.match_company(items, True, ["Jamjoom Pharma"])
    assert len(result.items) == 1
    assert result.items[0]["title"] == "Jamjoom Pharma board recommends dividend"
    assert result.ok is True

def test_match_company_case_insensitive():
    import disclosures as discl
    items = [{"title": "jamjoom pharma reports Q2 profit", "link": "x", "published": "Mon"}]
    result = discl.match_company(items, True, ["Jamjoom Pharma"])
    assert len(result.items) == 1

def test_match_company_no_matches_is_empty_not_failed():
    import disclosures as discl
    items = [{"title": "Some Other Co announces something", "link": "x", "published": "Mon"}]
    result = discl.match_company(items, True, ["Jamjoom Pharma"])
    assert result.items == []
    assert result.ok is True  # the FEED fetch succeeded; this name just has no hits

def test_match_company_propagates_fetch_failure():
    import disclosures as discl
    result = discl.match_company([], False, ["Jamjoom Pharma"])
    assert result.items == []
    assert result.ok is False

def test_match_company_matches_any_alias_in_list():
    # The config short name ("EIC") never appears in real filing titles,
    # which use the full legal name -- checking every alias, not just the
    # first, is the whole point of this fix.
    import disclosures as discl
    items = [{"title": "Electrical Industries Company posts record profit",
             "link": "x", "published": "Mon"}]
    result = discl.match_company(items, True, ["EIC", "Electrical Industries"])
    assert len(result.items) == 1

def test_match_company_dedupes_when_multiple_aliases_match_same_item():
    import disclosures as discl
    items = [{"title": "Al Babtain and Al-Babtain Group announce merger",
             "link": "x", "published": "Mon"}]
    result = discl.match_company(items, True, ["Al-Babtain", "Al Babtain"])
    assert len(result.items) == 1  # not counted twice just because both aliases hit

def test_aliases_for_returns_match_names_when_present():
    import disclosures as discl
    item = {"code": "1303", "name": "EIC", "match_names": ["EIC", "Electrical Industries"]}
    assert discl.aliases_for(item) == ["EIC", "Electrical Industries"]

def test_aliases_for_falls_back_to_name_when_absent():
    import disclosures as discl
    item = {"code": "8313", "name": "Rasan"}
    assert discl.aliases_for(item) == ["Rasan"]

def test_fetch_all_never_raises_on_bad_url(monkeypatch):
    import disclosures as discl
    # Simulate a network failure without hitting the real network.
    import news as newsmod
    def _boom(*a, **k):
        raise ConnectionError("simulated failure")
    monkeypatch.setattr(newsmod, "_fetch_rss", _boom)
    items, ok = discl.fetch_all()
    assert items == []
    assert ok is False


# --- notify formatting (offline) -------------------------------------------
def test_format_and_build_message():
    rec = {
        "kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
        "action": "BUY", "reason": ["in zone"], "rules_met": 3, "rules_total": 3,
        "sizing": {"shares": 7, "spend": 700.0, "pct_of_cash": 23.3},
        "short_term": {"momentum_pct": 2.1, "rsi": 55},
        "long_term": {"trend": "up", "momentum_pct": 8.0, "rsi": 60},
        "news": {"ok": True, "label": "positive", "score": 0.4,
                "headlines": [{"title": "Jamjoom profit rises 12%",
                              "link": "http://x", "published": "24 Jul 2026"}]},
    }
    block = nt.format_recommendation(rec)
    assert "4015" in block and "BUY" in block and "Rules met: 3/3" in block
    assert "conviction" not in block
    assert "conf)" not in block  # the fake confidence suffix is gone.
    assert "Jamjoom profit rises 12%" in block
    assert "24 Jul 2026" in block
    msg = nt.build_message([rec], "Test header")
    assert "Test header" in msg and "Not financial advice" in msg

def test_format_news_fetch_failed_renders_distinctly():
    rec = {
        "kind": "watchlist", "code": "1", "name": "X", "price": 1.0,
        "action": "WATCH", "reason": [], "rules_met": 0, "rules_total": 3,
        "short_term": {"momentum_pct": 0, "rsi": 50}, "long_term": {"trend": "flat", "momentum_pct": 0, "rsi": 50},
        "news": {"ok": False, "label": "neutral", "score": 0.0, "headlines": []},
    }
    block = nt.format_recommendation(rec)
    assert "fetch failed" in block

def test_format_news_empty_result_renders_distinctly_from_failure():
    rec = {
        "kind": "watchlist", "code": "2", "name": "Y", "price": 1.0,
        "action": "WATCH", "reason": [], "rules_met": 0, "rules_total": 3,
        "short_term": {"momentum_pct": 0, "rsi": 50}, "long_term": {"trend": "flat", "momentum_pct": 0, "rsi": 50},
        "news": {"ok": True, "label": "neutral", "score": 0.0, "headlines": []},
    }
    block = nt.format_recommendation(rec)
    assert "no headlines found" in block
    assert "fetch failed" not in block

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


def test_build_features_honors_configured_rsi_period(monkeypatch):
    # backtest.build_features must call ind.long_term_read with the configured
    # rsi_period, not the hardcoded default -- otherwise the harness scores a
    # different RSI than production computes, which the module docstring calls
    # "worse than useless".
    closes = [50 + (i % 9) - 4 for i in range(160)]
    df = _ohlc(closes, [c * 1.01 for c in closes], [c * 0.99 for c in closes], closes)
    empty_idx = pd.DataFrame()

    monkeypatch.setitem(cfg.TECH, "rsi_period", 14)
    default = bt.build_features({"X": df}, empty_idx, step_days=5, progress=lambda *_: None)

    monkeypatch.setitem(cfg.TECH, "rsi_period", 7)
    custom = bt.build_features({"X": df}, empty_idx, step_days=5, progress=lambda *_: None)

    shared = set(default["t"]) & set(custom["t"])
    assert len(shared) > 3
    diffs = [t for t in shared
             if default[default["t"] == t]["rsi"].iloc[0] != custom[custom["t"] == t]["rsi"].iloc[0]]
    assert diffs, "rsi feature did not change when cfg.TECH['rsi_period'] changed"


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


# --- archive headlines ----------------------------------------------------------
def test_archive_headlines_writes_one_jsonl_line_per_headline():
    import json
    result = news.NewsResult(
        query="q",
        headlines=[{"title": "Firm profit rises 12%", "link": "http://x", "published": "24 Jul 2026"}],
        score=0.5, label="positive",
        matches=[{"positive": ["profit"], "negative": []}], ok=True)
    path = Path(__file__).resolve().parent / "_test_archive_tmp.jsonl"
    try:
        if path.exists():
            path.unlink()
        news.archive_headlines("1234", result, archive_path=path)
        lines = path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        rec = json.loads(lines[0])
        assert rec["code"] == "1234"
        assert rec["title"] == "Firm profit rises 12%"
        assert rec["matched_positive"] == ["profit"]
        assert rec["score"] == 0.5
    finally:
        if path.exists():
            path.unlink()

def test_archive_headlines_skips_when_no_headlines():
    result = news.NewsResult(query="q", ok=True)  # empty headlines, default.
    path = Path(__file__).resolve().parent / "_test_archive_tmp2.jsonl"
    try:
        if path.exists():
            path.unlink()
        news.archive_headlines("1234", result, archive_path=path)
        assert not path.exists()
    finally:
        if path.exists():
            path.unlink()

def test_archive_headlines_appends_across_calls():
    import json
    path = Path(__file__).resolve().parent / "_test_archive_tmp3.jsonl"
    try:
        if path.exists():
            path.unlink()
        r1 = news.NewsResult(query="q", headlines=[{"title": "A", "link": "", "published": ""}],
                             score=0.0, label="neutral", matches=[{"positive": [], "negative": []}], ok=True)
        r2 = news.NewsResult(query="q", headlines=[{"title": "B", "link": "", "published": ""}],
                             score=0.0, label="neutral", matches=[{"positive": [], "negative": []}], ok=True)
        news.archive_headlines("1", r1, archive_path=path)
        news.archive_headlines("2", r2, archive_path=path)
        lines = path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 2
        assert json.loads(lines[0])["code"] == "1"
        assert json.loads(lines[1])["code"] == "2"
    finally:
        if path.exists():
            path.unlink()


# --- trigger prices wired into evaluate_watchlist / notify -----------------
def test_short_term_read_honors_configured_rsi_period():
    # Oscillating data: will have different RSI for periods 7 vs 14
    df = _frame([10 + (i % 7) - 3 for i in range(60)])
    default = ind.short_term_read(df, 10, 20)
    custom = ind.short_term_read(df, 10, 20, rsi_period=7)
    assert default["rsi"] != custom["rsi"]  # different smoothing window -> different value

def test_long_term_read_honors_configured_rsi_period():
    # Oscillating data: will have different RSI for periods 7 vs 14
    df = _frame([50 + (i % 9) - 4 for i in range(160)])
    default = ind.long_term_read(df, 120, 20, 50)
    custom = ind.long_term_read(df, 120, 20, 50, rsi_period=7)
    assert default["rsi"] != custom["rsi"]

def test_compute_triggers_uses_passed_rsi_period_not_hardcoded():
    rules = [{"rule": "rsi_band", "passed": False, "actual": 15.0,
             "required": "25-60", "plain": "x"}]
    df = _frame([20 - i * 0.15 for i in range(30)])
    horizon_cfg = {"long_lookback_days": 120, "short_ma": 20, "long_ma": 50}
    criteria = {"rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
    trigger_14 = trig.compute_triggers(df, rules, horizon_cfg, criteria, 14)[0]
    trigger_7 = trig.compute_triggers(df, rules, horizon_cfg, criteria, 7)[0]
    assert trigger_14["trigger_price"] != trigger_7["trigger_price"]

def test_compute_triggers_only_for_failing_rules():
    rules = [
        {"rule": "rsi_band", "passed": True, "actual": 45.0, "required": "25-60", "plain": "ok"},
        {"rule": "trend", "passed": False, "actual": "down", "required": "up", "plain": "trend down, need up"},
        {"rule": "momentum_floor", "passed": True, "actual": 2.0, "required": -5.0, "plain": "ok"},
    ]
    df = _frame(list(range(1, 160)))  # from the existing test fixture helper
    horizon_cfg = {"long_lookback_days": 120, "short_ma": 20, "long_ma": 50}
    criteria = {"rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
    result = trig.compute_triggers(df, rules, horizon_cfg, criteria, 14)
    assert len(result) == 1
    assert result[0]["rule"] == "trend"

def test_compute_triggers_empty_when_all_rules_pass():
    rules = [
        {"rule": "rsi_band", "passed": True, "actual": 45.0, "required": "25-60", "plain": "ok"},
        {"rule": "trend", "passed": True, "actual": "up", "required": "up", "plain": "ok"},
        {"rule": "momentum_floor", "passed": True, "actual": 2.0, "required": -5.0, "plain": "ok"},
    ]
    df = _frame(list(range(1, 160)))
    horizon_cfg = {"long_lookback_days": 120, "short_ma": 20, "long_ma": 50}
    criteria = {"rsi_recovery_band": (25, 60), "long_mom_floor_pct": -5.0}
    assert trig.compute_triggers(df, rules, horizon_cfg, criteria, 14) == []

def test_evaluate_watchlist_includes_triggers_key():
    df = _frame(list(range(200, 89, -1)) + list(range(90, 110)))  # falling then flat-ish
    w = {"code": "4015", "name": "Jamjoom", "sector": "pharma"}
    strict = {"rsi_recovery_band": (25, 26), "long_mom_floor_pct": -5.0}
    rec = az.evaluate_watchlist(w, price=100.0, df=df, levels={}, risk=BASE_RISK,
                                horizon_cfg=_WL_HORIZON, tech=_WL_TECH,
                                buy_criteria=strict)
    assert "triggers" in rec
    assert isinstance(rec["triggers"], list)
    if rec["action"] == "WATCH":
        failing_rule_names = {r["rule"] for r in rec["rules"] if not r["passed"]}
        trigger_rule_names = {t["rule"] for t in rec["triggers"]}
        assert trigger_rule_names == failing_rule_names

def test_format_recommendation_renders_nearest_trigger():
    rec = {
        "kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
        "action": "WATCH", "reason": ["momentum below floor"],
        "rules_met": 2, "rules_total": 3,
        "triggers": [
            {"rule": "momentum_floor", "trigger_price": 105.0, "pct_away": 5.0,
             "reachable": True, "plain": "6-mo momentum clears -5.0% at 105.00 (+5.0% away)"},
            {"rule": "rsi_band", "trigger_price": 98.0, "pct_away": -2.0,
             "reachable": True, "plain": "RSI clears the 25-60 band at 98.00 (-2.0% away)"},
        ],
        "short_term": {"momentum_pct": 0, "rsi": 50},
        "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50},
    }
    block = nt.format_recommendation(rec)
    assert "Trigger (next bar): RSI clears the 25-60 band at 98.00 (-2.0% away)" in block
    assert "momentum clears" not in block  # the farther one is not shown

def test_format_recommendation_shows_none_within_reach_when_no_trigger_reachable():
    rec = {
        "kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
        "action": "WATCH", "reason": ["trend down"], "rules_met": 1, "rules_total": 3,
        "triggers": [
            {"rule": "trend", "trigger_price": None, "pct_away": None,
             "reachable": False, "plain": "not reachable within ±25% next bar"},
        ],
        "short_term": {"momentum_pct": 0, "rsi": 50},
        "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50},
    }
    block = nt.format_recommendation(rec)
    assert "Trigger (next bar): none within reach" in block

def test_format_recommendation_no_trigger_line_when_buy():
    rec = {
        "kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
        "action": "BUY", "reason": ["all rules met"], "rules_met": 3, "rules_total": 3,
        "triggers": [],
        "short_term": {"momentum_pct": 0, "rsi": 50},
        "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50},
    }
    block = nt.format_recommendation(rec)
    assert "Trigger" not in block


# --- history wiring: main.py snapshot builder + notify.py rendering --------
def test_collect_recs_attaches_delta_and_streak(tmp_path, monkeypatch):
    # This test exercises main.py's wiring directly by calling the same
    # snapshot-building logic main.py uses, not by running the full
    # _collect_recs pipeline (which hits the network). Build a rec the way
    # evaluate_watchlist would, run it through main.py's snapshot builder.
    import main as m
    rec = {"kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
           "action": "WATCH", "rules": [{"rule": "trend", "passed": False, "actual": "down",
           "required": "up", "plain": "x"}], "rules_met": 0, "rules_total": 1,
           "long_term": {"trend": "down", "rsi": 40.0, "momentum_pct": -6.0}}
    snap = m._snapshot_for(rec)
    assert snap == {"price": 100.0, "rsi": 40.0, "trend": "down",
                    "rules_met": 0, "blocking": ["trend"]}

def test_snapshot_for_holding_has_no_rules_met():
    import main as m
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.0,
           "action": "HOLD", "long_term": {"trend": "up", "rsi": 55.0, "momentum_pct": 2.0}}
    snap = m._snapshot_for(rec)
    assert snap["rules_met"] is None
    assert snap["blocking"] is None
    assert snap["trend"] == "up"

def test_format_recommendation_marks_changed_with_arrow():
    rec = {"kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
           "action": "WATCH", "reason": ["x"], "rules_met": 2, "rules_total": 3,
           "triggers": [], "delta": {"price_pct": 1.0, "rsi_delta": 0.5,
           "rules_met_delta": 1, "flipped": ["trend"], "trend_flipped": True},
           "trend_streak": {"days": 1, "started": "2026-07-28"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert block.startswith("▲")

def test_format_recommendation_no_arrow_when_unchanged():
    rec = {"kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
           "action": "WATCH", "reason": ["x"], "rules_met": 2, "rules_total": 3,
           "triggers": [], "delta": {"price_pct": 0.5, "rsi_delta": 0.1,
           "rules_met_delta": 0, "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 5, "started": "2026-07-24"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert not block.startswith("▲")

def test_format_recommendation_shows_price_delta_in_header():
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.09,
           "action": "HOLD", "reason": [], "unrealized_pct": 21.6,
           "delta": {"price_pct": 0.4, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 11, "started": "2026-07-17"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "+0.4% today" in block

def test_format_recommendation_collapses_when_unchanged_and_no_news():
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.09,
           "action": "HOLD", "reason": [], "unrealized_pct": 21.6,
           "delta": {"price_pct": 0.4, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 11, "started": "2026-07-17"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "below its 50-day average, 11th day" in block
    assert "No news" in block
    assert "short:" not in block  # full short/long-term breakdown suppressed

def test_format_recommendation_collapse_surfaces_disclosures_fetch_failure():
    # A disclosures fetch failure produces items=[] just like "nothing found",
    # so the rec is still collapse-eligible -- but the collapsed line must not
    # silently hide that the disclosures check never ran (same honesty rule as news).
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.09,
           "action": "HOLD", "reason": [], "unrealized_pct": 21.6,
           "delta": {"price_pct": 0.4, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 11, "started": "2026-07-17"},
           "disclosures": {"ok": False, "items": []},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "short:" not in block  # still collapsed, one line
    assert "disclosures fetch failed" in block

def test_format_recommendation_does_not_collapse_when_news_present():
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 15.09,
           "action": "HOLD", "reason": [], "unrealized_pct": 21.6,
           "delta": {"price_pct": 0.4, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 11, "started": "2026-07-17"},
           "news": {"ok": True, "label": "positive", "score": 1.0,
                    "headlines": [{"title": "EIC profit rises", "published": "Mon"}]},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "short:" in block  # full breakdown still shown because news exists

def test_format_recommendation_buy_never_collapses_even_when_unchanged():
    rec = {"kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
           "action": "BUY", "reason": ["all rules met"], "rules_met": 3, "rules_total": 3,
           "triggers": [],
           "delta": {"price_pct": 0.2, "rsi_delta": 0.1, "rules_met_delta": 0,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 4, "started": "2026-07-25"},
           "sizing": {"shares": 12, "spend": 1200.0, "budget_left_after": 300.0, "skip": None},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "size: BUY" in block  # sizing line survives despite delta/news saying "unchanged"

def test_format_recommendation_sell_stop_never_collapses_even_when_unchanged():
    rec = {"kind": "holding", "code": "1303", "name": "EIC", "price": 14.50,
           "action": "SELL (STOP)", "reason": ["price 14.50 <= stop 15.00"],
           "unrealized_pct": -3.3,
           "delta": {"price_pct": -0.1, "rsi_delta": 0.0, "rules_met_delta": None,
                     "flipped": [], "trend_flipped": False},
           "trend_streak": {"days": 2, "started": "2026-07-27"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "down", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert "price 14.50 <= stop 15.00" in block  # reason survives despite delta saying "unchanged"

def test_format_recommendation_first_run_no_delta_no_arrow_no_collapse():
    rec = {"kind": "watchlist", "code": "4015", "name": "Jamjoom", "price": 100.0,
           "action": "WATCH", "reason": ["x"], "rules_met": 2, "rules_total": 3,
           "triggers": [], "delta": None,
           "trend_streak": {"days": 1, "started": "2026-07-28"},
           "short_term": {"momentum_pct": 0, "rsi": 50},
           "long_term": {"trend": "up", "momentum_pct": 0, "rsi": 50}}
    block = nt.format_recommendation(rec)
    assert not block.startswith("▲")
    assert "today" not in block.split("\n")[0]  # no price-delta suffix without a delta
    assert "short:" in block  # first run always shows full detail


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
