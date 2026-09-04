# Plan 002: Make a price-data outage visible instead of rendering as an empty digest

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7bb9fdb..HEAD -- main.py data.py test_core.py`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: `plans/001-data-outage-regression-tests.md` (must be DONE)
- **Category**: bug
- **Planned at**: commit `7bb9fdb` (origin/main), 2026-08-30 — re-based from 143b740; excerpts re-verified byte-identical at 7bb9fdb

## Why this matters

If Yahoo/`yfinance` goes down or ships a breaking change, `data.get_histories`
returns empty DataFrames for every name. `_collect_recs` then skips each one
with `if df is None or df.empty: continue`, and nothing checks whether the
result is empty. The digest ships anyway — correctly formatted, cheerful, and
containing **zero holdings and zero watchlist names** — with exit code 0 and a
green workflow run. The reader cannot distinguish "the market data source is
down" from "nothing happened today".

This repo enforces a three-way honesty rule everywhere else: a failed fetch, an
empty result, and real content must never render identically. `notify.py`
applies it to news and disclosures; `llm.py` applies it to model leans. It is
not applied to the price data all of those depend on.

The fix already exists in this repo, one function away, for a sibling problem:
`_INDEX_WARNING` (`main.py:420-450`) was added because a silent index-fetch
outage rendered as a genuinely-indeterminate market regime. This plan does the
same thing for price history.

## Current state

> **Line numbers were re-verified against `7bb9fdb` on 2026-08-31.** The repo
> synced forward and every `main.py` reference below moved ~32 lines. The CODE
> is byte-identical to what is quoted; only the numbers changed. If a number is
> off by a few lines, trust the quoted code and proceed — do not treat a small
> offset as a drift STOP.

Files involved:

- `main.py` — `_collect_recs` (starts line 392) fetches all history and builds
  the records; `_dashboard_snapshot` (the warnings list is at lines 285–296)
  assembles what the reader sees.
- `data.py` — `get_histories` (lines 148–179), unchanged by this plan.
- `test_core.py` — the single Python test file.

### The exemplar to copy — `main.py:420-450`

This is the pattern to follow. Read it carefully; your change should look like
a sibling of it:

```python
# Set by _collect_recs; read by _dashboard_snapshot. None means no index problem.
_INDEX_WARNING: str | None = None


def _collect_recs(include_news: bool, record_history: bool = False):
    ...
    index_code = cfg.REGIME["index_code"]
    all_codes = [x["code"] for x in cfg.HOLDINGS + cfg.WATCHLIST] + [index_code]
    hist = dat.get_histories(all_codes, cfg.TECH["history_period"])

    idx = hist.get(index_code)
    if idx is None or idx.empty:
        idx = dat.get_index_history(index_code)  # SAHMK fallback path.
    regime = az.market_regime(idx, cfg.REGIME["index_ma"])
    # market_regime returns 'unknown' only when the index frame is empty or
    # too short. Left unsaid, that reads identically to a genuinely
    # indeterminate market -- and it hid a real outage: every snapshot from
    # 2026-08-18 onward carried regime 'unknown' with nothing anywhere saying
    # the ^TASI.SR fetch had stopped returning data.
    global _INDEX_WARNING
    _INDEX_WARNING = None
    if regime == "unknown":
        bars = 0 if idx is None or idx.empty else len(idx)
        _INDEX_WARNING = (
            f"Market regime unavailable: the index ({index_code}) returned "
            f"{bars} usable bars this run, so no regime could be computed.")
        print(_INDEX_WARNING)
```

### Where names are silently dropped — `main.py:477-494`

```python
    for h in cfg.HOLDINGS:
        df = hist.get(h["code"])
        if df is None or df.empty:
            continue
        price = float(df["Close"].iloc[-1])
        ...
    for w in cfg.WATCHLIST:
        df = hist.get(w["code"])
        if df is None or df.empty:
            continue
        price = float(df["Close"].iloc[-1])
```

### Where warnings reach the reader — `main.py:315-327`

```python
    warning = (scanner_result or {}).get("warning")
    warnings = [warning] if warning else []
    if _INDEX_WARNING:
        warnings.append(_INDEX_WARNING)
    if unknown_cost:
        warnings.append(
            f"No avg_cost in config.py for {', '.join(sorted(unknown_cost))} — "
            f"P/L shown as 0.0% is unknown, not flat."
        )
```

This `warnings` list is already rendered in both delivery surfaces — the
Discord digest header and the cockpit's data-quality banner. You do **not**
need to touch either renderer; appending to this list is sufficient.

### Conventions to match

- Warning strings in this repo state the fact, the number, and what the reader
  must not conclude. Compare the `_INDEX_WARNING` text above and the
  `unknown_cost` text: "P/L shown as 0.0% is unknown, not flat." Match that
  voice — name what is missing and deny the wrong inference explicitly.
- Module-level warning globals are declared next to `_INDEX_WARNING` with a
  comment saying who sets and who reads them.
- Comments in this repo explain *why*, often citing the incident that motivated
  the code. Write yours the same way.

## Commands you will need

| Purpose        | Command                                                    | Expected on success |
|----------------|------------------------------------------------------------|---------------------|
| Compile check  | `python -m compileall -q main.py movement.py session_gate.py runtime research` | exit 0, no output |
| Targeted tests | `python -m pytest test_core.py -q -k data_warning`          | all pass            |
| Full Python CI | `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` | all pass, 0 failures |

## Scope

**In scope** (the only files you should modify):
- `main.py` — add `_DATA_WARNING`, populate it in `_collect_recs`, append it in
  `_dashboard_snapshot`.
- `test_core.py` — add tests.

**Out of scope** (do NOT touch, even though they look related):
- `data.py` — do **not** change its return contract. `get_histories` returning
  `{code: DataFrame}` with empty frames for missing data is depended on by
  `get_histories_adjusted`, `backtest.py`, `scanner.py`, and `mode_intraday_probe`.
  Detection belongs in the caller, exactly as `_INDEX_WARNING` does it.
- `notify.py` and `app/` — the warnings list already renders in both surfaces.
- Exit codes. Do **not** make a zero-record digest exit non-zero. The workflow's
  "Commit state" step depends on the current exit-code contract, and changing it
  is a separate decision. See Maintenance notes.
- The `_INDEX_WARNING` logic itself — leave it exactly as is.

## Git workflow

- Branch: `advisor/002-surface-price-data-outages`
- Commit message style — match the repo's log. Real examples:
  `fix: distinguish current and historical alerts (#9)`,
  `refactor: delete the unused cockpit snapshot package`.
  Suggested: `fix: say when price history is missing instead of shipping an empty digest`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Declare the warning global

In `main.py`, next to `_INDEX_WARNING` (line 388–389), add a sibling. Keep the
existing `_INDEX_WARNING` lines unchanged:

```python
# Set by _collect_recs; read by _dashboard_snapshot. None means no index problem.
_INDEX_WARNING: str | None = None
# Set by _collect_recs; read by _dashboard_snapshot. None means every name got
# usable price history. data.get_histories absorbs a source outage and returns
# empty frames, which the record loops below skip with `continue` -- so without
# this, a total Yahoo failure ships a correctly-formatted digest containing no
# names at all, and reads exactly like a quiet market.
_DATA_WARNING: str | None = None
```

**Verify**: `python -m compileall -q main.py` → exit 0, no output.

### Step 2: Populate it in `_collect_recs`

In `_collect_recs`, immediately **after** the `_INDEX_WARNING` block ends (after
the `print(_INDEX_WARNING)` line, currently line 419) and **before**
`stored_levels = _load(LEVELS_FILE, {})` (line 421), insert:

```python
    # The index has its own warning above; this covers the tradeable names.
    global _DATA_WARNING
    _DATA_WARNING = None
    tradeable = [x["code"] for x in cfg.HOLDINGS + cfg.WATCHLIST]
    missing = [c for c in tradeable
               if hist.get(c) is None or hist[c].empty]
    if missing:
        if len(missing) == len(tradeable):
            _DATA_WARNING = (
                f"No price history returned for ANY of the {len(tradeable)} "
                f"names this run. This digest is empty because the data source "
                f"failed, not because nothing happened.")
        else:
            _DATA_WARNING = (
                f"Price history unavailable for {len(missing)} of "
                f"{len(tradeable)} names ({', '.join(sorted(missing))}). They "
                f"are absent from this digest — absence here is not evidence "
                f"they were quiet.")
        print(_DATA_WARNING)
```

Note: `tradeable` deliberately excludes the index code, because the index
already has `_INDEX_WARNING`. Do not merge the two.

**Verify**: `python -m compileall -q main.py` → exit 0, no output.

### Step 3: Surface it to the reader

In `_dashboard_snapshot`, in the warnings block at lines 285–296, append after
the `_INDEX_WARNING` clause:

```python
    if _INDEX_WARNING:
        warnings.append(_INDEX_WARNING)
    if _DATA_WARNING:
        warnings.append(_DATA_WARNING)
```

**Verify**: `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q`
→ 0 failures. Existing tests must still pass; if any now fails because it
asserts an exact `warnings` list, read it and report before changing it.

### Step 4: Test the total outage

Add to `test_core.py`, near the other `_dashboard_snapshot` / warning tests.
Find an existing test that calls `main._collect_recs` or `main._dashboard_snapshot`
and place these beside it.

```python
def test_a_total_price_outage_says_so_instead_of_shipping_an_empty_digest(monkeypatch):
    """An empty digest and a dead data source must not look identical.

    data.get_histories absorbs an outage into empty frames, and _collect_recs
    skips empty frames with `continue`, so a full Yahoo failure produced a
    well-formed digest with zero names in it and exit code 0.
    """
    monkeypatch.setattr(main, "_DATA_WARNING", None)
    monkeypatch.setattr(main, "_INDEX_WARNING", None)
    monkeypatch.setattr(main.dat, "get_histories", lambda codes, period: {c: pd.DataFrame() for c in codes})
    monkeypatch.setattr(main.dat, "get_index_history", lambda code, period="6mo": pd.DataFrame())
    monkeypatch.setattr(main, "_verify_symbols", lambda names: {})
    monkeypatch.setattr(main.discl, "fetch_all", lambda: ([], False))

    _regime, recs, _budget = main._collect_recs(include_news=False, record_history=False)

    assert recs == [], "sanity: a total outage really does drop every name"
    assert main._DATA_WARNING is not None
    assert "not because nothing happened" in main._DATA_WARNING
```

If `_collect_recs` needs more monkeypatching than the above to run offline, add
what is required — but do not stub `_collect_recs` itself; the point is to
exercise the real function.

**Verify**: `python -m pytest test_core.py -q -k total_price_outage` → 1 passed.

### Step 5: Test that the warning reaches the reader

```python
def test_the_price_outage_warning_reaches_the_snapshot_not_just_the_log(monkeypatch):
    """A warning nobody sees is the same as no warning."""
    monkeypatch.setattr(main, "_DATA_WARNING",
                        "Price history unavailable for 2 of 11 names (1303, 2222).")
    monkeypatch.setattr(main, "_INDEX_WARNING", None)

    snapshot = main._dashboard_snapshot(
        "neutral", [], {"monthly_cap": 500.0}, None,
        top10={"proposalId": "p", "status": "draft",
               "researchedAt": "2026-08-25T06:00:00Z", "entries": []},
    )

    assert any("Price history unavailable" in w for w in snapshot["warnings"])
```

Model this on the existing warning test near `test_core.py:2581`, which asserts
a warning string reaches the rendered Discord embed.

**Verify**: `python -m pytest test_core.py -q -k price_outage_warning` → 1 passed.

### Step 6: Confirm plan 001's tests still pass

Plan 001 pinned the data-layer contract. This plan must not have changed it.

**Verify**: `python -m pytest test_core.py -q -k "outage or cache_poison"` → all pass
(the 3 tests from plan 001 plus the 2 added here that match `outage`).

## Test plan

Two new tests in `test_core.py`:

1. Total outage → `_collect_recs` produces zero records **and** sets
   `_DATA_WARNING` naming the cause.
2. `_dashboard_snapshot` carries `_DATA_WARNING` into `snapshot["warnings"]`.

Structural patterns: the `_collect_recs` monkeypatch style used by existing
tests in `test_core.py`; the warning-reaches-the-reader assertion at
`test_core.py:2581`.

Partial-outage wording is exercised indirectly by test 2. A dedicated
partial-outage `_collect_recs` test is optional; add it if cheap.

## Done criteria

ALL must hold:

- [ ] `python -m compileall -q main.py movement.py session_gate.py runtime research` → exit 0
- [ ] `python -m pytest test_core.py -q -k total_price_outage` → 1 passed
- [ ] `python -m pytest test_core.py -q -k price_outage_warning` → 1 passed
- [ ] `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` → 0 failures
- [ ] `grep -n "_DATA_WARNING" main.py` → 5 or more matches (declaration, global, reset, both assignments, snapshot append)
- [ ] `git diff --stat -- data.py` is empty (data layer untouched)
- [ ] `git status --porcelain` shows only `main.py` and `test_core.py` modified
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back if:

- Plan 001 is not marked DONE in `plans/README.md`. Its tests are this plan's
  safety net; do not proceed without them.
- `main.py:420-450`, `main.py:477-494`, or `main.py:315-327` do not match the
  excerpts above.
- An existing test fails after step 3 because it asserts an exact `warnings`
  list. Report which test — it may encode an assumption worth discussing rather
  than silently updating.
- `_collect_recs` cannot be run in a test without stubbing itself or reaching
  the network. Report what it needs.
- You conclude the fix requires changing `data.py`'s return type. It does not;
  re-read the `_INDEX_WARNING` exemplar. If you still believe it, stop and
  report rather than proceeding.

## Maintenance notes

- **Deliberately deferred**: a total outage still exits 0 and still ships a
  digest. That is consistent with this repo's stated preference for shipping a
  labelled degraded result over silence, and changing it would interact with the
  workflow's `Commit state` step (which runs `if: always()`) and the
  `Fail if runtime failed` step. If you later decide a zero-record digest should
  page the operator, that is a separate change touching
  `.github/workflows/tasi.yml` as well as `main.py`.
- `_DATA_WARNING` is module-global state, like `_INDEX_WARNING`. Any test that
  runs `_collect_recs` and then inspects a snapshot must reset it, or it leaks
  between tests. Both new tests monkeypatch it explicitly for this reason.
- If `cfg.HOLDINGS` ever becomes dynamic (fetched rather than hardcoded), the
  `tradeable` list in step 2 must follow the same source, or the counts in the
  warning will be wrong.
- A reviewer should check that the index code is **not** double-counted between
  `_INDEX_WARNING` and `_DATA_WARNING`.
