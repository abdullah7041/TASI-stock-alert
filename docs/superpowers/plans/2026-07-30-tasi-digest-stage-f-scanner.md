# Stage F: breakout scanner (scaled to what actually survived Stage 0/1)

## Context

Master plan (`docs/superpowers/plans` predecessor at
`~/.claude/plans/still-not-what-i-sequential-gizmo.md`, §6) specified a
4-condition scanner (`vol_surge`, `atr_squeeze`, `rel_strength`,
`dist_52w_high`) gated on Stage 0's base rate, with an explicit kill switch:
"if no feature beats base rate, report the negative result and stop."

Stage 0/1 ran this session: `research/base_rate.py` (base rate) and
`research/lift_analysis.py` (feature lift), findings in
`docs/scanner-findings-2026-07-30.md`. Result is neither a clean pass nor a
clean kill:

- **`rel_strength` (60d return vs `^TASI.SR`) survives every check** —
  monotonic top-decile lift ~1.46-1.51x, holds within all 3 volatility
  strata, holds in every full year tested, holds when the +15% touch is
  required in bars 31-60 only (rules out momentum bleed-over from the
  feature's own lookback).
- **`atr_squeeze` (ATR/price percentile vs trailing 126 bars) survives
  conditionally** — real monotonic lift (1.25-1.43x) but only within
  low/mid volatility names, and unreliable in strong bull years (2023: 0.87x).
- **`vol_surge` and `dist_52w_high` fail** — no monotonicity (`vol_surge`),
  or lift running backwards from the stated hypothesis (`dist_52w_high`:
  the effect is beaten-down-stock mean reversion, not breakout proximity).

User decision (this session): proceed with Stage F, but **scaled to the 2
survivors**, not 4. Base rates to quote in the digest are the measured
27.97% (max-High) / 12.85% (close-to-close), never the master plan's
placeholder 8.1%.

## Design

**Count-of-conditions, same shape as the Stage B rule checklist** — 0, 1, or
2 conditions met, no scores, no ML.

- **Condition 1 — `rel_strength`:** `ret_60d(code) − ret_60d(index) >= 15.0`
  percentage points. Threshold is this study's ~90th-percentile boundary
  (measured 15.07, rounded).
- **Condition 2 — `atr_squeeze`, scoped:** applies only when the code's own
  trailing volatility (`ATR(14)/price * 100`) is `<= 2.9` (this study's
  low+mid tercile boundary — squeeze showed no signal above this). Within
  scope, met when `atr_squeeze_pctile <= 0.2` (bottom quintile of the name's
  own trailing 126-bar ATR/price range — i.e. compressed now vs its own
  recent history). Above the 2.9 cutoff, condition 2 is simply "not met",
  never evaluated further — matches the finding that squeeze is flat/noisy
  in already-volatile names.
- **Liquidity floor:** `median(Close*Volume, 60) >= 50,000 SAR`. Filter,
  applied before scoring — codes below this are dropped entirely, never
  ranked. (Same value used throughout the Stage 0/1 study.)
- Rank by conditions_met descending, tiebreak by `rel_strength` descending.
  Output only codes with `conditions_met >= 1` (0 is not a candidate).
  Cap the printed list at 10.

## Files

### 1. New `scanner_features.py` — extract shared feature math

`research/lift_analysis.py` currently defines `code_feature_series(df)`
inline (whole-history rolling vol_surge / atr_squeeze_pctile / ret_60d /
dist_52w_high / liquidity_sar / volatility_pct, all no-look-ahead:
rolling/shift, never centered). Move it verbatim to a new top-level
`scanner_features.py` module. `research/lift_analysis.py` imports it back
(`from scanner_features import code_feature_series`) instead of defining it.

This is the same principle `backtest.py` already states for its own reuse of
production indicators: the live scanner and the research that validated it
must call the same function, or a wrong scanner number is undetectable.

**Mechanical, but verify by rerun:** after moving, delete
`.cache/lift_labeled.csv` and rerun `python research/lift_analysis.py`.
Every printed number (base rates, decile tables, the late-window check) must
be byte-identical to the run already captured in
`docs/scanner-findings-2026-07-30.md`. Any difference means the extraction
changed behavior — stop and find why before continuing.

Keep `dist_52w_high` and `vol_surge` in the shared function even though
scanner.py won't use them — `research/lift_analysis.py` still reports on
all 4 for the historical record, and a function that computes what its
caller needs is fine; deleting the two failed columns would silently break
`lift_analysis.py`'s existing output.

### 2. `data.py` — new `get_histories_adjusted`

Add alongside `get_histories` (`data.py:109`), same batching/threading/
per-code-retry structure, but `auto_adjust=True` and its own in-memory
cache dict (do not reuse `_HISTORY_CACHE` — same `(code, period)` key space
would silently return unadjusted data to an adjusted-data caller or vice
versa depending on call order).

```python
def get_histories_adjusted(codes: list, period: str = "1y") -> dict:
```

No disk cache (unlike `backtest.load_adjusted`, which caches to
`.cache/history/*.csv` forever — correct for a static research corpus,
wrong for a live scanner that needs today's bar). Every call hits the
network for codes not already in the in-memory cache this run.

Docstring must state why this exists instead of reusing `load_adjusted`:
the scanner needs today's bar; the backtest cache is deliberately frozen.

### 3. New `config.py` `SCANNER` dict

```python
SCANNER = {
    "rel_strength_threshold_pct": 15.0,
    "vol_high_cutoff_pct":        2.9,    # ATR/price*100 above this: squeeze condition doesn't apply.
    "squeeze_pctile_cutoff":      0.2,    # bottom quintile of trailing 126-bar own range.
    "liquidity_floor_sar":        50_000,
    "min_history_bars":           130,    # 126-bar squeeze window + buffer.
    "history_period":             "1y",
    "top_n":                      10,
}
```

Comment each threshold with its measured value from
`docs/scanner-findings-2026-07-30.md` so a future reader can tell "tuned
knob" from "made up number".

### 4. New `scanner.py`

```python
def scan(codes: list, hist: dict, index_df) -> list[dict]:
```

For each code with `len(hist[code]) >= SCANNER["min_history_bars"]`:
compute `scanner_features.code_feature_series(df)`, take the **last row**
(today's snapshot). Look up `index_ret60 = index_features["ret_60d"].asof(date)`
same as `lift_analysis.build_labeled_with_features` already does. Apply the
liquidity floor first — codes below it never enter the ranking. Evaluate
both conditions per the thresholds above; `conditions_met` is 0, 1, or 2.
Return `[{code, price, conditions_met, rel_strength, rel_strength_met,
volatility_pct, atr_squeeze_pctile, squeeze_met, liquidity_sar}]` sorted per
the ranking rule above, filtered to `conditions_met >= 1`, capped at
`SCANNER["top_n"]`.

```python
def resolve_names(candidates: list) -> dict:
```

Looks up a display name **only for the final candidate list** (not all 265
— `data._yahoo_name` is a per-code network call; run it against ~265 codes
and the scanner takes forever for no reason). Falls back to the bare code
if the lookup fails.

```python
def main() -> int:
```

`universe.load()` for codes, `data.get_histories_adjusted(codes +
[cfg.REGIME["index_code"]], cfg.SCANNER["history_period"])`, `scan(...)`,
`resolve_names(...)`, print the ranked list plainly (this is also the CLI
entry point — `python scanner.py` standalone, matching `research/base_rate.py`'s
own run convention). Print the liquidity-floor drop count and the measured
base rates (27.97% / 12.85%) alongside the ranked list, not just the ranks —
a rank without its base rate is not a result, same rule
`base_rate_report` already enforces.

### 5. `notify.py` — new `format_scanner_block`

```python
def format_scanner_block(candidates: list, names: dict) -> str:
```

Appends a `**Scanner**` section to the digest, one line per candidate:

```
**Scanner** — top breakout candidates from 265 names (base rate 27.97% max-touch / 12.85% held-to-close)
   2222 XXXX  @ 27.30   2/2 — 18.4% vs TASI (60d), ATR squeeze (12th pctile, low-vol name)
   1211 YYYY  @ 48.90   1/2 — 21.1% vs TASI (60d)
_Ranked candidates, not recommendations. Two features, both measured this session — see docs/scanner-findings-2026-07-30.md. You decide._
```

Firing conditions are named per candidate (mirrors the existing rule
checklist's plain-language style from Stage B) — not just "2/2" alone.
Empty candidate list still prints the header line plus "no candidates
today" — never silently omit the section, or a scanner outage looks
identical to a quiet market.

### 6. `main.py` — wire into the digest

`mode_digest` (`main.py:287`) gains a scanner step after the existing
holdings/watchlist recs are collected: call `scanner.main`-equivalent logic
(import `scanner`, call `scanner.scan`/`resolve_names` directly, not the CLI
`main()`), append `notify.format_scanner_block(...)` to the digest text.
Fail soft: any exception scanning (network, bad data) must not break the
existing holdings/watchlist digest — catch, print/log, emit "Scanner:
unavailable" instead of raising. This is a genuinely new network-heavy step
(265 names) riding on every digest run; failing soft here matters more than
it did for the 11-name loops.

### 7. `test_core.py`

- `scanner_features.code_feature_series` on a small synthetic OHLCV frame:
  hand-computable `vol_surge`, `ret_60d`, `liquidity_sar` at a known row.
- `scanner.scan`: synthetic `hist` dict covering (a) a code that clears both
  conditions, (b) one that clears only `rel_strength`, (c) one whose
  volatility is above the 2.9 cutoff with a compressed `atr_squeeze_pctile`
  (must NOT get credit for condition 2 — this is the one most likely to be
  coded wrong), (d) one below the liquidity floor (must be excluded
  entirely, not scored 0). Assert conditions_met and ranking order.
- `data.get_histories_adjusted`: monkeypatch `yfinance.download` (matching
  `news.py`/`disclosures.py`'s existing convention of not hitting the real
  network in tests) — confirm `auto_adjust=True` is passed and results don't
  collide with `get_histories`'s cache.
- Rerun-and-diff from Task 1 above stands as the correctness check for
  `code_feature_series` itself; no need to re-derive its lift numbers here.

### 8. `README.md`

Stage F section: what the scanner checks, the two survivor conditions and
their thresholds, a link to `docs/scanner-findings-2026-07-30.md`, and an
explicit note that `vol_surge`/`dist_52w_high` were tested and dropped (so a
future reader doesn't re-propose them without reading why).

## Sequencing

1. **Task 1** (extraction + rerun-diff verification) first — everything
   else imports from `scanner_features.py`.
2. **Task 2** (`data.py` loader) and **Task 3** (`config.py` dict) — small,
   independent, can run in parallel with each other.
3. **Task 4** (`scanner.py`) — depends on 1, 2, 3.
4. **Task 5** (`notify.py` block) — depends on 4's candidate dict shape.
5. **Task 6** (`main.py` wiring, fail-soft) — depends on 4 and 5.
6. **Task 7** (tests) — depends on 1, 2, 4.
7. **Task 8** (docs) — last, depends on everything above being final.

## Verification

- `python test_core.py` green, including the new scanner tests.
- The Task-1 rerun-diff against `docs/scanner-findings-2026-07-30.md`
  produces identical numbers.
- `python scanner.py` runs standalone against the real universe, prints a
  ranked list (or "no candidates") plus both base rates, completes without
  raising.
- `MODE=digest python main.py` (webhook unset) prints the full digest
  including a Scanner section — inspect against the target block above.
- Force a scanner-side exception (e.g. temporarily break `universe.json`
  parsing) and confirm the holdings/watchlist digest still prints, with
  "Scanner: unavailable" in place of the block.
- Confirm the liquidity floor actually excludes low-turnover names in a real
  run (print the drop count, sanity-check a few excluded codes by hand).
