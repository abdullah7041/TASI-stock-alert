import json

import pandas as pd

from research.entry_forecast import (build_point_in_time_dataset, evaluate_forecast_dataset,
                                     purged_time_splits, release_gate, write_forecast_metrics)
from research.entry_outcomes import label_entry_outcome


def test_same_daily_bar_touching_target_and_stop_counts_as_stop():
    frame = pd.DataFrame({"Open": [10, 10], "High": [10, 14], "Low": [10, 8], "Close": [10, 10]})
    assert label_entry_outcome(frame, 0, atr=1.0)["outcome"] == "stop"


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
                          "rsi": [30 + (i % 40) for i in range(len(dates))], "regime": ["up", "down"] * 210})

    metrics = evaluate_forecast_dataset(frame, ["rsi", "regime"], survivorship_limited=True, n_splits=3)
    target = tmp_path / "forecast_metrics.json"
    write_forecast_metrics(target, metrics)

    assert metrics["survivorship_limited"] is True
    assert not release_gate(metrics, metrics["survivorship_limited"])[0]
    assert json.loads(target.read_text(encoding="utf-8"))["sample_size"] == len(frame)


def test_survivorship_flag_blocks_an_otherwise_passing_forecast_forever():
    metrics = {"brier_skill": 0.1, "log_loss_skill": 0.1, "ece": 0.01, "expectancy": 0.1,
               "stable": True, "sample_size": 500, "bootstrap_lower": 0.01}

    ok, reasons = release_gate(metrics, survivorship_limited=True)

    assert not ok
    assert "survivorship-limited" in " ".join(reasons)
