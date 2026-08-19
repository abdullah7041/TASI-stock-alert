"""Durable claim, cooldown, delivery and health state for the managed runtime.

Two jobs can overlap: Cloud Scheduler retries a run that was slow rather than
dead, and a manual recovery run can land on top of a scheduled one. Both then
hold the same alert. The rule that keeps Discord from doubling is claim before
send: an alert is delivered only by the job that won a transactional claim on
its deterministic event ID, and the claim outlives the process.

The Firestore client is imported lazily inside FirestoreStateStore so the
GitHub fallback, the CI python job, and these tests never need google-cloud
libraries or credentials. InMemoryStateStore implements the same contract and
is what the tests exercise, because the behaviour worth testing is the claim
protocol, not Firestore's client library.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Protocol

# Firestore collections. Names are part of the deployed contract: renaming one
# orphans live state, so they are constants rather than inline strings.
EVENTS = "movement_events"
COOLDOWN = "movement_cooldown"
DELIVERIES = "delivery_attempts"
SNAPSHOTS = "daily_snapshots"
HEALTH = "health_transitions"


def event_id(code: str, direction: str, observed_at: str) -> str:
    """Deterministic ID for one company-direction-hour observation.

    Deliberately the same shape movement.detect_unusual_movement already uses
    for alertId, so a retry of the same observation computes the same ID and
    loses the claim race instead of producing a second alert.
    """
    return sha256(f"{code}|{direction}|{observed_at[:13]}".encode()).hexdigest()[:20]


class StateStore(Protocol):
    def claim_event(self, identifier: str, payload: dict) -> bool: ...
    def record_delivery(self, identifier: str, channel: str, ok: bool, detail: str = "") -> None: ...
    def delivery_succeeded(self, identifier: str, channel: str) -> bool: ...
    def release_event(self, identifier: str) -> None: ...
    def load_movement_state(self) -> dict: ...
    def save_movement_state(self, state: dict) -> None: ...
    def save_snapshot(self, trade_date: str, snapshot: dict) -> None: ...
    def latest_snapshot(self) -> dict | None: ...
    def record_health(self, mode: str, status: str, detail: dict) -> None: ...


@dataclass
class InMemoryStateStore:
    """Reference implementation and test double. Same semantics, no network."""

    events: dict[str, dict] = field(default_factory=dict)
    deliveries: dict[str, dict] = field(default_factory=dict)
    cooldowns: dict[str, dict] = field(default_factory=dict)
    snapshots: dict[str, dict] = field(default_factory=dict)
    health: list[dict] = field(default_factory=list)

    def claim_event(self, identifier: str, payload: dict) -> bool:
        if identifier in self.events:
            return False
        self.events[identifier] = dict(payload)
        return True

    def record_delivery(self, identifier: str, channel: str, ok: bool, detail: str = "") -> None:
        record = self.deliveries.setdefault(f"{identifier}:{channel}", {"attempts": 0, "ok": False, "detail": ""})
        record["attempts"] += 1
        record["ok"] = record["ok"] or ok
        record["detail"] = detail

    def delivery_succeeded(self, identifier: str, channel: str) -> bool:
        return bool(self.deliveries.get(f"{identifier}:{channel}", {}).get("ok"))

    def release_event(self, identifier: str) -> None:
        self.events.pop(identifier, None)

    def load_movement_state(self) -> dict:
        return dict(self.cooldowns)

    def save_movement_state(self, state: dict) -> None:
        self.cooldowns = dict(state)

    def save_snapshot(self, trade_date: str, snapshot: dict) -> None:
        self.snapshots[trade_date] = dict(snapshot)

    def latest_snapshot(self) -> dict | None:
        if not self.snapshots:
            return None
        return self.snapshots[max(self.snapshots)]

    def record_health(self, mode: str, status: str, detail: dict) -> None:
        self.health.append({"mode": mode, "status": status, **detail})


class FirestoreStateStore:
    """Firestore-backed StateStore. Constructed only inside the Cloud Run job."""

    def __init__(self, project: str | None = None, namespace: str = "tasi"):
        from google.cloud import firestore  # imported here so no other path needs it

        self._firestore = firestore
        self._client = firestore.Client(project=project or os.environ.get("GOOGLE_CLOUD_PROJECT"))
        self._root = self._client.collection("runtimes").document(namespace)

    def _doc(self, collection: str, identifier: str):
        return self._root.collection(collection).document(identifier)

    def claim_event(self, identifier: str, payload: dict) -> bool:
        """Create the event document, or report that another job already holds it."""
        transaction = self._client.transaction()
        reference = self._doc(EVENTS, identifier)

        @self._firestore.transactional
        def claim(txn) -> bool:
            if reference.get(transaction=txn).exists:
                return False
            txn.set(reference, {**payload, "claimedAt": self._firestore.SERVER_TIMESTAMP})
            return True

        return claim(transaction)

    def record_delivery(self, identifier: str, channel: str, ok: bool, detail: str = "") -> None:
        self._doc(DELIVERIES, f"{identifier}:{channel}").set({
            "eventId": identifier, "channel": channel, "ok": ok, "detail": detail,
            "attempts": self._firestore.Increment(1), "updatedAt": self._firestore.SERVER_TIMESTAMP,
        }, merge=True)

    def delivery_succeeded(self, identifier: str, channel: str) -> bool:
        snapshot = self._doc(DELIVERIES, f"{identifier}:{channel}").get()
        return bool(snapshot.exists and snapshot.to_dict().get("ok"))

    def release_event(self, identifier: str) -> None:
        """Undo a claim whose delivery never happened, so a retry can send it."""
        self._doc(EVENTS, identifier).delete()

    def load_movement_state(self) -> dict:
        """The whole re-arm map in one document: a container starts with no disk."""
        snapshot = self._doc(COOLDOWN, "movement").get()
        return snapshot.to_dict().get("state", {}) if snapshot.exists else {}

    def save_movement_state(self, state: dict) -> None:
        self._doc(COOLDOWN, "movement").set({"state": dict(state), "updatedAt": self._firestore.SERVER_TIMESTAMP})

    def save_snapshot(self, trade_date: str, snapshot: dict) -> None:
        self._doc(SNAPSHOTS, trade_date).set({"tradeDate": trade_date, "snapshot": snapshot})

    def latest_snapshot(self) -> dict | None:
        rows = list(self._root.collection(SNAPSHOTS).order_by("tradeDate", direction="DESCENDING").limit(1).stream())
        return rows[0].to_dict().get("snapshot") if rows else None

    def record_health(self, mode: str, status: str, detail: dict) -> None:
        self._root.collection(HEALTH).add({
            "mode": mode, "status": status, **detail,
            "recordedAt": self._firestore.SERVER_TIMESTAMP,
        })
