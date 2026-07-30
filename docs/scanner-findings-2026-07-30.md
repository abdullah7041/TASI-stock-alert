# Breakout scanner: Stage 0/1 findings (2026-07-30)

Gate for Stage F per the master plan's kill switch: "if no feature beats base
rate, report the negative result and stop." Computed via
`research/base_rate.py` and `research/lift_analysis.py`, offline over
`.cache/features.csv` (53,795 rows after dropping unjudgeable tail rows, 265
codes, 2021-2026).

## Base rate

Two labels, same entry convention (t+1's open), same 60-bar window:

| Label | Definition | Rate |
|---|---|---|
| max-High touch | ever touched +15% intra-window | 15,048/53,795 = **27.97%** |
| close-to-close | closed at +15% at the 60-bar mark | 6,913/53,795 = **12.85%** |

More than half of "rockets" by the max-High definition never closed there.
The master plan's own mock digest assumed an 8.1% base rate — the real
number, on either label, is materially higher. **Every feature below is
judged as lift over these two numbers, not the plan's illustrative 8.1%.**

By year (max-High), swings hard with the market: 2021 21.3%, 2022 23.8%,
2023 **43.9%**, 2024 30.7%, 2025 **16.6%**, 2026 (partial) 26.8%. A feature
tested only on 2023 or only on 2025 would look like a completely different
result.

## Base rate is itself volatility-driven

Split into ATR/price terciles (a name's own trailing volatility, independent
of any candidate feature):

| Vol tercile | max-High rate | close-to-close rate |
|---|---|---|
| low | 18.8% | 10.0% |
| mid | 28.0% | 13.2% |
| high | 37.0% | 15.4% |

Monotonic in both labels. **Consequence:** two of the four candidate
features (`vol_surge`, `atr_squeeze`) are themselves volatility proxies, so
their pooled lift tables must be read within volatility strata, not against
the pooled rate — a feature correlated with volatility will look like it has
lift purely because volatile names touch +15% more often, independent of any
real edge.

Liquidity floor (median 60-bar dollar turnover ≥ 50,000 SAR — the level below
which a ~500 SAR order starts to matter) drops 8.1% of rows (53,795 →
49,463). All feature tables below are post-floor.

## Candidate features

### `rel_strength` — SURVIVOR

`ret_60d(code) − ret_60d(^TASI.SR)`. Monotonic top-bucket lift, and it
**survives every check that could have killed it**:

- Pooled: top decile 1.46x base rate on both labels (close-to-close: also
  1.51x — actually *stronger* on the stricter label, the opposite of what
  an artifact would show).
- Within volatility strata: monotonic rise toward the top bucket in **all
  three** terciles (low 0.85→1.42x, mid 0.90→1.19x, high 1.03→1.11x) — not
  just riding the volatility effect.
- By year (close-to-close, top quintile vs base): 2022 1.52x (10,324 rows),
  2023 1.20x (8,385), 2024 1.28x (11,810), 2025 1.54x (12,638) — positive in
  every full year. 2021 (1,906 rows, partial start-of-history year) shows
  2.18x and 2026 (4,138 rows, partial year) shows 1.05x — both noted but not
  leaned on; too few rows to trust either extreme.
- **Late-window check** (does the +15% touch happen in bars 31-60 rather
  than 1-30, ruling out this just being 60-day momentum bleeding over from
  the entry bar): top decile still shows **1.46x lift against a 23.96%
  late-window base rate** — same magnitude as the full-window result. The
  edge is not an artifact of the label window overlapping the feature's own
  lookback.

### `atr_squeeze` (ATR/price percentile vs trailing 126 bars) — CONDITIONAL SURVIVOR

Pooled deciles look backwards at first glance (top percentile decile shows
the *highest* lift, 1.10-1.23x, when the "squeeze precedes expansion"
hypothesis predicts the opposite). This is Simpson's paradox: high-percentile
rows concentrate in the high-volatility tercile, which has a much higher
base rate on its own. Stratifying by volatility reveals the real pattern —

| Vol tercile | decile 0 (most squeezed) lift | decile 4 (least squeezed) lift |
|---|---|---|
| low | **1.43x** | 0.50x |
| mid | **1.25x** | 0.83x |
| high | 1.06x | 1.02x (flat, no signal) |

Monotonic decreasing exactly as the squeeze hypothesis predicts, **but only
within low/mid volatility names** — a name already in the high-vol tercile
doesn't have a meaningful "squeeze" state. By year it is unreliable: 1.66x
(2022), **0.87x (2023, the strong bull year)**, 1.09x (2024), 1.24x (2025),
1.46x (2026) — fails specifically when the whole market is floating
everything up, which is a real caveat, not noise.

**Verdict: usable only as a condition scoped to non-high-volatility names,**
not as a standalone universal filter.

### `vol_surge` (dollar volume vs 20-day median) — FAIL

No monotonicity pooled (deciles bounce 0.92x-1.14x, no trend) and none within
any volatility tercile either (0.91x-1.13x, still no trend). Volume surge
alone carries no measurable signal in this universe over this window.

### `dist_52w_high` — FAIL, and backwards from the plan's own hypothesis

The plan's rationale was breakout proximity: closer to the 52-week high
should predict more upside. The data says the opposite. Pooled deciles are
U-shaped, driven almost entirely by decile 0 (**furthest below** the 52-week
high) showing 1.35x lift, then dropping to 0.83-0.99x through the middle,
recovering only to 1.10x in the top decile (closest to the high). Within the
low-volatility tercile this is even sharper: 1.61x → 1.00x → 0.86x → 0.74x →
0.79x, **monotonically decreasing** as the name gets closer to its high — the
exact reverse of "proximity to breakout." What this feature actually measures
is a beaten-down-stock mean-reversion bounce, not a breakout signal. By year
it swings 0.71x-1.28x with no consistent direction.

**Verdict: fails as specified.** A "how far below the low, not the high"
mean-reversion feature might be a different, real result — but that is a
different hypothesis than the plan proposed, out of scope here.

## Caveats that apply to every number above

- **Rows are not independent.** `step_days=5` samples of overlapping 60-bar
  forward windows means adjacent rows for the same code share ~92% of their
  forward window. A decile bucket's row count (~4,900) is not ~4,900
  independent observations — closer to a few hundred effective ones. Read
  every lift number above as **directionally consistent, not statistically
  significant.**
- **Survivorship bias.** `universe.json` holds only currently-listed names;
  a delisted name never gets its +15% touch and never appears in this study
  either. On this base rate (27.97%, higher than the plan assumed) this
  inflates measured lift more than it would on a lower one. Every lift
  number above is an upper bound, not an estimate.
- **max-High vs close-to-close.** Reported both throughout on purpose —
  `rel_strength`'s lift holds on both, which is part of why it survives.

## Recommendation

Not a clean pass or a clean kill. **One feature (`rel_strength`) clears every
check, including the two designed to break a false positive** (volatility
stratification, late-window isolation). **One (`atr_squeeze`) works but only
conditioned on non-high-volatility names and is unreliable in strong bull
years.** Two (`vol_surge`, `dist_52w_high`) fail outright — the latter
backwards from its own stated rationale.

Per the plan's own Stage 2 rule ("combine only survivors as a count-of-
conditions"), Stage F — if it proceeds — should ship with a **2-condition**
scanner (`rel_strength` unconditional + `atr_squeeze` scoped to non-high-vol
names), not the 4-condition design in the plan, and the digest's Scanner
block must quote lift against the two base rates above (27.97% / 12.85%),
never the plan's 8.1% placeholder.
