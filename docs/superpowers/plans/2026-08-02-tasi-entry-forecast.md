# TASI Entry Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Research, validate, and shadow a calibrated 60-session probability that a new entry reaches its ATR target before its stop across the liquidity-eligible TASI universe.

**Architecture:** Reuse adjusted history, scanner features, and production ATR arithmetic. Build point-in-time three-class outcome rows; compare a constant empirical baseline to a regularized multinomial logistic model with time-purged splits; publish no probability unless every validation gate passes. Store shadow predictions independently from BUY and budget logic.

**Tech Stack:** Python 3.12, pandas, numpy, scikit-learn 1.7, pytest, Cloud Firestore after the managed-runtime plan.

## Global Constraints

- Complete reliability core and managed runtime first.
- Entry is the next session open; ATR stop and target levels are fixed from the decision close; horizon is exactly 60 trading sessions.
- Classes are target, stop, and neither; same-bar collision is stop.
- Use only decision-close features; never news, future rows, or post-close data.
- Purge 60 sessions between training and evaluation.
- Current-listing-only datasets are research/shadow-only because of survivorship bias.
- Forecasts never change BUY action, sizing, or budget in this plan.

---

## File structure

- Create: research/entry_outcomes.py — labels, point-in-time rows, data audit.
- Create: research/entry_forecast.py — baseline, model fitting, validation, gates.
- Create: research/test_entry_forecast.py — offline synthetic-data tests.
- Modify: backtest.py, main.py, notify.py, runtime_store.py, firestore_store.py, requirements.txt, test_core.py, README.md.

### Task 1: Construct three-class entry outcomes

**Files:**
- Create: research/entry_outcomes.py, research/test_entry_forecast.py
- Modify: backtest.py

**Interfaces:**
- label_entry_outcome(df, t, atr, levels_cfg, max_hold=60) -> dict | None
- Return shape: {"outcome": "target|stop|neither", "entry": float, "return_pct": float, "bars_held": int}

- [ ] **Step 1: Write failing label tests**

~~~
def test_label_entry_outcome_uses_next_open_and_60_bar_timeout():
    out = label_entry_outcome(frame_with_no_levels(), 0, 1.0, LEVELS, max_hold=60)
    assert out["outcome"] == "neither"
    assert out["entry"] == 10.0

def test_label_entry_outcome_marks_same_bar_collision_as_stop():
    assert label_entry_outcome(frame_with_collision(), 0, 1.0, LEVELS)["outcome"] == "stop"
~~~

- [ ] **Step 2: Run the test**

Run: python -m pytest research/test_entry_forecast.py -v

Expected: FAIL because entry_outcomes.py does not exist.

- [ ] **Step 3: Reuse production level and outcome arithmetic**

Call analyze.levels_from_atr(decision_close, atr, cfg.RISK["stop_loss_pct"], levels_cfg), then backtest.resolve_outcome(..., max_hold=60). This matches the current production/backtest convention: levels are known at the decision close and fill occurs at the next open. Map timeout to neither, retain stop-first collision behavior, compute return_pct from entry and exit, and subtract cfg.RISK["commission_rate"] * 100 once. Return None for no next open, non-finite ATR, or fewer than 60 future bars.

- [ ] **Step 4: Verify tails and missing data**

Run: python -m pytest research/test_entry_forecast.py -v

Expected: PASS for target, stop, neither, collision, tail exclusion, and invalid ATR.

- [ ] **Step 5: Commit**

~~~
git add research/entry_outcomes.py research/test_entry_forecast.py backtest.py
git commit -m "feat: label 60-session entry outcomes"
~~~

### Task 2: Build time-safe datasets and constant baseline

**Files:**
- Modify: research/entry_outcomes.py, research/test_entry_forecast.py
- Create: research/entry_forecast.py

**Interfaces:**
- build_entry_dataset(features, histories, index_df) -> pd.DataFrame
- constant_baseline(train_labels, n_rows) -> np.ndarray
- purged_time_splits(frame, n_splits=4, gap_sessions=60) -> list[tuple[np.ndarray, np.ndarray]]

- [ ] **Step 1: Write failing leakage and baseline tests**

~~~
def test_purged_splits_leave_60_sessions_between_train_and_test():
    frame = dated_rows(500)
    for train, test in purged_time_splits(frame):
        assert frame.iloc[train]["date"].max() < frame.iloc[test]["date"].min() - pd.Timedelta(days=60)

def test_constant_baseline_rows_sum_to_one():
    probs = constant_baseline(pd.Series(["target", "stop", "neither", "neither"]), 2)
    assert np.allclose(probs.sum(axis=1), 1.0)
~~~

- [ ] **Step 2: Run the test**

Run: python -m pytest research/test_entry_forecast.py -k "purged or baseline" -v

Expected: FAIL because the helpers are absent.

- [ ] **Step 3: Implement feature snapshots and purged date splits**

Build rows only for scanner liquidity-eligible symbols. Include lagged relative strength, 5/20/60/120-day momentum, moving-average distances/slopes, RSI, ATR/price, squeeze percentile, liquidity, and regime. Preserve date, code, and outcome. Use TimeSeriesSplit(n_splits=4, gap=60) over unique decision dates and expand each fold back to all rows of its dates. Assert all feature columns are observable at the decision close.

- [ ] **Step 4: Run audit and tests**

Run: python -m pytest research/test_entry_forecast.py -v

Run: python -m research.entry_forecast audit

Expected: PASS. Audit prints decision-date range, class counts, exclusions, and survivorship_limited=true when no delisted constituents exist.

- [ ] **Step 5: Commit**

~~~
git add research/entry_outcomes.py research/entry_forecast.py research/test_entry_forecast.py
git commit -m "feat: build purged entry forecast datasets"
~~~

### Task 3: Calibrate probabilities and enforce release gates

**Files:**
- Modify: research/entry_forecast.py, research/test_entry_forecast.py
- Modify: requirements.txt

**Interfaces:**
- fit_logistic(train, feature_columns) -> Pipeline
- evaluate_fold(model, frame, labels) -> dict
- release_gate(folds, survivorship_limited) -> tuple[bool, list[str]]

- [ ] **Step 1: Write failing gate tests**

~~~
def test_release_gate_rejects_model_that_does_not_beat_baseline():
    fold = {"brier_skill": -0.01, "log_loss_skill": 0.02, "ece": 0.01, "top_tier_expectancy": 0.4, "stable": True}
    ok, reasons = release_gate([fold], False)
    assert not ok and "brier score did not beat baseline" in reasons

def test_release_gate_rejects_survivorship_limited_dataset():
    ok, reasons = release_gate([passing_fold()], True)
    assert not ok and "survivorship-limited dataset" in reasons
~~~

- [ ] **Step 2: Run the test**

Run: python -m pytest research/test_entry_forecast.py -k release_gate -v

Expected: FAIL because release_gate is absent.

- [ ] **Step 3: Implement baseline, model, and metrics**

Add scikit-learn>=1.7,<1.8. Fit Pipeline([("scale", StandardScaler()), ("model", LogisticRegression(solver="lbfgs", max_iter=2000, random_state=7))]). Calibrate only against held-out validation dates with CalibratedClassifierCV; never fit calibration on final test dates. Evaluate multiclass brier_score_loss, log_loss, per-class reliability bins, after-cost expected return, and skill versus constant baseline.

- [ ] **Step 4: Implement exact abstention gates**

Reject if Brier or log-loss skill is non-positive; ECE exceeds 0.05; top publishable tier expectancy is non-positive; fewer than three yearly/volatility strata have positive skill; bootstrap 95% interval includes zero; or survivorship_limited is true.

Run: python -m pytest research/test_entry_forecast.py -v

Run: python -m research.entry_forecast evaluate

Expected: PASS; evaluation reports forecast unavailable and all reasons unless every gate passes.

- [ ] **Step 5: Commit**

~~~
git add research/entry_forecast.py research/test_entry_forecast.py requirements.txt
git commit -m "feat: gate calibrated entry forecasts"
~~~

### Task 4: Persist and render shadow forecasts without trading influence

**Files:**
- Modify: main.py, notify.py, runtime_store.py, firestore_store.py, test_core.py, README.md

**Interfaces:**
- RuntimeStore.record_forecast_shadow(record: dict) -> None writes one immutable forecast_shadow document.
- RuntimeStore.attach_forecast_outcome(shadow_id: str, outcome: dict) -> None records the matured 60-session outcome without altering the original probabilities.

- [ ] **Step 1: Write failing rendering and isolation tests**

~~~
def test_digest_renders_unavailable_forecast_without_changing_buy_or_budget():
    rec = watch_rec(action="WATCH")
    rec["forecast"] = {"available": False, "reasons": ["survivorship-limited dataset"]}
    assert "forecast unavailable" in nt.format_recommendation(rec)
    assert rec["action"] == "WATCH"
~~~

- [ ] **Step 2: Run the test**

Run: python -m pytest test_core.py -k unavailable_forecast -v

Expected: FAIL because forecast rendering is absent.

- [ ] **Step 3: Implement append-only shadow records**

After the daily scanner closes, store forecast_shadow documents with decision date, model version, feature hash, class probabilities, baseline, gate result, and eventual outcome placeholder. Render probability only after release_gate passes; otherwise render forecast unavailable: <reason>. Do not read forecast fields in analyze.buy_decision or analyze.allocate_budget.

- [ ] **Step 4: Verify no trade path consumes forecast values**

Run: rg -n "forecast" analyze.py main.py notify.py runtime_store.py firestore_store.py

Expected: references occur only in rendering, shadow persistence, and diagnostics; none in buy_decision or allocate_budget.

Run: python -m pytest test_core.py research/test_base_rate.py research/test_entry_forecast.py -v

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add main.py notify.py runtime_store.py firestore_store.py test_core.py README.md
git commit -m "feat: add abstaining entry forecast shadow mode"
~~~
