from __future__ import annotations

import math

def release_gate(metrics: dict, survivorship_limited: bool) -> tuple[bool, list[str]]:
    reasons = []
    numeric_keys = (
        "brier_skill", "log_loss_skill", "ece", "expectancy",
        "sample_size", "bootstrap_lower",
    )
    finite = all(
        isinstance(metrics.get(key), (int, float))
        and not isinstance(metrics.get(key), bool)
        and math.isfinite(float(metrics[key]))
        for key in numeric_keys
    )
    if not finite:
        reasons.append("Validation metrics must be finite numbers.")
    else:
        if metrics["brier_skill"] <= 0: reasons.append("Brier score did not beat the base rate.")
        if metrics["log_loss_skill"] <= 0: reasons.append("Log loss did not beat the base rate.")
        if metrics["ece"] > 0.05: reasons.append("Calibration error exceeds 0.05.")
        if metrics["expectancy"] <= 0: reasons.append("After-cost expectancy is not positive.")
        if metrics["sample_size"] < 300: reasons.append("Sample size is inadequate.")
        if metrics["bootstrap_lower"] <= 0: reasons.append("Bootstrap uncertainty includes zero skill.")
    if not metrics.get("stable", False): reasons.append("Out-of-sample skill is not stable across periods and regimes.")
    if survivorship_limited: reasons.append("Dataset is survivorship-limited.")
    return not reasons, reasons

def unavailable_forecast(as_of: str, metrics: dict, survivorship_limited: bool) -> dict:
    ok, reasons = release_gate(metrics, survivorship_limited)
    if not ok: return {"status": "unavailable", "asOf": as_of, "reason": " ".join(reasons)}
    return {"status": "available", "asOf": as_of, "target": metrics["target"], "stop": metrics["stop"], "horizonSessions": 60, "targetFirstPct": metrics["target_first_pct"], "confidence": metrics["confidence"], "modelVersion": metrics["model_version"]}
