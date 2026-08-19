"""Adaptive delayed-price movement alerts; never an exchange-real-time feed."""
from __future__ import annotations

from hashlib import sha256

MIN_EXCESS_MOVE_PCT = 1.5
MIN_ROBUST_Z = 4.0
MIN_COMPARABLE_OBSERVATIONS = 20
REARM_Z = 2.0
VOLUME_CONFIRMATION_RATIO = 2.0

class UnnamedAlertError(ValueError):
    """A newly produced alert has no company name, so it can never be rendered."""


def detect_unusual_movement(observation: dict, state: dict, official_evidence: list | None = None) -> dict:
    direction = "upside" if observation.get("excess_move_pct", 0) > 0 else "downside"
    key = f"{observation.get('code')}:{direction}"
    next_state = {**state}
    prior = dict(next_state.get(key, {"armed": True}))
    robust_z = float(observation.get("robust_z", 0))
    if not observation.get("fresh"):
        return {"alert": None, "suppressed_reason": "stale data", "state": next_state}
    if observation.get("comparable_observations", 0) < MIN_COMPARABLE_OBSERVATIONS:
        return {"alert": None, "suppressed_reason": "insufficient baseline", "state": next_state}
    if abs(float(observation.get("excess_move_pct", 0))) < MIN_EXCESS_MOVE_PCT or abs(robust_z) < MIN_ROBUST_Z:
        if abs(robust_z) < REARM_Z:
            prior["armed"] = True
            next_state[key] = prior
        return {"alert": None, "suppressed_reason": "price gate not met", "state": next_state}
    if not prior.get("armed", True):
        return {"alert": None, "suppressed_reason": "cooldown active", "state": next_state}
    observed_at = observation["observed_at"]
    alert_id = sha256(f"{observation['code']}|{direction}|{observed_at[:13]}".encode()).hexdigest()[:20]
    volume_ratio = float(observation.get("volume_ratio", 0))
    evidence_note = " Volume confirms participation." if volume_ratio >= VOLUME_CONFIRMATION_RATIO else ""
    if official_evidence: evidence_note += " Recent official evidence is linked."
    name = str(observation.get("name") or "").strip()
    if not name:
        # A code alone is unreadable in Discord and on the cockpit. Refusing here
        # keeps the unnamed alert out of the stored history entirely.
        raise UnnamedAlertError(f"movement alert for {observation['code']} has no company name")
    prior["armed"] = False
    next_state[key] = prior
    return {"alert": {"alertId": alert_id, "code": observation["code"], "name": name, "direction": direction, "observedAt": observed_at, "receivedAt": observation["received_at"], "latency": "delayed-intraday", "excessMovePct": float(observation["excess_move_pct"]), "robustZ": robust_z, "volumeRatio": volume_ratio, "reason": "Delayed bot confirmation of statistically unusual price movement." + evidence_note}, "suppressed_reason": None, "state": next_state}
