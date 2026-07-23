# Backtest findings — 2026-07-23

First validation of the BUY rules against history. The question was "is 65 the
right conviction cutoff?" The answer is that the cutoff is not what is wrong.

**Summary:** the exit levels were structurally broken (median reward:risk 0.12);
they have been rebuilt around ATR from the entry price, which took the system
from −0.44% to +0.00% per trade. No threshold or multiplier setting produces an
edge that survives commissions, because the entry signal shows no measurable
predictive power.

## Setup

| | |
|---|---|
| Universe | 265 currently-listed Tadawul names (probed via `MODE=universe`) |
| History | 5 years of split/dividend-adjusted daily bars |
| Decisions | weekly walk-forward, 56,974 feature rows |
| Signals | 4,721 BUY events across 256 names |
| Entry | next bar's open after the signal |
| Exit | derived stop or target, or timeout at 120 bars |

Not validated: the news criterion (historical headlines are unavailable, so the
score is neutralized to 0.0, which passes). Delisted companies are absent, which
flatters everything below.

## Headline

The rules produce a **71.9% win rate and negative expectancy**.

```
events                 4721
win_rate_pct           71.9
expectancy_pct        -0.44        <- mean return per trade, all events
avg_win_pct            2.04
avg_loss_pct          -6.80
payoff_ratio           0.30
tasi_baseline_pct     -0.43        <- holding the index over the same windows
edge_vs_baseline_pct  -0.01
```

Summed over every signal: **−2087%**. The high win rate is the trap — it is
exactly what a system looks like when it takes small frequent gains and rare
catastrophic losses.

Median winner: **+1.03%, held 2 bars.** Median loser: **−10.42%, held 19 bars.**

## Cause: entry price and level price are decoupled

This is not a miscalibrated number. It is structural.

`derive_levels` references stop and target to **support and resistance** — it
assumes you enter *near support*, in the buy zone. But `buy_decision` no longer
requires that; the buy zone was demoted from a gate to a conviction input in
commit `8138457` ("Add reachable BUY signals"). Under a `trend == "up"` gate,
price is usually near the *top* of its range when the signal fires.

So at the moment of a BUY, the median signal sits:

```
1.62%  above the buy zone
1.28%  below its target        <- nearest resistance, just overhead
10.50% above its stop          <- below support, ~9% risk cap
```

**Median reward:risk = 0.12. 98.6% of signals have R:R below 1.**

At those levels even a 72% win rate loses money by arithmetic:
`0.72 × 1.28 − 0.28 × 10.50 ≈ −2%` per trade.

The commit that made BUY signals reachable also made them unprofitable. Those
are the same change: buying anywhere in an uptrend instead of only near support
is what breaks the risk/reward.

## The cutoff is not the lever

Expectancy by conviction bucket, from the same 4,721 **old-level** events
(the post-fix version of this table is further down, and says the same thing):

| conviction | mean return | count |
|---|---|---|
| 65–75 | −0.67% | 352 |
| 75–85 | −0.66% | 795 |
| 85–95 | −0.37% | 3572 |
| 95–100 | −5.66% | 2 |

Flat and negative throughout. Same for RSI buckets (−0.34% to −0.76% across the
whole 25–60 band). Raising `conviction_min` does not rescue the system, because
conviction does not measure the thing that is broken.

## What about the entry signal itself?

Ignoring the derived exits and just marking forward:

```
fwd_60d_mean_pct    -0.24
fwd_120d_mean_pct   +0.21
tasi_baseline_pct   -0.43
```

Read this cautiously. The ~0.6pp spread at 120 days is **within noise** —
forward windows overlap heavily across names and share market beta, so the
effective sample is far smaller than 4,721. The honest statement: the entry
signal shows **no demonstrated edge**, and the exits are what make the system
clearly negative.

## The fix: ATR levels from the entry price

Implemented. `derive_levels` now places stop and target a volatility-scaled
distance from the current price (`analyze.levels_from_atr`), so reward:risk is
fixed by construction at `atr_target_mult / atr_stop_mult` — 2.0 at the shipped
defaults. Support and resistance still set the buy zone, which feeds conviction;
they no longer set the money levels.

Same universe, same signals, same harness:

| | old (support/resistance) | new (ATR from entry) |
|---|---|---|
| events | 4721 | 3733 |
| win rate | 71.9% | 34.1% |
| avg win / avg loss | +2.04% / −6.80% | +7.63% / −3.95% |
| payoff ratio | 0.30 | **1.93** |
| expectancy | **−0.44%** | **+0.003%** |
| total over all signals | **−2087%** | **+11.6%** |

The structural loss is gone. The lower win rate is expected and not a
regression — wider targets mean fewer, larger wins.

**But this bought break-even, not an edge.** Expectancy is statistically
indistinguishable from zero (95% CI [−0.19%, +0.20%]), and the round-trip
commission is 0.155%, so the net result is **−0.15% per trade**.

## Multiplier sweep: no setting survives commissions

25 stop/target combinations, re-placing levels from the cached ATR (`SWEEP=levels`):

| stop (ATR) | target (ATR) | R:R | events | expectancy | win rate | payoff |
|---|---|---|---|---|---|---|
| 1.0 | 6.0 | 6.00 | 3599 | +0.09% | 17.2% | 5.01 |
| 1.0 | 4.0 | 4.00 | 4115 | +0.09% | 22.6% | 3.58 |
| 1.5 | 4.0 | 2.67 | 3388 | +0.08% | 28.8% | 2.55 |
| **1.5** | **3.0** | **2.00** | **3734** | **+0.00%** | **34.1%** | **1.93** |
| 2.0 | 3.0 | 1.50 | 3290 | −0.15% | 39.0% | 1.49 |
| 3.0 | 6.0 | 2.00 | 2199 | −0.49% | 30.7% | 2.04 |

The best cell is stop 1.0 / target 4.0 at **+0.094% ± 0.090 (1 s.e.)** — a 95%
CI of [−0.08%, +0.27%] that contains zero, and it is **the maximum of 25 tried**,
so it is biased high by selection. Net of commission it is −0.06%.

Expectancy improves as the stop tightens (1.0 > 1.5 > 2.0 > 2.5 > 3.0). Read
that trend as directional rather than exact: the 9% `stop_loss_pct` cap clips
the wide-stop rows for volatile names, so "3.0 ATR" is not purely 3 ATR
everywhere. The direction survives the confound, and it is not a good sign — it
means the fastest exit is the best exit, which is what you see when entries
carry no predictive information and the only thing that helps is losing less
on them.

**Recommendation: keep `atr_stop_mult` 1.5 / `atr_target_mult` 3.0.** R:R 2.0 is
a principled choice, and nothing in the grid is statistically distinguishable
from it. Chasing the grid maximum would be exactly the guesswork this harness
exists to prevent.

## Where that leaves the system

Two separate questions, now separately answered:

1. **Were the exits broken?** Yes, badly, and they are fixed. −0.44% → +0.00%.
2. **Does the entry signal predict anything?** **No evidence that it does.**
   Forward returns at 120 days (+0.17%) sit inside the noise band, and no exit
   parameterization turns the signal profitable.

Conviction on the **fixed** system, over the 3,733 ATR-level events — the
decision-relevant version of the earlier table:

| conviction | mean return | ± 1 s.e. | count |
|---|---|---|---|
| 65–75 | +0.49% | 0.42 | 360 |
| 75–85 | −0.06% | 0.25 | 674 |
| 85–95 | −0.04% | 0.11 | 2694 |
| 95–100 | −1.55% | 2.55 | 5 |

Not merely flat — **inverted**. The lowest conviction bucket has the highest
mean return, and every bucket is inside its own standard error. Whatever
`conviction_score` measures, it is not future return, and raising or lowering
`conviction_min` moves nothing that matters. Regime tells the same story
(`ok` +0.02% vs `breakdown` −0.06%), as does RSI across the whole band.

The honest read: the recommender is now structurally sound and informationally
empty. It no longer loses money by construction; it also does not make any.
Work on the BUY criteria themselves — not the thresholds, the *inputs* — is
where any edge would have to come from.

## Caveats

- Stops fill *at* the stop price; real gaps fill worse. Results are optimistic.
- Same-bar stop-and-target is recorded as a stop (daily bars cannot order them).
- Survivorship: delisted names are invisible.
- The news criterion is untested.
- **Every confidence interval here assumes independent trades.** They are not —
  trades overlap in calendar time and share market beta, so the effective sample
  is smaller than the event count and the true intervals are *wider* than
  quoted. This only reinforces the "no measurable edge" conclusion; it would
  undermine a positive one.
- The reported returns are gross. Round-trip commission is 0.155%
  (`RISK["commission_rate"]`), which exceeds every expectancy measured here.
