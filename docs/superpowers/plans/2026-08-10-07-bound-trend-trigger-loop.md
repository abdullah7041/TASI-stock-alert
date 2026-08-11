# Plan 07: Bound the unbounded refinement loop in `triggers.trend_trigger`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `docs/superpowers/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 6ada068..HEAD -- triggers.py test_core.py`
> If `triggers.py` changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `2026-08-10-01-land-honest-cockpit-repair.md` (that branch
  edits `test_core.py`; landing it first avoids a conflict). `triggers.py`
  itself is untouched by that branch.
- **Category**: bug
- **Planned at**: commit `6ada068`, 2026-08-10

## Why this matters

`triggers.trend_trigger` runs on the digest path — once per watchlist name whose
`trend` rule is currently failing — and contains a `while` loop with no
termination bound. If it ever enters a state where its predicate does not hold
for any price above the starting one, the GitHub Actions job spins until the
platform kills it. That is a 6-hour hang on a job scheduled to run every 15
minutes, and the concurrency group `tasi-recommender` with
`cancel-in-progress: false` (`.github/workflows/tasi.yml:21-23`) means every
subsequent scheduled run queues behind it. One hang stops the whole day's
alerting.

What makes this a real finding rather than a theoretical one is that the
function's own docstring explicitly refuses the assumption the loop depends on.
`triggers.py:209-215` says the forward scan is used so the code "stays correct
if `indicators.trend()`'s definition ever changes to something non-monotonic in
the future," and adds, parenthetically, "this code does not depend on that
fact." The refinement loop twelve lines later depends on exactly that fact.

The repo already solved this problem in the same file. `_verified_price`
(`triggers.py:35-69`) does the identical job — walk cent by cent in a safe
direction until a predicate holds — and it has a budget:

```python
    budget = int(abs(reference) * max_pct) + 2   # max_pct% of reference, in cents
    for _ in range(budget):
        ...
    return None
```

Its docstring states the reason: "so a predicate that turns out not to be
monotone in the appended price cannot spin forever, and an unverified price is
never reported as reachable." `momentum_trigger` and `rsi_trigger` both use it.
`trend_trigger` hand-rolls a copy without the budget.

So the fix is not to invent a bound. It is to make the third caller use the
helper the other two already use — which is this repo's stated preference, per
`notify.format_condition_text`'s docstring: "One implementation means one place
left to get this right."

**This cannot fire with today's `indicators.trend`**, which is monotone in the
appended price, so the outer scan's success guarantees the rounded-up candidate
also succeeds. It is a latent hazard guarding a documented future change, not a
live outage. Hence P3.

## Current state

### The unbounded loop

`triggers.py:229-253`, inside `trend_trigger`:

```python
    def is_up(p: float) -> bool:
        candidate = pd.concat([s, pd.Series([p])], ignore_index=True)
        return ind.trend(candidate, short_ma, long_ma) == "up"

    step = max(now * 0.001, 0.01)
    hi_p = now * (1 + max_pct / 100.0)
    price = now
    while price <= hi_p:
        price += step
        if is_up(price):
            # price is a scan step, not necessarily a "clean" 2-decimal
            # price a real quote could take. Round UP to the nearest cent
            # (never down) and re-verify: naively round()-ing the raw scan
            # price to 2dp can round it DOWN past the actual qualifying
            # boundary, reporting a trigger that would NOT actually flip
            # trend if that exact price were appended tomorrow.
            candidate_trigger = math.ceil(price * 100) / 100
            while not is_up(candidate_trigger):
                candidate_trigger += 0.01
            trigger = round(candidate_trigger, 2)
            pct_away = round((trigger - now) / now * 100.0, 2)
            return {"rule": "trend", "trigger_price": trigger,
                    "pct_away": pct_away, "reachable": True,
                    "plain": f"trend flips up at {trigger} "
                             f"({pct_away:+.1f}% away)"}
    return {"rule": "trend", "trigger_price": None, "pct_away": None,
            "reachable": False,
            "plain": f"not reachable within ±{max_pct:.0f}% next bar"}
```

The outer `while price <= hi_p` is bounded. The inner
`while not is_up(candidate_trigger)` is not.

### The bounded helper to reuse

`triggers.py:35-69`:

```python
def _verified_price(raw: float, reference: float, rising: bool, holds,
                    max_pct: float = MAX_SEARCH_PCT) -> float | None:
    """Turn a raw closed-form solve into a real 2-decimal quote that is
    VERIFIED to satisfy the rule it claims to flip.
    ...
    Returns the verified price, or None if the candidate walks more than
    `max_pct` of `reference` past the raw solve without ever holding — so a
    predicate that turns out not to be monotone in the appended price cannot
    spin forever, and an unverified price is never reported as reachable.
    """
    scaled = raw * 100.0
    cents = math.ceil(scaled - 1e-9) if rising else math.floor(scaled + 1e-9)
    step = 1 if rising else -1
    budget = int(abs(reference) * max_pct) + 2   # max_pct% of reference, in cents
    for _ in range(budget):
        if cents <= 0:
            return None
        price = round(cents / 100.0, 2)
        if holds(price):
            return price
        cents += step
    return None
```

With `rising=True` it does exactly what the inner loop does — `math.ceil` to the
next cent (with a `1e-9` nudge for float dust the hand-rolled version lacks),
then step up one cent at a time — and returns `None` instead of spinning.

### How the other two callers use it

`triggers.py:101-103` in `momentum_trigger`:

```python
    trigger = _verified_price(
        raw, now, rising=True,
        holds=lambda p: ind.pct_change(hist + [p], lookback) >= floor_pct)
```

`triggers.py:183-186` in `rsi_trigger`:

```python
    verified = _verified_price(
        trigger, last_close, rising=rising,
        holds=(lambda p: ind.rsi(hist + [p], period) >= target) if rising
        else (lambda p: ind.rsi(hist + [p], period) <= target))
```

Both then handle a `None` return by producing a `reachable: False` dict with a
"no verifiable trigger price" message — `triggers.py:106-108` and
`triggers.py:187-190`. `trend_trigger` needs the same shape.

### Repo conventions

- The three trigger functions all return the same dict keys: `rule`,
  `trigger_price`, `pct_away`, `reachable`, `plain`. `notify._fmt_trigger`
  (`notify.py:85-95`) reads `reachable`, `pct_away`, and `plain`. Any new
  return path must keep all five keys.
- Comments explain *why*, with the failure they prevent named concretely. Match
  the density and tone of the block you are replacing.
- `test_core.py` uses plain `def test_*` + `assert`, imports `triggers as trig`
  at line 134.
- Conventional Commits, lowercase subject, no trailing period.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused | `python -m pytest test_core.py -q -k trigger` | exit 0, all pass |
| Python tests | `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` | exit 0 |
| Timeout guard | see step 4 | completes in under 10 seconds |

## Scope

**In scope** (the only files you may modify):

- `triggers.py` — `trend_trigger` only
- `test_core.py` — new tests appended
- `docs/superpowers/plans/README.md` (your status row)

**Out of scope** (do NOT touch, even though they look related):

- `_verified_price` itself, `momentum_trigger`, `rsi_trigger`,
  `compute_triggers`. They are correct.
- `indicators.trend` — do not make it "more monotone" to dodge the problem. The
  point of this plan is that `trend_trigger` should survive a future change
  there.
- `MAX_SEARCH_PCT` (`triggers.py:32`) — the ±25% bound is a product decision
  documented in `README.md:98-101`.
- `notify._fmt_trigger` — it already handles a `reachable: False` trigger.
- The outer scan's `step = max(now * 0.001, 0.01)` and its `hi_p` bound. They
  are correct and the "smallest qualifying price" guarantee documented in
  `test_core.py:215-230` depends on them.

## Git workflow

- Branch: `advisor/07-bound-trend-trigger`
- One commit: `fix: bound the trend trigger refinement walk`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the unbounded loop is still there

```bash
grep -n "while not is_up" triggers.py
```

**Verify**: returns exactly one line, inside `trend_trigger`. If it returns
nothing, someone already fixed this — STOP and report.

### Step 2: Replace the hand-rolled walk with `_verified_price`

In `triggers.py`, inside `trend_trigger`, replace the block from
`candidate_trigger = math.ceil(price * 100) / 100` through
`trigger = round(candidate_trigger, 2)` with a call to the existing helper, and
handle its `None` return. Target shape:

```python
    step = max(now * 0.001, 0.01)
    hi_p = now * (1 + max_pct / 100.0)
    price = now
    while price <= hi_p:
        price += step
        if is_up(price):
            # `price` is a scan step, not a price a real quote could take.
            # Round UP to the nearest cent (never down -- rounding down can
            # land back below the qualifying boundary and quote a trigger that
            # would NOT flip trend) and re-verify through the real
            # indicators.trend. _verified_price does exactly that walk and,
            # unlike the hand-rolled loop this replaces, it walks on a budget:
            # this function's own docstring above refuses to assume is_up is
            # monotone in the appended price, and an unbudgeted walk assumed it
            # anyway. A non-monotone predicate would have spun here forever, on
            # the digest path, inside a scheduled job.
            trigger = _verified_price(price, now, rising=True, holds=is_up,
                                      max_pct=max_pct)
            if trigger is None:
                return {"rule": "trend", "trigger_price": None, "pct_away": None,
                        "reachable": False,
                        "plain": "no verifiable trigger price for the trend rule"}
            pct_away = round((trigger - now) / now * 100.0, 2)
            return {"rule": "trend", "trigger_price": trigger,
                    "pct_away": pct_away, "reachable": True,
                    "plain": f"trend flips up at {trigger} "
                             f"({pct_away:+.1f}% away)"}
```

Note the new "no verifiable trigger price for the trend rule" wording matches
the phrasing `momentum_trigger` (`triggers.py:108`) and `rsi_trigger`
(`triggers.py:190`) already use.

If `math` ends up unused in the module after this edit, leave the import alone —
check with `grep -n "math\." triggers.py` before deciding; `_verified_price`
still uses it.

**Verify**:

```bash
grep -c "while not is_up" triggers.py
```
→ `0`.

```bash
python -m pytest test_core.py -q -k trigger
```
→ exit 0, all existing trigger tests still pass. In particular
`test_trend_trigger_flips_down_to_up_and_no_smaller_price_does`
(`test_core.py:215`) must still pass — it asserts the returned trigger is the
**smallest** qualifying price, which is the behavior most at risk from this
change.

### Step 3: Add a regression test for the non-monotone case

The hazard cannot be reproduced with the real `indicators.trend`, which is
monotone. Simulate a non-monotone predicate by monkeypatching `ind.trend` inside
`triggers`, so the test exercises the actual code path rather than a
reimplementation.

Append to `test_core.py`:

```python
def test_trend_trigger_terminates_when_the_predicate_is_not_monotone(monkeypatch):
    """trend_trigger's docstring refuses to assume is_up is monotone in the
    appended price. Its refinement walk used to assume it anyway, with no
    budget -- a non-monotone predicate hung the digest inside a scheduled job.
    Here the stub qualifies only at a sub-cent price the cent-rounding steps
    straight past, so the walk can never succeed. It must return an unreachable
    trigger, not spin."""
    import indicators as ind_mod

    closes = [100 - i * 0.04 for i in range(60)]
    only_qualifying = None

    def fake_trend(series, short_ma, long_ma):
        nonlocal only_qualifying
        values = list(series)
        if len(values) == len(closes):
            return "down"                      # today's reading: not up yet.
        appended = float(values[-1])
        if only_qualifying is None and appended > closes[-1]:
            only_qualifying = appended         # the first scan step "works"...
        # ...but nothing else ever does, so the cent-by-cent walk that follows
        # can never confirm a real 2-decimal quote.
        return "up" if appended == only_qualifying else "down"

    monkeypatch.setattr(trig.ind, "trend", fake_trend)

    t = trig.trend_trigger(closes, 20, 50)

    assert t["rule"] == "trend"
    assert t["reachable"] is False
    assert t["trigger_price"] is None
    assert t["pct_away"] is None
    assert "no verifiable trigger price" in t["plain"]
```

`trig.ind` is `triggers.py`'s own imported alias for the `indicators` module
(`triggers.py:30`: `import indicators as ind`), so patching it there is what the
function under test actually calls.

**Verify**:

```bash
python -m pytest test_core.py -q -k not_monotone
```
→ exit 0, 1 passed, and it returns in well under a second.

Before you accept it, prove the test is not vacuous: `git stash` your
`triggers.py` change, re-run the test, and confirm it **hangs or fails**; then
`git stash pop`. If it passes against the old code, the stub is not reproducing
the hazard and the test is worthless. Use a timeout so you do not wait on a hang:

```bash
git stash push -- triggers.py
timeout 20 python -m pytest test_core.py -q -k not_monotone; echo "exit=$?"
git stash pop
```

**Verify**: the stashed run does **not** print a clean pass — expect a timeout
(exit 124) or a failure. Then confirm `git stash pop` restored your edit with
`grep -c "_verified_price(price, now" triggers.py` → `1`.

### Step 4: Confirm the digest path stays fast

The refinement walk runs per failing watchlist name. Confirm the change did not
make the common case slower:

```bash
python -c "
import time, triggers as trig
closes = [100 - i * 0.04 for i in range(60)]
t0 = time.time()
for _ in range(20):
    r = trig.trend_trigger(closes, 20, 50)
print('20 calls in %.2fs, reachable=%s, price=%s' % (time.time() - t0, r['reachable'], r['trigger_price']))
"
```

**Verify**: completes in under 10 seconds and prints `reachable=True` with a
numeric price. Record the timing.

### Step 5: Full suite

```bash
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q
git status --porcelain
```

**Verify**: pytest exits 0 with one more test than the pre-plan baseline.
`git status --porcelain` lists only `triggers.py`, `test_core.py`, and
`docs/superpowers/plans/README.md`.

## Test plan

- **New test**: `test_trend_trigger_terminates_when_the_predicate_is_not_monotone`
  in `test_core.py` — the regression this plan exists for, verified non-vacuous
  by the stash check in step 3.
- **Structural pattern**: `test_trend_trigger_unreachable_within_bound`
  (`test_core.py:239-243`) for the assertion shape;
  `test_trend_trigger_flips_down_to_up_and_no_smaller_price_does`
  (`test_core.py:215-230`) for the "smallest qualifying price" guarantee that
  must survive.
- **Existing coverage that must stay green**: all three `trend_trigger` tests at
  `test_core.py:215`, `:232`, `:239`, plus every `momentum_trigger` and
  `rsi_trigger` test — those exercise `_verified_price`, which now has a third
  caller.
- **Verification**: `python -m pytest test_core.py -q -k trigger` → exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "while not is_up" triggers.py` returns `0`
- [ ] `grep -c "_verified_price(price, now" triggers.py` returns `1`
- [ ] `python -m pytest test_core.py -q -k trigger` exits 0
- [ ] `python -m pytest test_core.py -q -k not_monotone` exits 0 with 1 passed
- [ ] The step 3 stash check confirmed the new test fails or times out against
      the old code
- [ ] `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` exits 0
- [ ] The step 4 timing command completes under 10 seconds with `reachable=True`
- [ ] `git status --porcelain` lists no file outside the in-scope list, and no
      leftover stash entry (`git stash list` is unchanged from before you started)
- [ ] `docs/superpowers/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 finds no `while not is_up` — already fixed.
- `test_trend_trigger_flips_down_to_up_and_no_smaller_price_does` fails after
  your change. That means the returned trigger is no longer the smallest
  qualifying price, which is a real behavior regression — the digest would quote
  a price further away than necessary. Report it; do not weaken the test.
- The step 3 stash check shows the new test **passing** against the old code.
  The stub is not reproducing the hazard; report the stub you tried.
- Step 4 takes noticeably longer than the pre-change timing. `_verified_price`
  should be equivalent work; a large slowdown means the walk is starting from
  the wrong place.
- You are tempted to add a bound by inventing a new constant instead of reusing
  `_verified_price`. Reuse is the point.

## Maintenance notes

- **The invariant**: every cent-by-cent walk in `triggers.py` goes through
  `_verified_price`. After this plan all three trigger functions do. If a fourth
  rule is ever added to `analyze.buy_decision`, its trigger function must too.
- **What a reviewer should scrutinize**: that the new `None` branch returns all
  five dict keys (`rule`, `trigger_price`, `pct_away`, `reachable`, `plain`).
  `notify._fmt_trigger` (`notify.py:85-95`) calls `min(reachable, key=lambda t: abs(t["pct_away"]))`
  and would raise on a missing key.
- **Why the outer scan stays a scan**: `trend` depends on two rolling means, so
  it has no closed-form inverse — `triggers.py:203-215` explains this and
  `README.md:92-94` documents it for the user. Do not replace the forward scan
  with bisection: bisection finds *a* qualifying price, the forward scan finds
  the *smallest* one, and `test_core.py:215-230` asserts the difference.
- **Related, deliberately deferred**: the outer scan does up to ~250
  `pd.concat` + `ind.trend` evaluations per failing name. That is a real cost on
  the digest path but a performance question, not a correctness one, and it
  needs a measurement before anyone optimizes it.
