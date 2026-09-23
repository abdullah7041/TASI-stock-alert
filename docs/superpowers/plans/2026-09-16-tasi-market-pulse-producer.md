# TASI Market Pulse Producer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. The owner prohibited subagents.

**Goal:** Replace the falsely intraday-labelled daily refresh with a canonical five-minute delayed market-pulse artifact.

**Architecture:** Add one batched intraday data function and one pure artifact builder. The existing fifteen-minute `run` schedule writes `market_pulse.json` every run; downstream cockpit ingestion is a separate checkpoint so it cannot display the pulse before its trust boundary exists.

**Tech Stack:** Python 3.13, pandas, yfinance, pytest, existing canonical artifact hashing.

**Spec:** `docs/superpowers/specs/2026-09-16-tasi-decision-copilot-rescue-design.md`

## Global Constraints

- A transport failure, valid empty result, partial result, and complete result remain distinct.
- Every displayed quote carries the source observation timestamp and delayed-intraday label.
- Naive Yahoo timestamps are interpreted as Asia/Riyadh, then serialized in UTC.
- Change percentage compares the newest trade with the preceding completed session close; it is unavailable when no prior session exists.
- Add no dependency and do not change Discord delivery behavior.

---

### Task 1: Batched five-minute retrieval

**Files:**
- Modify: `data.py`
- Test: `test_core.py`

**Interfaces:**
- Produces: `get_intraday_histories(codes, period="5d", interval="5m") -> IntradayBatch`.
- `IntradayBatch.status` is `available|partial|empty|failed`; `frames` contains every requested code; `errors` contains safe provider reasons.

- [x] Write a failing test that injects a multi-index Yahoo frame and asserts distinct per-code frames.
- [x] Write a failing test that distinguishes an empty response from a raised provider failure.
- [x] Run: `python -m pytest test_core.py -k intraday -q`
- [x] Implement one batched `yf.download` call with per-symbol fallback and no daily-index normalization.
- [x] Run: `python -m pytest test_core.py -k intraday -q`

### Task 2: Canonical pulse artifact

**Files:**
- Modify: `artifacts.py`
- Create: `market_pulse.py`
- Modify: `main.py`
- Modify: `.github/workflows/tasi.yml`
- Test: `test_core.py`

**Interfaces:**
- Produces: `market_pulse.collect(items, now=None, fetch=None)` returning schema version 1, `artifactKind: market-pulse`, a SHA-256 identity, source timestamps, current price, preceding-session change, session volume, and collection status.
- `mode_run()` always writes `market_pulse.json` before movement-alert work.

- [x] Write a failing test for preceding-session change, timestamp conversion, and canonical identity.
- [x] Write a failing test proving failed collection serializes no quotes and carries a safe reason.
- [x] Run: `python -m pytest test_core.py -k market_pulse -q`
- [x] Implement the minimal collector and artifact builder.
- [x] Wire `mode_run()` and the workflow state commit list to `market_pulse.json`.
- [x] Run focused tests, compile, the exact CI pytest set, and `git diff --check`.
- [x] Commit the producer checkpoint without pushing or deploying.
