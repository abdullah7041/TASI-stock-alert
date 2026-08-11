# Plan 05: Correct the three comments that claim the market regime gates BUY

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `docs/superpowers/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 6ada068..HEAD -- analyze.py config.py backtest.py`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. **Safe to run in parallel with plan 01** — none of the
  three files this plan touches appear in `git diff --name-only main...codex/fix-honest-daily-cockpit`.
- **Category**: docs
- **Planned at**: commit `6ada068`, 2026-08-10

## Why this matters

Three comments in this repository state that the TASI market regime suppresses
BUY signals. It does not, and has not since the conviction score was removed.

That matters more here than it would elsewhere. This repo's whole discipline is
that a claim in a comment is a claim you can check: `analyze.buy_decision`'s
docstring names the exact three rules and points at
`docs/backtest-findings-2026-07-23.md`; `notify._fmt_news` explains why a failed
fetch must not render like an empty result; `README.md:75` says plainly there is
"no conviction score" and it "was deleted, not tuned." A reader who trusts that
voice and then reads "When breakdown, BUY signals are suppressed" will believe
there is a market-wide safety gate protecting them. There is no such gate. Every
BUY decision is made from three per-name rules and nothing else.

The README already gets this right (`README.md:10`): "The regime is context, not
a gate — it no longer changes any per-name decision." The code comments never
caught up.

## Current state

### Proof that the regime gates nothing

`analyze.py:182-233` — `buy_decision` is the single place BUY is decided, and
its signature takes no regime:

```python
def buy_decision(long_read: dict, criteria: dict) -> tuple[bool, list]:
```

Its body builds exactly three rules (`rsi_band`, `trend`, `momentum_floor`) and
returns `all(rule["passed"] for rule in rules), rules`. There is no fourth term.

`analyze.py:328-330`, in `evaluate_watchlist`'s docstring, already records the
removal:

```
    `regime` is no longer a parameter: it only ever fed the conviction cutoff,
    which is gone. The market regime is still computed once per run and shown
    in the digest header.
```

`main.py:344` uses the regime for exactly one thing — the digest header text:

```python
    msg = nt.build_message(recs, f"TASI pre-open digest ({_today()}) - regime: {regime}",
```

### The three stale comments

**1.** `analyze.py:29-31`:

```python
def market_regime(index_df: pd.DataFrame, index_ma: int) -> str:
    """'ok' or 'breakdown'. Breakdown = index below its MA and the MA is falling.
    When breakdown, BUY signals are suppressed."""
```

The second sentence is false.

**2.** `config.py:148-149`:

```python
# --- Market regime (index breakdown filter) --------------------------------
# When TASI itself is breaking down, suppress BUY signals.
REGIME = {
```

Both the section title ("filter") and the comment are false.

**3.** `backtest.py:163-170`, in `_regime_at`:

```python
def _regime_at(regimes: pd.Series, when) -> str:
    """Regime as of `when`, using only bars at or before it.

    No blanket except here on purpose: swallowing an error would return
    'unknown' for every date, which quietly raises the BUY bar to the breakdown
    cutoff and looks like a market call rather than a bug. Timestamps are
    normalized instead, so the mismatch that would raise cannot occur.
    """
```

"quietly raises the BUY bar to the breakdown cutoff" describes behavior that no
longer exists — there is no regime-varying BUY bar. The *reasoning* the comment
gives for not swallowing exceptions is still sound; only its stated consequence
is stale.

### What the regime IS still used for (do not delete it)

- `main.py:226` computes it once per run.
- `main.py:344` puts it in the digest header.
- The cockpit snapshot carries it as a `regime` field, and
  `app/lib/dashboard-core.mjs` **requires** it to be a non-empty string.
- `backtest.py:151-160` (`regime_series`) records it as a feature column
  (`backtest.py:181` `FEATURE_COLS` includes `"regime"`) so a future analysis
  can ask whether it ever had predictive value. It is recorded, not acted on.

This plan changes comments only. `market_regime` and every caller stay exactly
as they are.

### Repo conventions

- Removals are documented with their reason and a pointer to the evidence. Two
  exemplars to match in tone — `config.py:86-91`:

  ```
  # There is no conviction score and no regime-raised bar: conviction backtested
  # INVERTED against forward return and was deleted rather than tuned (see
  # docs/backtest-findings-2026-07-23.md). There is no news rule either — news
  # has never been validated against outcomes, so it is shown as context and
  # gates nothing.
  ```

  and `analyze.py:328-330`, quoted above. Write in that voice: state what is
  true, say what changed, point at the evidence. No hedging.
- Conventional Commits, lowercase subject, no trailing period.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Python tests + count | `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q 2>&1 \| tail -1` | exit 0, a `N passed` line |
| Import smoke test | `python -c "import config, analyze, backtest; print('ok')"` | prints `ok` |
| Stale-claim check | `git grep -ni "suppress.*buy\|buy.*suppress" -- '*.py'` | no output |

**On the test count**: it was 199 when this plan was written, but plan 01 adds
tests to `test_core.py` and may land first. Do not assert on 199. Capture the
count **before** your first edit and compare against it afterwards — the
invariant is *unchanged*, not any particular number.

If `test_cockpit.py` no longer exists, plan 08 has landed; drop it from the
command and carry on.

## Scope

**In scope** (the only files you may modify):

- `analyze.py` — the `market_regime` docstring only
- `config.py` — the `REGIME` section header and comment only
- `backtest.py` — the `_regime_at` docstring only
- `docs/superpowers/plans/README.md` (your status row)

**Out of scope** (do NOT touch, even though they look related):

- Any executable line. This plan changes comments and docstrings. `git diff`
  must show no change to a line that runs.
- `README.md` — it is already correct at line 10. Do not "improve" it.
- `market_regime` itself, `regime_series`, `_regime_at`'s body, or the `regime`
  entry in `backtest.FEATURE_COLS`. The regime is deliberately still computed
  and recorded.
- `main.py` — the unused `_regime()` helper at `main.py:70-72` is dead code and
  is handled by plan 08, which touches `main.py` after plan 01 lands. Leave it.
- `docs/superpowers/specs/` and `docs/*-findings-*.md` — historical records.

## Git workflow

- Branch: `advisor/05-stale-regime-docstrings`
- One commit: `docs: stop claiming the regime gates BUY`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Record the baseline test count

```bash
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q 2>&1 | tail -1
```

**Verify**: exits 0 and prints a line containing a passed count (e.g.
`199 passed`). Write that number down — every later check compares against it,
not against any figure quoted in this plan.

Do **not** use `pytest --collect-only` to get this number. This environment
wraps `pytest` in a proxy that replaces its output with a summary line, and
`--collect-only` comes back as `No tests collected` even when the suite is fine.
The normal run's summary is the reliable source.

If the tail line does not contain a number, print more of the output
(`| tail -5`) and use whatever line carries the passed count.

### Step 1: Confirm the claim is false before rewriting it

```bash
python -c "
import inspect, analyze
src = inspect.getsource(analyze.buy_decision)
print('regime mentioned in buy_decision body:', 'regime' in src.split('\"\"\"')[2])
print('signature:', inspect.signature(analyze.buy_decision))
"
```

**Verify**: prints `regime mentioned in buy_decision body: False` and a
signature of `(long_read: dict, criteria: dict) -> tuple[bool, list]`.

If the signature contains a regime parameter, the comments are **not** stale and
this whole plan is wrong — STOP and report.

### Step 2: Fix `analyze.market_regime`'s docstring

Replace `analyze.py:29-31` with:

```python
def market_regime(index_df: pd.DataFrame, index_ma: int) -> str:
    """'ok' / 'breakdown' / 'unknown'. Breakdown = index below its MA and the MA
    is falling.

    Context, not a gate. This label changes no per-name decision: BUY is decided
    entirely by buy_decision's three rules. It was a gate once, through the
    conviction cutoff, and lost that role when conviction was deleted for
    backtesting inverted against forward return (see
    docs/backtest-findings-2026-07-23.md). It survives because it is shown in
    the digest header, carried in the cockpit snapshot, and recorded as a
    backtest feature column so someone can one day measure whether it ever
    predicted anything.
    """
```

Note the return-value list gains `'unknown'`, which the function has always been
able to return (`analyze.py:33`, `:36`) and the old docstring omitted.

**Verify**: `python -c "import analyze; print(analyze.market_regime.__doc__.splitlines()[0])"`
→ prints the `'ok' / 'breakdown' / 'unknown'...` line.

### Step 3: Fix the `config.py` REGIME comment

Replace `config.py:148-149` with:

```python
# --- Market regime (context label, not a filter) ----------------------------
# Computed once per run and shown in the digest header. It suppresses nothing:
# BUY is decided by BUY_CRITERIA above, per name, with no market-wide gate. The
# regime fed the conviction cutoff until conviction was deleted (see
# docs/backtest-findings-2026-07-23.md); the label was kept, the gate was not.
```

**Verify**: `git grep -n "suppress" -- config.py` → no output.

### Step 4: Fix the `_regime_at` docstring in `backtest.py`

Replace `backtest.py:163-170`'s docstring with:

```python
def _regime_at(regimes: pd.Series, when) -> str:
    """Regime as of `when`, using only bars at or before it.

    No blanket except here on purpose: swallowing an error would silently
    relabel every date 'unknown', which would look like a market call rather
    than a bug in any analysis that later reads the regime feature column.
    Timestamps are normalized instead, so the mismatch that would raise cannot
    occur.
    """
```

Keep the body byte-identical. Only the docstring's second paragraph changes —
the reasoning about not swallowing exceptions is preserved; only its stale
consequence ("raises the BUY bar to the breakdown cutoff") is replaced.

**Verify**: `git grep -n "BUY bar" -- backtest.py` → no output.

### Step 5: Confirm nothing executable changed

```bash
git diff -U0 -- analyze.py config.py backtest.py
```

**Verify**: read the diff. Every changed line is inside a `"""..."""` docstring
or begins with `#`. If any changed line is executable code, revert it.

```bash
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q
python -c "import config, analyze, backtest; print('ok')"
git status --porcelain
```

**Verify**: pytest exits 0 with **exactly the count you recorded in step 0** —
no more and no fewer. The import prints `ok`. `git status --porcelain` lists
only the four in-scope files.

## Test plan

**No new tests, deliberately.** A test that asserts on docstring text would fail
the next time someone improves the wording, which is worse than no test. The
real guard is step 5: the test count must be identical to the step 0 baseline,
proving no behavior moved.

The existing regime tests (`test_core.py:121-130`) cover
`market_regime`'s three return values and must stay green untouched — they are
the evidence that step 2 changed only prose.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git grep -ni "suppress.*buy\|buy.*suppress" -- '*.py'` returns no output
- [ ] `git grep -n "BUY bar" -- backtest.py` returns no output
- [ ] `git grep -n "index breakdown filter" -- config.py` returns no output
- [ ] `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` exits 0 with **exactly the step 0 baseline count**
- [ ] `python -c "import config, analyze, backtest; print('ok')"` prints `ok`
- [ ] `git diff -U0 -- analyze.py config.py backtest.py` shows no changed line
      outside a docstring or `#` comment
- [ ] `git status --porcelain` lists no file outside the in-scope list
- [ ] `docs/superpowers/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 shows `buy_decision` does take a regime argument — the comments are
  accurate and this plan is based on a false premise.
- The test count after your change differs from the step 0 baseline in either
  direction. (Do not compare against any number written in this plan — plan 01
  adds tests to `test_core.py` and may have landed first.)
- You find a **fourth** location making the same claim that is not in the
  in-scope list. Report the `file:line`; do not expand scope silently.
- You are tempted to change `market_regime`'s behavior, or to delete it because
  "nothing gates on it". It is deliberately retained — see the out-of-scope
  list.

## Maintenance notes

- **The rule this encodes**: in this repo, a comment that describes a gate is a
  claim about money. When a gate is removed, the comment describing it is part
  of the removal, not follow-up work. `analyze.evaluate_watchlist`'s docstring
  is the model — it names the removed parameter, says what it used to feed, and
  says what replaced it.
- **What a reviewer should scrutinize**: that the diff is prose-only. Run
  `git diff -U0` and read every `+` line.
- **If the regime is ever made a gate again**, all three of these comments plus
  `README.md:10` and `config.py:86-91` have to change together, and — by this
  repo's own standard — a backtest has to justify it first.
- Related dead code left for plan 08: `main.py:70-72` defines a `_regime()`
  helper that nothing calls; `_collect_recs` calls `az.market_regime` directly
  at `main.py:226`.
