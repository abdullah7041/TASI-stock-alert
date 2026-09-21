import pandas as pd

from research.entry_forecast import release_gate
from research.entry_outcomes import label_entry_outcome


def test_same_daily_bar_touching_target_and_stop_counts_as_stop():
    frame = pd.DataFrame({"Open": [10, 10], "High": [10, 14], "Low": [10, 8], "Close": [10, 10]})
    assert label_entry_outcome(frame, 0, atr=1.0)["outcome"] == "stop"


def test_release_gate_rejects_model_that_does_not_beat_base_rate():
    ok, reasons = release_gate({"brier_skill": -0.01, "log_loss_skill": 0.02, "ece": 0.03, "expectancy": 0.5, "stable": True, "sample_size": 500, "bootstrap_lower": 0.01}, False)
    assert not ok
    assert "Brier" in " ".join(reasons)


def test_release_gate_rejects_non_finite_metrics():
    metrics = {"brier_skill": float("nan"), "log_loss_skill": 0.02, "ece": 0.03,
               "expectancy": 0.5, "stable": True, "sample_size": 500,
               "bootstrap_lower": 0.01}
    ok, reasons = release_gate(metrics, False)
    assert not ok
    assert "finite" in " ".join(reasons).lower()
