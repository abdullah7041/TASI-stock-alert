"""Offline-only, point-in-time validation for the abstaining entry forecast.

Nothing in this module is imported by the decision, sizing, alert, or Discord
paths. Its only durable product is a metrics document which ``main._forecast``
uses to decide whether it must continue to abstain.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import pandas as pd

from research.entry_outcomes import label_entry_outcome

OUTCOMES = ("target", "stop", "neither")
PURGE_SESSIONS = 60


def _finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def release_gate(metrics: dict, survivorship_limited: bool) -> tuple[bool, list[str]]:
    reasons = []
    numeric_keys = ("brier_skill", "log_loss_skill", "ece", "expectancy", "sample_size", "bootstrap_lower")
    if not all(_finite_number(metrics.get(key)) for key in numeric_keys):
        reasons.append("Validation metrics must be finite numbers.")
    else:
        if metrics["brier_skill"] <= 0: reasons.append("Brier score did not beat the base rate.")
        if metrics["log_loss_skill"] <= 0: reasons.append("Log loss did not beat the base rate.")
        if metrics["ece"] > 0.05: reasons.append("Calibration error exceeds 0.05.")
        if metrics["expectancy"] <= 0: reasons.append("After-cost expectancy is not positive.")
        if metrics["sample_size"] < 300: reasons.append("Sample size is inadequate.")
        if metrics["bootstrap_lower"] <= 0: reasons.append("Bootstrap uncertainty includes zero skill.")
    if not metrics.get("stable", False): reasons.append("Out-of-sample skill is not stable across periods and regimes.")
    purge = metrics.get("purge_sessions")
    if metrics.get("evaluation") != "purged-rolling" or not _finite_number(purge) or purge < PURGE_SESSIONS:
        reasons.append("A 60-session purged rolling evaluation is required.")
    calibrated_folds, folds = metrics.get("calibrated_folds"), metrics.get("folds")
    if (metrics.get("calibration_method") != "purged-sigmoid" or not _finite_number(calibrated_folds)
            or not _finite_number(folds) or folds < 3 or calibrated_folds < folds):
        reasons.append("Chronologically purged calibration is incomplete.")
    cost = metrics.get("transaction_cost_pct")
    selected = metrics.get("selected_count")
    if not _finite_number(cost) or cost <= 0 or not _finite_number(selected) or selected <= 0:
        reasons.append("Measured selected-trade returns and explicit transaction cost are required.")
    regimes = metrics.get("regime_skills")
    if (not isinstance(regimes, dict) or not regimes or any(
            not isinstance(values, list) or not values or any(not _finite_number(value) or value <= 0 for value in values)
            for values in regimes.values())):
        reasons.append("Positive skill across observed regimes is required.")
    if (survivorship_limited or metrics.get("survivorship_limited", True)
            or metrics.get("membership_provenance") != "official-historical-snapshots"):
        reasons.append("Dataset is survivorship-limited or lacks reviewed historical membership provenance.")
    return not reasons, reasons

def unavailable_forecast(as_of: str, metrics: dict, survivorship_limited: bool) -> dict:
    ok, reasons = release_gate(metrics, survivorship_limited)
    if not ok: return {"status": "unavailable", "asOf": as_of, "reason": " ".join(reasons)}
    # Offline validation is not a point-in-time forecast for the current setup.
    # No live forecast generator is released; passing research metrics alone
    # must never fabricate actionable probabilities or price levels.
    return {"status": "unavailable", "asOf": as_of, "reason": "No validated point-in-time forecast for the current setup."}


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

    ``memberships`` has code/startDate/endDate. Only rows backed by an official
    historical snapshot published by the decision date can remove the
    survivorship flag; a current listing remains experimentation-only.
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
    verified_rows = []
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
        if outcome is None:
            continue
        verified = False
        if {"sourceUrl", "sourcePublishedAt", "sourceKind"}.issubset(listed.columns):
            for _, membership in listed.iterrows():
                source = urlparse(str(membership["sourceUrl"]))
                try:
                    published = pd.Timestamp(membership["sourcePublishedAt"]).tz_localize(None)
                except (TypeError, ValueError):
                    continue
                if (source.scheme == "https" and source.hostname in {"saudiexchange.sa", "www.saudiexchange.sa"}
                        and membership["sourceKind"] == "historical-snapshot" and published <= decision_at):
                    verified = True
                    break
        verified_rows.append(verified)
        rows.append({**feature.to_dict(), "code": code, "date": decision_at, "outcome": outcome["outcome"],
                     "return_pct": (outcome["exit"] - outcome["entry"]) / outcome["entry"] * 100})
    dataset = pd.DataFrame(rows)
    dataset.attrs["historical_membership_verified"] = bool(verified_rows) and all(verified_rows)
    return dataset


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


def _bootstrap_lower(skill_by_observation: np.ndarray, session_ids: np.ndarray, *, samples: int = 1000) -> float:
    if not len(skill_by_observation):
        return 0.0
    # The same session can contribute several issuers. Resample sessions,
    # not correlated issuer rows, to avoid overconfident intervals.
    block_means = pd.DataFrame({"session": session_ids, "skill": skill_by_observation}).groupby("session")["skill"].mean().to_numpy()
    rng = np.random.default_rng(0)
    means = [float(rng.choice(block_means, len(block_means), replace=True).mean()) for _ in range(samples)]
    return float(np.quantile(means, 0.05))


def evaluate_forecast_dataset(frame: pd.DataFrame, feature_columns: list[str], *,
                              survivorship_limited: bool, n_splits: int = 3,
                              purge_sessions: int = PURGE_SESSIONS,
                              transaction_cost_pct: float | None = None) -> dict:
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
    if "return_pct" not in frame or not np.isfinite(pd.to_numeric(frame["return_pct"], errors="coerce").to_numpy()).all():
        raise ValueError("return_pct must contain measured finite exit returns for every observation")
    if not _finite_number(transaction_cost_pct) or transaction_cost_pct <= 0:
        raise ValueError("transaction_cost_pct must be an explicit positive finite cost assumption")
    from sklearn.linear_model import LogisticRegression
    from sklearn.calibration import CalibratedClassifierCV

    ordered = frame.copy()
    ordered["date"] = pd.to_datetime(ordered["date"], errors="raise")
    ordered = ordered.sort_values(["date", "code" if "code" in ordered else "date"]).reset_index(drop=True)
    matrix = _design_matrix(ordered, feature_columns)
    labels = ordered["outcome"].astype(str).to_numpy()
    brier_skill, log_skill, all_brier_difference, all_sessions, eces, expectancy = [], [], [], [], [], []
    regime_skills: dict[str, list[float]] = {}
    calibrated_folds = 0
    for train, test in purged_time_splits(ordered, n_splits=n_splits, purge_sessions=purge_sessions):
        train_labels, test_labels = labels[train], labels[test]
        baseline = _probability_table(pd.Series(train_labels))
        baseline_probabilities = np.tile(baseline, (len(test), 1))
        train_dates = pd.DatetimeIndex(ordered.iloc[train]["date"].drop_duplicates().sort_values())
        calibration_width = max(10, len(train_dates) // 5)
        fit_end = len(train_dates) - calibration_width - purge_sessions
        fit_rows = np.flatnonzero(ordered.iloc[train]["date"].isin(train_dates[:max(0, fit_end)]))
        calibration_rows = np.flatnonzero(ordered.iloc[train]["date"].isin(train_dates[-calibration_width:]))
        if len(fit_rows) < 10 or len(calibration_rows) < 10 or len(set(train_labels[fit_rows])) < 2:
            model_probabilities = baseline_probabilities.copy()
        else:
            model = CalibratedClassifierCV(
                LogisticRegression(max_iter=1_000, random_state=0),
                method="sigmoid", cv=[(fit_rows, calibration_rows)], ensemble=True,
            )
            model.fit(matrix.iloc[train], train_labels)
            model_probabilities = _align_probabilities(model.predict_proba(matrix.iloc[test]), model.classes_)
            calibrated_folds += 1
        model_brier, base_brier = _brier(test_labels, model_probabilities), _brier(test_labels, baseline_probabilities)
        model_log, base_log = _log_loss(test_labels, model_probabilities), _log_loss(test_labels, baseline_probabilities)
        brier_skill.append(float(1 - model_brier.mean() / base_brier.mean()) if base_brier.mean() else 0.0)
        log_skill.append(float(1 - model_log.mean() / base_log.mean()) if base_log.mean() else 0.0)
        all_brier_difference.extend(base_brier - model_brier)
        all_sessions.extend(ordered.iloc[test]["date"].astype(str).tolist())
        eces.append(_ece(test_labels, model_probabilities))
        selected = model_probabilities[:, OUTCOMES.index("target")] > baseline[OUTCOMES.index("target")]
        expectancy.extend((ordered.iloc[test]["return_pct"].to_numpy(dtype=float)[selected] - transaction_cost_pct).tolist())
        if "regime" in ordered:
            for regime in ordered.iloc[test]["regime"].dropna().astype(str).unique():
                mask = ordered.iloc[test]["regime"].astype(str).to_numpy() == regime
                if mask.sum() >= 10 and base_brier[mask].mean() > 0:
                    regime_skills.setdefault(regime, []).append(float(1 - model_brier[mask].mean() / base_brier[mask].mean()))
                else:
                    regime_skills.setdefault(regime, []).append(0.0)
    regime_stable = bool(regime_skills) and all(all(skill > 0 for skill in skills) for skills in regime_skills.values())
    return {
        "model_version": "offline-logistic-v2", "evaluation": "purged-rolling", "purge_sessions": purge_sessions,
        "calibration_method": "purged-sigmoid", "calibrated_folds": calibrated_folds,
        "transaction_cost_pct": transaction_cost_pct, "selected_count": len(expectancy),
        "sample_size": int(len(ordered)), "folds": len(brier_skill),
        "brier_skill": round(float(np.mean(brier_skill)), 6), "log_loss_skill": round(float(np.mean(log_skill)), 6),
        "ece": round(float(np.mean(eces)), 6), "expectancy": round(float(np.mean(expectancy)), 6) if expectancy else 0.0,
        "stable": bool(calibrated_folds == n_splits and regime_stable and all(value > 0 for value in brier_skill) and all(value > 0 for value in log_skill)),
        "regime_skills": {key: [round(value, 6) for value in values] for key, values in regime_skills.items()},
        "bootstrap_lower": round(_bootstrap_lower(np.asarray(all_brier_difference), np.asarray(all_sessions)), 6),
        "survivorship_limited": bool(survivorship_limited or not frame.attrs.get("historical_membership_verified", False)),
        "membership_provenance": "official-historical-snapshots" if frame.attrs.get("historical_membership_verified", False) else "unverified",
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
    parser.add_argument("--transaction-cost-pct", required=True, type=float, help="Explicit round-trip cost in percentage points")
    args = parser.parse_args()
    dataset = pd.read_csv(args.dataset, parse_dates=["date"])
    # A CSV cannot establish historical index membership provenance. This CLI
    # is research-only and always retains the survivorship release block.
    metrics = evaluate_forecast_dataset(dataset, [item.strip() for item in args.features.split(",") if item.strip()],
                                        survivorship_limited=True, transaction_cost_pct=args.transaction_cost_pct)
    write_forecast_metrics(args.output, metrics)
    print(json.dumps({"output": str(args.output), "release": release_gate(metrics, metrics["survivorship_limited"])[0]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
