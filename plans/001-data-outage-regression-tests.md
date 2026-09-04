# Plan 001: Pin down what the price-data layer does when Yahoo is unavailable

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7bb9fdb..HEAD -- data.py test_core.py`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `7bb9fdb` (origin/main), 2026-08-30 — re-based from 143b740; excerpts re-verified byte-identical at 7bb9fdb

## Why this matters

`data.py` is the single source of price history for this whole system. When
Yahoo/`yfinance` fails, `get_histories` swallows the exception and returns an
empty DataFrame — which is indistinguishable from "this ticker legitimately has
no data". Plan 002 will make that failure visible, and it will change control
flow in the most load-bearing function in the repo.

This plan writes the safety net **first**: tests that pin the parts of the
current behaviour that must keep holding after 002 (no exception escapes to the
caller, the in-run cache is not poisoned, the per-code retry is actually
attempted). These tests pass today and must still pass after 002. Nothing here
changes production behaviour.

## Current state

Files involved:

- `data.py` — the price-data layer. `get_histories` (lines 148–179) is the
  batched fetch every mode depends on.
- `test_core.py` — the single Python test file (~3075 lines). The data-layer
  tests live under the banner comment `# --- data.get_histories_adjusted ---`
  at line 2264.

`data.py:148-179` as it exists today:

```python
def get_histories(codes: list, period: str = "1y") -> dict:
    """Daily OHLCV history for many codes in ONE Yahoo request (threaded batch
    download) instead of a serial per-ticker loop. Results are cached for the
    rest of the run, so later get_history() calls are free.

    Returns {code: DataFrame}; a code with no data maps to an empty frame.
    """
    todo = [c for c in codes if (c, period) not in _HISTORY_CACHE]
    if todo:
        import yfinance as yf
        symbols = {yahoo_symbol(c): c for c in todo}
        try:
            batch = yf.download(list(symbols), period=period, auto_adjust=False,
                                group_by="ticker", threads=True, progress=False)
        except Exception:
            batch = None
        for sym, code in symbols.items():
            df = pd.DataFrame()
            if batch is not None and not batch.empty:
                try:
                    part = batch[sym] if isinstance(batch.columns, pd.MultiIndex) else batch
                    df = _clean_ohlcv(part)
                except Exception:
                    df = pd.DataFrame()
            if df.empty:
                # Per-code retry covers symbols the batch call dropped.
                try:
                    df = _yahoo_history(sym, period)
                except Exception:
                    df = pd.DataFrame()
            _HISTORY_CACHE[(code, period)] = df
    return {c: _HISTORY_CACHE[(c, period)] for c in codes}
```

The per-code retry path (`data.py:67-74`) uses a **different** yfinance API
than the batch call — `yf.Ticker(...).history(...)`, not `yf.download(...)`:

```python
def _yahoo_history(symbol: str, period: str) -> pd.DataFrame:
    import yfinance as yf  # imported lazily so tests can run without it.
    df = yf.Ticker(symbol).history(period=period, auto_adjust=False)
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.rename(columns=str.title)  # normalize column casing.
    keep = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
    return _naive_index(df[keep].dropna())
```

**This is the single most important fact in this plan: to simulate a total
outage you must patch BOTH `yf.download` AND `yf.Ticker`.** Patching only
`yf.download` leaves the retry path live, and the test will try to reach the
real network.

### Repo conventions you must match

Data-layer tests use `monkeypatch.setattr(yf, "download", fake_download)`.
Model your tests on the existing block at `test_core.py:2265-2299`:

```python
def test_get_histories_adjusted_passes_auto_adjust_true(monkeypatch):
    import yfinance as yf
    captured = {}

    def fake_download(symbols, **kwargs):
        captured["auto_adjust"] = kwargs.get("auto_adjust")
        n = 3
        idx = pd.date_range("2024-01-01", periods=n)
        return pd.DataFrame({"Open": [1.0] * n, "High": [1.0] * n, "Low": [1.0] * n,
                             "Close": [1.0] * n, "Volume": [1] * n}, index=idx)

    monkeypatch.setattr(yf, "download", fake_download)
    data.get_histories_adjusted(["9922"], "1y_test_auto_adjust")
    assert captured["auto_adjust"] is True
```

**Critical gotcha, inlined because you will otherwise hit it:**
`_HISTORY_CACHE` in `data.py` is a module-level dict keyed by `(code, period)`
and it is **never reset between tests**. Every existing data-layer test works
around this by passing a unique `period` string (`"1y_test_auto_adjust"`,
`"1y_test_cache_separation"`, `"1y_test_retry_fallback"`). Your new tests MUST
each use their own unique period string, e.g. `"1y_test_total_outage"`. If two
tests share a period string for the same code, the second silently reads the
first's cached result and asserts nothing.

Test naming in this repo is a full sentence describing the guarantee, and most
tests carry a docstring explaining *why the test exists* (what broke, or what
would break silently). Match that — see any test in `test_core.py` around line
2300 for tone.

## Commands you will need

| Purpose        | Command                                                    | Expected on success |
|----------------|------------------------------------------------------------|---------------------|
| Run new tests  | `python -m pytest test_core.py -q -k "totally_down or partial_failure or poison"` | 3 passed |
| Full Python CI | `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` | all pass, 0 failures |
| Compile check  | `python -m compileall -q main.py movement.py session_gate.py runtime research` | exit 0, no output |

## Scope

**In scope** (the only files you should modify):
- `test_core.py` — add new tests only, at the end of the data-layer section
  that begins at line 2264.

**Out of scope** (do NOT touch):
- `data.py` — this plan adds tests only. Changing production behaviour is
  plan 002's job. If a test you write fails, that is a finding to report, not
  a reason to edit `data.py`.
- `main.py` — likewise plan 002.
- Any existing test. Do not modify or delete tests that already pass.

## Git workflow

- Branch: `advisor/001-data-outage-regression-tests`
- Commit message style — match the repo's existing log (imperative,
  lowercase-after-prefix where a prefix is used). Recent real examples:
  `fix: distinguish current and historical alerts (#9)`,
  `refactor: delete the unused cockpit snapshot package`.
  Suggested: `test: pin data-layer behaviour under a Yahoo outage`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a total-outage test

Append to `test_core.py`, after the existing data-layer tests (i.e. after line
2299, before the next section banner). Both yfinance entry points must raise:

```python
# --- data.get_histories under source failure ---------------------------------
def test_get_histories_returns_empty_frames_when_the_source_is_totally_down(monkeypatch):
    """A dead price source must not raise out of the data layer.

    Every mode calls get_histories at the top of its run. If an outage escaped
    as an exception the whole job would crash before writing state; the layer
    absorbs it and returns empty frames instead. Plan 002 makes that outage
    VISIBLE, but it must stay non-raising.
    """
    import yfinance as yf

    def dead_download(*_args, **_kwargs):
        raise RuntimeError("yahoo is down")

    def dead_ticker(*_args, **_kwargs):
        raise RuntimeError("yahoo is down")

    monkeypatch.setattr(yf, "download", dead_download)
    # The per-code retry uses yf.Ticker(...).history(...), a DIFFERENT entry
    # point from the batch call. Both must be dead to simulate a real outage.
    monkeypatch.setattr(yf, "Ticker", dead_ticker)

    out = data.get_histories(["1303", "2222"], "1y_test_total_outage")

    assert set(out) == {"1303", "2222"}
    assert all(frame.empty for frame in out.values())
```

**Verify**: `python -m pytest test_core.py -q -k totally_down` → 1 passed.
(Filter on the TEST FUNCTION name, not on the `period` string. `total_outage`
matches nothing — the function is named `..._totally_down`.)

### Step 2: Add a partial-outage test

A partial outage is the more common real case: the batch returns some symbols
and drops others.

```python
def test_get_histories_reports_each_code_independently_under_partial_failure(monkeypatch):
    """One dead ticker must not blank the others, and vice versa."""
    import yfinance as yf

    n = 6
    idx = pd.date_range("2024-01-01", periods=n)
    good = pd.DataFrame({"Open": [10.0] * n, "High": [11.0] * n, "Low": [9.0] * n,
                         "Close": [10.5] * n, "Volume": [1000] * n}, index=idx)

    def partial_download(symbols, **_kwargs):
        # Batch returns a frame for one symbol only; the other falls through
        # to the per-code retry, which is dead.
        return pd.concat({"1303.SR": good}, axis=1)

    def dead_ticker(*_args, **_kwargs):
        raise RuntimeError("yahoo is down for this symbol")

    monkeypatch.setattr(yf, "download", partial_download)
    monkeypatch.setattr(yf, "Ticker", dead_ticker)

    out = data.get_histories(["1303", "2222"], "1y_test_partial_outage")

    assert not out["1303"].empty, "a symbol the batch returned must survive"
    assert out["2222"].empty, "a symbol nothing returned must be an empty frame"
```

If `yahoo_symbol("1303")` does not produce `"1303.SR"`, read `data.py:33-40`
and use whatever it actually returns as the concat key. Confirm before
assuming — this is the one place the test depends on symbol formatting.

**Verify**: `python -m pytest test_core.py -q -k partial_failure` → 1 passed.

### Step 3: Add a cache-integrity test

The failure mode that would make plan 002 dangerous: an outage writing empty
frames into `_HISTORY_CACHE` that then shadow a later successful fetch within
the same run.

```python
def test_an_outage_does_not_poison_the_cache_for_a_different_period(monkeypatch):
    """Empty frames are cached per (code, period), as real results are.

    Worth pinning because plan 002 adds outage detection around this cache: if
    a failed fetch leaked into another period's key, the warning it raises
    would be wrong AND the data would be wrong.
    """
    import yfinance as yf

    def dead_download(*_args, **_kwargs):
        raise RuntimeError("yahoo is down")

    def dead_ticker(*_args, **_kwargs):
        raise RuntimeError("yahoo is down")

    monkeypatch.setattr(yf, "download", dead_download)
    monkeypatch.setattr(yf, "Ticker", dead_ticker)
    failed = data.get_histories(["1303"], "1y_test_cache_poison_a")
    assert failed["1303"].empty

    n = 4
    idx = pd.date_range("2024-01-01", periods=n)

    def live_download(symbols, **_kwargs):
        return pd.DataFrame({"Open": [1.0] * n, "High": [1.0] * n, "Low": [1.0] * n,
                             "Close": [1.0] * n, "Volume": [1] * n}, index=idx)

    monkeypatch.setattr(yf, "download", live_download)
    recovered = data.get_histories(["1303"], "1y_test_cache_poison_b")
    assert not recovered["1303"].empty, "a different period must fetch afresh"
```

**Verify**: `python -m pytest test_core.py -q -k poison` → 1 passed.

### Step 4: Run the full suite

Confirm nothing regressed and no test leaked cache state into another.

**Verify**: `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q`
→ all pass, 0 failures. Note the total test count; plan 002 will add to it.

## Test plan

Three new tests in `test_core.py`, all in the data-layer section:

1. Total outage — both yfinance entry points raise; all frames empty; nothing raised.
2. Partial outage — one symbol returns, one does not; they are independent.
3. Cache integrity — an outage does not shadow a later successful fetch under a different period key.

Structural pattern to follow: `test_core.py:2265-2299`.

## Done criteria

ALL must hold:

- [ ] `python -m pytest test_core.py -q -k "totally_down or partial_failure or poison"` → **3 passed**
      (Do NOT use `-k outage` as the gate: only one of these three tests has
      "outage" in its name, and it also matches the unrelated pre-existing
      `test_digest_reports_a_discord_outage_after_writing_state`. That filter
      reports "2 passed" while silently checking the wrong things.)
- [ ] `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q`
      → exactly ONE failure, `test_the_gate_reads_the_recorded_holiday_list`,
      which is PRE-EXISTING and unrelated (see note below). Your three new
      tests must be in the passed count. If any OTHER test fails, STOP.
- [ ] `git status --porcelain` shows `test_core.py` modified and nothing else
- [ ] `git diff -- data.py main.py` is empty (no production code touched)
- [ ] `plans/README.md` status row for 001 updated

## Known pre-existing failure (not yours)

`test_the_gate_reads_the_recorded_holiday_list` fails on the unmodified base
commit. It is time-dependent: it passes `holidays={"2026-08-21"}` and expects
`gate_reason("digest")` to return a reason, which only holds when the wall clock
is outside the 07:00-10:00 Riyadh pre-open window. Inside that window it fails.
It is tracked as a separate finding. Do not fix it here, and do not let it block
this plan — but if it is the ONLY failure, that is the expected state.

## STOP conditions

Stop and report back if:

- `data.py:148-179` does not match the excerpt above (the file drifted).
- Any of your new tests **fails** — that means real behaviour differs from what
  this plan documents. Report the actual behaviour; do not "fix" `data.py`.
- A test appears to reach the real network (visible as a multi-second hang or a
  connection error). That means a yfinance entry point is un-patched. Report it
  rather than adding a network-disabling hack.
- The full suite has pre-existing failures OTHER than
  `test_the_gate_reads_the_recorded_holiday_list` (see above). Report the
  failing test names; do not fix them here.

## Maintenance notes

- These tests deliberately assert **silent** empty-frame behaviour at the
  `data.py` layer. Plan 002 does **not** change that layer's return contract —
  it adds a separate visibility signal. If a future change makes
  `get_histories` raise or return a richer type, all three tests must be
  revisited together.
- `_HISTORY_CACHE` has no reset hook. Every data-layer test must keep using a
  unique `period` string. If the test count here grows much further, adding a
  pytest fixture that clears `data._HISTORY_CACHE` is the right follow-up —
  deliberately deferred out of this plan to keep the diff to additions only.
- A reviewer should check that both `yf.download` and `yf.Ticker` are patched in
  every outage test. Patching only the first is the easy mistake and produces a
  test that silently hits the network.
