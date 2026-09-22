"""Offline-only, point-in-time validation for the abstaining entry forecast.

Nothing in this module is imported by the decision, sizing, alert, or Discord
paths. Its only durable product is a metrics document which ``main._forecast``
uses to decide whether it must continue to abstain.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from research.entry_outcomes import label_entry_outcome

OUTCOMES = ("target", "stop", "neither")
PURGE_SESSIONS = 60


def release_gate(metrics: dict, survivorship_limited: bool) -> tuple[bool, list[str]]:
    reasons = []
    if metrics.get("brier_skill", 0) <= 0: reasons.append("Brier score did not beat the base rate.")
    if metrics.get("log_loss_skill", 0) <= 0: reasons.append("Log loss did not beat the base rate.")
    if metrics.get("ece", 1) > 0.05: reasons.append("Calibration error exceeds 0.05.")
    if metrics.get("expectancy", 0) <= 0: reasons.append("After-cost expectancy is not positive.")
    if not metrics.get("stable", False): reasons.append("Out-of-sample skill is not stable across periods and regimes.")
    if metrics.get("sample_size", 0) < 300: reasons.append("Sample size is inadequate.")
    if metrics.get("bootstrap_lower", 0) <= 0: reasons.append("Bootstrap uncertainty includes zero skill.")
    if survivorship_limited: reasons.append("Dataset is survivorship-limited.")
    return not reasons, reasons

def unavailable_forecast(as_of: str, metrics: dict, survivorship_limited: bool) -> dict:
    ok, reasons = release_gate(metrics, survivorship_limited)
    if not ok: return {"status": "unavailable", "asOf": as_of, "reason": " ".join(reasons)}
    return {"status": "available", "asOf": as_of, "target": metrics["target"], "stop": metrics["stop"], "horizonSessions": 60, "targetFirstPct": metrics["target_first_pct"], "confidence": metrics["confidence"], "modelVersion": metrics["model_version"]}


def purged_time_splits(frame: pd.DataFrame, *, n_splits: int = 3,
                       purge_sessions: int = PURGE_SESSIONS) -> list[tuple[np.ndarray, np.ndarray]]:
    """Expanding chronological folds with an entire holding horizon removed."""
    if "date" not in frame:
        raise ValueError("dataset must include decision date")
    dates = pd.DatetimeIndex(pd.to_datetime(frame["date"], errors="raise").drop_duplicates().sort_values())
    if len(dates) < (n_splits + 1) * 2 + purge_sessions:
        raise ValueError("not enough decision sessions for purged evaluation")
    test_width = max(1, (len(dates) - purge_sessions) // (n_splits + 1))
    normalized = pd.to_datetime(frame["date"])
    folds = []
    for fold in range(n_splits):
        train_end = test_width * (fold + 1)
        test_start = train_end + purge_sessions
        test_end = min(test_start + test_width, len(dates))
        if train_end == 0 or test_start >= test_end:
            continue
        train_dates, test_dates = dates[:train_end], dates[test_start:test_end]
        folds.append((np.flatnonzero(normalized.isin(train_dates)), np.flatnonzero(normalized.isin(test_dates))))
    if len(folds) != n_splits:
        raise ValueError("not enough sessions for every purged fold")
    return folds


def build_point_in_time_dataset(features: pd.DataFrame, histories: dict[str, pd.DataFrame],
                                memberships: pd.DataFrame, *, max_hold: int = PURGE_SESSIONS) -> pd.DataFrame:
    """Label only setups whose issuer was a recorded member on that date.

    ``memberships`` is a required historical constituent ledger with code,
    startDate and endDate. Passing the current listing as that ledger is allowed
    only for experimentation and must be marked survivorship-limited by the
    caller; it can never pass ``release_gate``.
    """
    required = {"code", "startDate", "endDate"}
    if missing := required - set(memberships.columns):
        raise ValueError(f"membership ledger missing: {', '.join(sorted(missing))}")
    feature_required = {"code", "date", "t", "atr"}
    if missing := feature_required - set(features.columns):
        raise ValueError(f"feature rows missing: {', '.join(sorted(missing))}")
    active = memberships.copy()
    active["code"] = active["code"].astype(str)
    active["startDate"] = pd.to_datetime(active["startDate"], errors="raise")
    active["endDate"] = pd.to_datetime(active["endDate"], errors="raise")
    rows = []
    for _, feature in features.iterrows():
        code, decision_at = str(feature["code"]), pd.Timestamp(feature["date"])
        listed = active[(active["code"] == code) & (active["startDate"] <= decision_at) & (active["endDate"] >= decision_at)]
        if listed.empty:
            continue
        history = histories.get(code)
        if history is None or history.empty:
            continue
        try:
            outcome = label_entry_outcome(history, int(feature["t"]), float(feature["atr"]), max_hold=max_hold)
        except (IndexError, KeyError, TypeError, ValueError):
            continue
        rows.append({**feature.to_dict(), "code": code, "date": decision_at, "outcome": outcome["outcome"],
                     "return_pct": (outcome["exit"] - outcome["entry"]) / outcome["entry"] * 100})
    return pd.DataFrame(rows)


def _design_matrix(frame: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    missing = set(feature_columns) - set(frame.columns)
    if missing:
        raise ValueError(f"dataset missing features: {', '.join(sorted(missing))}")
    raw = frame[feature_columns].copy()
    for column in raw.columns:
        if not pd.api.types.is_numeric_dtype(raw[column]):
            raw[column] = raw[column].fillna("unknown").astype(str)
    return pd.get_dummies(raw, dummy_na=True).astype(float).fillna(0.0)


def _probability_table(labels: pd.Series) -> np.ndarray:
    counts = labels.value_counts()
    total = len(labels)
    return np.array([float(counts.get(label, 0)) / total for label in OUTCOMES])


def _align_probabilities(probabilities: np.ndarray, classes: np.ndarray) -> np.ndarray:
    aligned = np.zeros((len(probabilities), len(OUTCOMES)))
    for index, label in enumerate(classes):
        if label in OUTCOMES:
            aligned[:, OUTCOMES.index(label)] = probabilities[:, index]
    return aligned


def _brier(y: np.ndarray, probabilities: np.ndarray) -> np.ndarray:
    one_hot = np.zeros_like(probabilities)
    one_hot[np.arange(len(y)), [OUTCOMES.index(label) for label in y]] = 1.0
    return np.mean((probabilities - one_hot) ** 2, axis=1)


def _log_loss(y: np.ndarray, probabilities: np.ndarray) -> np.ndarray:
    indices = [OUTCOMES.index(label) for label in y]
    return -np.log(np.clip(probabilities[np.arange(len(y)), indices], 1e-12, 1.0))


def _ece(y: np.ndarray, probabilities: np.ndarray, bins: int = 10) -> float:
    target_probability = probabilities[:, OUTCOMES.index("target")]
    actual = (y == "target").astype(float)
    error = 0.0
    for lower in np.linspace(0, 1, bins, endpoint=False):
        mask = (target_probability >= lower) & (target_probability < lower + 1 / bins)
        if mask.any():
            error += mask.mean() * abs(actual[mask].mean() - target_probability[mask].mean())
    return float(error)


def _bootstrap_lower(skill_by_observation: np.ndarray, *, samples: int = 1000) -> float:
    if not len(skill_by_observation):
        return 0.0
    rng = np.random.default_rng(0)
    means = [float(rng.choice(skill_by_observation, len(skill_by_observation), replace=True).mean()) for _ in range(samples)]
    return float(np.quantile(means, 0.05))


def evaluate_forecast_dataset(frame: pd.DataFrame, feature_columns: list[str], *,
                              survivorship_limited: bool, n_splits: int = 3,
                              purge_sessions: int = PURGE_SESSIONS) -> dict:
    """Evaluate a point-in-time dataset versus its training-period base rate.

    The baseline is calibrated: every class probability is the class frequency
    in that fold's training data, never a rate from the future test window.
    The candidate model is fit afresh for every fold. This is offline research,
    not a live forecast generator.
    """
    if frame.empty:
        raise ValueError("cannot evaluate an empty dataset")
    if not set(frame["outcome"].astype(str)).issubset(OUTCOMES):
        raise ValueError("outcomes must be target, stop, or neither")
    from sklearn.linear_model import LogisticRegression

    ordered = frame.copy()
    ordered["date"] = pd.to_datetime(ordered["date"], errors="raise")
    ordered = ordered.sort_values(["date", "code" if "code" in ordered else "date"]).reset_index(drop=True)
    matrix = _design_matrix(ordered, feature_columns)
    labels = ordered["outcome"].astype(str).to_numpy()
    brier_skill, log_skill, all_brier_difference, eces, expectancy = [], [], [], [], []
    for train, test in purged_time_splits(ordered, n_splits=n_splits, purge_sessions=purge_sessions):
        train_labels, test_labels = labels[train], labels[test]
        baseline = _probability_table(pd.Series(train_labels))
        baseline_probabilities = np.tile(baseline, (len(test), 1))
        if len(set(train_labels)) < 2:
            model_probabilities = baseline_probabilities.copy()
        else:
            model = LogisticRegression(max_iter=1_000, random_state=0)
            model.fit(matrix.iloc[train], train_labels)
            model_probabilities = _align_probabilities(model.predict_proba(matrix.iloc[test]), model.classes_)
        model_brier, base_brier = _brier(test_labels, model_probabilities), _brier(test_labels, baseline_probabilities)
        model_log, base_log = _log_loss(test_labels, model_probabilities), _log_loss(test_labels, baseline_probabilities)
        brier_skill.append(float(1 - model_brier.mean() / base_brier.mean()) if base_brier.mean() else 0.0)
        log_skill.append(float(1 - model_log.mean() / base_log.mean()) if base_log.mean() else 0.0)
        all_brier_difference.extend(base_brier - model_brier)
        eces.append(_ece(test_labels, model_probabilities))
        if "return_pct" in ordered:
            expectancy.extend(ordered.iloc[test]["return_pct"].astype(float).tolist())
        else:
            expectancy.extend([3.0 if label == "target" else -1.5 if label == "stop" else 0.0 for label in test_labels])
    return {
        "model_version": "offline-logistic-v1", "evaluation": "purged-rolling", "purge_sessions": purge_sessions,
        "sample_size": int(len(ordered)), "folds": len(brier_skill),
        "brier_skill": round(float(np.mean(brier_skill)), 6), "log_loss_skill": round(float(np.mean(log_skill)), 6),
        "ece": round(float(np.mean(eces)), 6), "expectancy": round(float(np.mean(expectancy)), 6),
        "stable": bool(all(value > 0 for value in brier_skill) and all(value > 0 for value in log_skill)),
        "bootstrap_lower": round(_bootstrap_lower(np.asarray(all_brier_difference)), 6),
        "survivorship_limited": bool(survivorship_limited),
    }


def write_forecast_metrics(path: Path, metrics: dict) -> None:
    """Atomically replace the generated metrics artifact, never a live decision."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(metrics, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate an offline point-in-time forecast dataset.")
    parser.add_argument("dataset", type=Path, help="CSV with date, code, outcome and selected feature columns")
    parser.add_argument("--features", required=True, help="Comma-separated point-in-time feature columns")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("forecast_metrics.json"))
    parser.add_argument("--point-in-time-constituents", action="store_true", help="Required to remove the survivorship block")
    args = parser.parse_args()
    dataset = pd.read_csv(args.dataset, parse_dates=["date"])
    metrics = evaluate_forecast_dataset(dataset, [item.strip() for item in args.features.split(",") if item.strip()],
                                        survivorship_limited=not args.point_in_time_constituents)
    write_forecast_metrics(args.output, metrics)
    print(json.dumps({"output": str(args.output), "release": release_gate(metrics, metrics["survivorship_limited"])[0]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
