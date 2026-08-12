from __future__ import annotations

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
