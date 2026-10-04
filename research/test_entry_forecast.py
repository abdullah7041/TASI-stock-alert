import json
import sys

import pytest

import pandas as pd

from research.entry_forecast import (_main, build_point_in_time_dataset, evaluate_forecast_dataset,
                                     purged_time_splits, release_gate, unavailable_forecast, write_forecast_metrics)
from research.entry_outcomes import label_entry_outcome


def test_same_daily_bar_touching_target_and_stop_counts_as_stop():
    frame = pd.DataFrame({"Open": [10, 10], "High": [10, 14], "Low": [10, 8], "Close": [10, 10]})
    assert label_entry_outcome(frame, 0, atr=1.0, max_hold=1)["outcome"] == "stop"


def test_shortened_history_cannot_label_a_sixty_session_forecast_even_after_an_early_hit():
    """Otherwise mature losses and early winners would have different inclusion rules."""
    frame = pd.DataFrame({"Open": [10, 10], "High": [10, 14], "Low": [10, 9], "Close": [10, 12]})
    assert label_entry_outcome(frame, 0, atr=1.0) is None


def test_missing_terminal_settlement_or_invalid_prices_cannot_be_a_completed_outcome():
    """A delisting with no documented settlement is censored, not a fabricated exit."""
    frame = pd.DataFrame({"Open": [10] * 61, "High": [11] * 61, "Low": [9] * 61, "Close": [10] * 61})
    frame.loc[60, "Close"] = float("nan")
    assert label_entry_outcome(frame, 0, atr=1.0) is None


def test_feature_preparation_does_not_learn_categories_from_future_rows():
    """Categorical encoding must be fitted inside each chronologically purged model."""
    from research.entry_forecast import _design_matrix
    prepared = _design_matrix(pd.DataFrame({"regime": ["up", "future-only"]}), ["regime"])
    assert list(prepared.columns) == ["regime"]
    assert list(prepared["regime"]) == ["up", "future-only"]


def test_a_fold_missing_neither_cannot_claim_complete_three_class_calibration():
    dates = pd.bdate_range("2021-01-01", periods=600)
    frame = pd.DataFrame({"date": dates, "code": "1000", "outcome": ["target", "stop"] * 300,
                          "rsi": [30.0, 70.0] * 300, "regime": "up", "return_pct": [2.0, -1.0] * 300})
    metrics = evaluate_forecast_dataset(frame, ["rsi", "regime"], survivorship_limited=True, transaction_cost_pct=0.4)
    assert metrics["calibrated_folds"] == 0
    assert metrics["sample_size"] == 405
    assert not metrics["stable"]


def test_release_requires_positive_expectancy_at_both_approved_cost_assumptions():
    metrics = {"brier_skill": 0.1, "log_loss_skill": 0.1, "ece": 0.02, "expectancy": 0.2,
               "sample_size": 400, "bootstrap_lower": 0.01, "stable": True,
               "evaluation": "purged-rolling", "purge_sessions": 60,
               "calibration_method": "purged-sigmoid", "calibrated_folds": 3, "folds": 3,
               "transaction_cost_pct": 0.4, "selected_count": 100, "regime_skills": {"up": [0.1]},
               "survivorship_limited": False, "membership_provenance": "official-historical-snapshots",
               "cost_sensitivity": {"0.4": 0.2, "0.8": -0.2}}
    ok, reasons = release_gate(metrics, False)
    assert not ok
    assert "0.4% and 0.8%" in " ".join(reasons)


def test_encoder_never_fits_future_categories_and_reports_both_cost_scenarios(monkeypatch):
    """Exercise real fitting: a category confined to held-out dates stays unseen."""
    from sklearn.preprocessing import OneHotEncoder
    fitted_categories = []
    original_fit = OneHotEncoder.fit

    def record_fit(self, values, *args, **kwargs):
        fitted_categories.extend(pd.DataFrame(values).to_numpy().flatten().tolist())
        return original_fit(self, values, *args, **kwargs)

    monkeypatch.setattr(OneHotEncoder, "fit", record_fit)
    labels = ["target", "stop", "neither"] * 200
    frame = pd.DataFrame({"date": pd.bdate_range("2021-01-01", periods=600), "code": "1000",
                          "outcome": labels, "rsi": [30.0, 50.0, 70.0] * 200,
                          "regime": ["up"] * 465 + ["future-only"] * 135,
                          "return_pct": [2.0, -1.0, 0.0] * 200})
    metrics = evaluate_forecast_dataset(frame, ["rsi", "regime"], survivorship_limited=True, transaction_cost_pct=0.4)
    assert fitted_categories
    assert "future-only" not in fitted_categories
    assert metrics["selected_count"] > 0
    assert metrics["cost_sensitivity"]["0.4"] - metrics["cost_sensitivity"]["0.8"] == pytest.approx(0.4)


def test_missing_delisted_history_keeps_membership_dataset_unqualified():
    """Removing an exited issuer silently would recreate survivorship bias."""
    features = pd.DataFrame({"code": ["1000", "2000"], "date": pd.to_datetime(["2024-01-05"] * 2),
                             "t": [0, 0], "atr": [1.0, 1.0]})
    history = {"1000": pd.DataFrame({"Open": [10, 10], "High": [10, 11], "Low": [10, 9], "Close": [10, 10]})}
    membership = pd.DataFrame({"code": ["1000", "2000"], "startDate": ["2024-01-01"] * 2,
                               "endDate": ["2024-12-31"] * 2,
                               "sourceUrl": ["https://www.saudiexchange.sa/snapshot"] * 2,
                               "sourcePublishedAt": ["2024-01-01"] * 2, "sourceKind": ["historical-snapshot"] * 2})
    dataset = build_point_in_time_dataset(features, history, membership, max_hold=1)
    assert dataset.attrs["historical_membership_verified"] is False
    assert dataset.attrs["unresolved_outcomes"] == 1


def test_release_gate_rejects_model_that_does_not_beat_base_rate():
    ok, reasons = release_gate({"brier_skill": -0.01, "log_loss_skill": 0.02, "ece": 0.03, "expectancy": 0.5, "stable": True, "sample_size": 500, "bootstrap_lower": 0.01}, False)
    assert not ok
    assert "Brier" in " ".join(reasons)


def test_purged_time_splits_leave_sixty_complete_sessions_between_train_and_test():
    dates = pd.bdate_range("2024-01-01", periods=420)
    frame = pd.DataFrame({"date": dates, "outcome": ["target", "stop"] * 210, "rsi": range(420)})

    folds = purged_time_splits(frame, n_splits=3, purge_sessions=60)

    assert len(folds) == 3
    for train, test in folds:
        assert frame.iloc[test]["date"].min() > frame.iloc[train]["date"].max()
        gap = dates.get_loc(frame.iloc[test]["date"].min()) - dates.get_loc(frame.iloc[train]["date"].max()) - 1
        assert gap >= 60


def test_point_in_time_dataset_excludes_a_name_before_it_was_an_index_member():
    features = pd.DataFrame({"code": ["1000", "1000"], "date": pd.to_datetime(["2024-01-02", "2024-01-05"]),
                             "t": [0, 1], "rsi": [50.0, 52.0], "atr": [1.0, 1.0], "regime": ["up", "up"]})
    history = {"1000": pd.DataFrame({"Open": [10, 10, 10], "High": [10, 14, 10], "Low": [10, 9, 8], "Close": [10, 10, 10]})}
    membership = pd.DataFrame({"code": ["1000"], "startDate": ["2024-01-04"], "endDate": ["2024-12-31"]})

    dataset = build_point_in_time_dataset(features, history, membership, max_hold=1)

    assert list(dataset["date"].dt.strftime("%Y-%m-%d")) == ["2024-01-05"]
    assert dataset.iloc[0]["outcome"] == "stop"


def test_evaluator_marks_current_listing_data_survivorship_limited_and_writes_metrics(tmp_path):
    dates = pd.bdate_range("2023-01-02", periods=420)
    outcomes = (["target", "stop", "neither"] * 140)[:len(dates)]
    frame = pd.DataFrame({"date": dates, "code": ["1000"] * len(dates), "outcome": outcomes,
                          "rsi": [30 + (i % 40) for i in range(len(dates))], "regime": ["up", "down"] * 210,
                          "return_pct": [2.0 if outcome == "target" else -1.0 for outcome in outcomes]})

    metrics = evaluate_forecast_dataset(frame, ["rsi", "regime"], survivorship_limited=True,
                                        transaction_cost_pct=0.2, n_splits=3)
    target = tmp_path / "forecast_metrics.json"
    write_forecast_metrics(target, metrics)

    assert metrics["survivorship_limited"] is True
    assert not release_gate(metrics, metrics["survivorship_limited"])[0]
    assert json.loads(target.read_text(encoding="utf-8"))["sample_size"] == 270

    # A caller boolean cannot certify an arbitrary current-listing CSV.
    claimed = evaluate_forecast_dataset(frame, ["rsi", "regime"], survivorship_limited=False,
                                         transaction_cost_pct=0.2, n_splits=3)
    assert claimed["survivorship_limited"] is True
    assert metrics["calibration_method"] == "purged-sigmoid"
    assert metrics["transaction_cost_pct"] == 0.2


def test_evaluator_rejects_missing_real_returns_or_transaction_costs():
    dates = pd.bdate_range("2023-01-02", periods=420)
    frame = pd.DataFrame({"date": dates, "code": ["1000"] * len(dates),
                          "outcome": (["target", "stop", "neither"] * 140),
                          "rsi": [float(i % 40) for i in range(len(dates))], "regime": ["up"] * len(dates)})
    with pytest.raises(ValueError, match="return_pct"):
        evaluate_forecast_dataset(frame, ["rsi"], survivorship_limited=True, transaction_cost_pct=0.2)
    frame["return_pct"] = 1.0
    with pytest.raises(ValueError, match="transaction_cost_pct"):
        evaluate_forecast_dataset(frame, ["rsi"], survivorship_limited=True)


def test_cli_cannot_assert_away_survivorship_bias(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["entry_forecast", "dataset.csv", "--features", "rsi", "--point-in-time-constituents"])
    with pytest.raises(SystemExit) as error:
        _main()
    assert error.value.code == 2


def test_survivorship_flag_blocks_an_otherwise_passing_forecast_forever():
    metrics = {"brier_skill": 0.1, "log_loss_skill": 0.1, "ece": 0.01, "expectancy": 0.1,
               "stable": True, "sample_size": 500, "bootstrap_lower": 0.01}

    ok, reasons = release_gate(metrics, survivorship_limited=True)

    assert not ok
    assert "survivorship-limited" in " ".join(reasons)


def test_passing_offline_metrics_still_abstain_without_forecast_contract():
    metrics = {"brier_skill": 0.1, "log_loss_skill": 0.1, "ece": 0.01, "expectancy": 0.1,
               "stable": True, "sample_size": 500, "bootstrap_lower": 0.01, "model_version": "offline",
               "evaluation": "purged-rolling", "purge_sessions": 60, "calibration_method": "purged-sigmoid",
               "calibrated_folds": 3, "folds": 3, "transaction_cost_pct": 0.2, "selected_count": 100,
               "regime_skills": {"up": [0.1, 0.1, 0.1]}, "survivorship_limited": False,
               "membership_provenance": "official-historical-snapshots", "cost_sensitivity": {"0.4": 0.2, "0.8": 0.1}}
    result = unavailable_forecast("2026-09-22", metrics, False)
    assert result["status"] == "unavailable"
    assert "forecast" in result["reason"].lower()


def test_release_gate_rejects_metrics_without_purged_calibration_cost_and_regime_proof():
    metrics = {"brier_skill": 0.1, "log_loss_skill": 0.1, "ece": 0.01, "expectancy": 0.1,
               "stable": True, "sample_size": 500, "bootstrap_lower": 0.01}
    ok, reasons = release_gate(metrics, False)
    assert not ok
    assert "calibration" in " ".join(reasons).lower()
    assert "cost" in " ".join(reasons).lower()


def test_point_in_time_builder_skips_terminal_rows_without_a_future_entry():
    features = pd.DataFrame({"code": ["1000"], "date": ["2024-01-02"], "t": [1], "atr": [1.0]})
    history = {"1000": pd.DataFrame({"Open": [10, 10], "High": [10, 10], "Low": [10, 10], "Close": [10, 10]})}
    membership = pd.DataFrame({"code": ["1000"], "startDate": ["2024-01-01"], "endDate": ["2024-12-31"]})
    assert build_point_in_time_dataset(features, history, membership).empty
