# Plan 005: Make the holiday-gate test deterministic instead of clock-dependent

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7bb9fdb..HEAD -- test_core.py session_gate.py`
> If either file changed, compare the "Current state" excerpt against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `7bb9fdb` (origin/main), 2026-08-31

## Why this matters

`test_the_gate_reads_the_recorded_holiday_list` passes or fails depending on
what time of day it runs. This was observed directly, on identical code: it
**failed** during one run and **passed** on the same commit a short time later.

The test's intent is to prove that `session_gate.gate_reason` actually consults
the holiday list — the wiring `market_holidays.json` depends on. But it never
pins the clock, so what it really asserts is "`gate_reason('digest')` returns
*some* reason right now", which is true for unrelated reasons most of the day
(weekend, outside the pre-open window) and false during the 07:00–10:00 Riyadh
pre-open window on a trading day.

Two costs. First, CI is red during exactly the hours this system operates —
which is when someone is most likely to be pushing a fix. Second, and worse, the
test does not test what it claims: it passes almost all the time *without the
holiday argument having any effect*, so if the holiday wiring broke, this test
would very likely still be green.

## Current state

`test_core.py:3266-3272` as it exists today:

```python
def test_the_gate_reads_the_recorded_holiday_list():
    """market_holidays.json is the file an operator edits before Eid."""
    holidays = json.loads(Path("market_holidays.json").read_text(encoding="utf-8"))
    assert "closed" in holidays and isinstance(holidays["closed"], list)
    # Empty today, so the gate changes nothing until dates are added -- but the
    # wiring must exist first, or adding them would change nothing either.
    assert session_gate.gate_reason("digest", holidays={"2026-08-21"}) is not None
```

The bug: `2026-08-21` is a fixed past date, and `now` is not passed, so
`gate_reason` evaluates against *today*. The holiday set only bites when today
happens to be 2026-08-21 — i.e. it bit on the day the test was written and never
again.

`session_gate.py:61-64` — note `now` is an accepted parameter, already used by
other tests:

```python
def gate_reason(mode: str, now: datetime | None = None, holidays: set[str] | None = None) -> str | None:
    """Why this mode must not run now, or None when it may proceed."""
    local = riyadh_now(now)
    if not is_trading_day(now, holidays):
```

### Convention to follow

Other gate tests in this file already pin the clock with an explicit tz-aware
UTC datetime — see `test_core.py:3252-3260`:

```python
    scheduled = datetime(2026, 8, 20, 6, 45, tzinfo=timezone.utc)
    delayed_start = datetime(2026, 8, 20, 7, 26, tzinfo=timezone.utc)
```

`datetime` and `timezone` are already imported in `test_core.py`. Match this
style: build the moment explicitly, never rely on `datetime.now()`.

Riyadh is UTC+3. A UTC time of 06:00 is 09:00 Riyadh — inside the pre-open
window (07:00–10:00 Riyadh), which is the *hardest* case: the moment when the
digest would otherwise be allowed to run. That is precisely the moment at which
a holiday must still block it, so it is the moment worth testing.

2026-08-20 is a Thursday (a Tadawul trading day; Tadawul trades Sun–Thu).

## Commands you will need

| Purpose        | Command                                                    | Expected on success |
|----------------|------------------------------------------------------------|---------------------|
| This test      | `python -m pytest test_core.py -q -k holiday`               | all pass            |
| Full Python CI | `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` | 0 failures |

## Scope

**In scope** (the only file you should modify):
- `test_core.py` — rewrite the single test named
  `test_the_gate_reads_the_recorded_holiday_list`, and add one companion test.

**Out of scope** (do NOT touch):
- `session_gate.py` — the production logic is correct. This is a test defect,
  not a gate defect. Do not change `gate_reason`, `is_trading_day`, or the
  window constants.
- `market_holidays.json` — do not add dates to make the test pass. That would
  change live trading behaviour to satisfy a test.
- Any other test.

## Git workflow

- Branch: `advisor/005-deterministic-holiday-gate-test`
- Commit message style — match the repo log (`fix: distinguish current and
  historical alerts (#9)`). Suggested:
  `test: pin the clock in the holiday-gate test so it stops flapping`
- Do NOT push or open a PR.

## Steps

### Step 1: Replace the test with a clock-pinned version

Replace the whole of `test_the_gate_reads_the_recorded_holiday_list` with:

```python
def test_the_gate_reads_the_recorded_holiday_list():
    """market_holidays.json is the file an operator edits before Eid.

    The clock is pinned deliberately. This test used to call gate_reason with a
    fixed past holiday date and no `now`, so it evaluated against whatever day
    the suite happened to run -- which meant it passed for unrelated reasons
    (weekend, outside the pre-open window) almost always, and failed during the
    07:00-10:00 Riyadh pre-open window. It was observed both passing and failing
    on the same commit. Pinning `now` is what makes it assert the holiday wiring
    rather than the wall clock.
    """
    holidays = json.loads(Path("market_holidays.json").read_text(encoding="utf-8"))
    assert "closed" in holidays and isinstance(holidays["closed"], list)
    # 06:00 UTC = 09:00 Riyadh on a Thursday: a trading day, inside the pre-open
    # window, so the digest would be allowed to run if nothing blocked it. That
    # is the only moment at which the holiday list is load-bearing.
    open_moment = datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc)
    assert session_gate.gate_reason("digest", now=open_moment, holidays=set()) is None
    assert session_gate.gate_reason(
        "digest", now=open_moment, holidays={"2026-08-20"}) is not None
```

The two assertions together are the point: the same moment is allowed with an
empty holiday set and blocked with that date recorded. Only the holiday argument
changed, so only the holiday wiring can explain the difference.

**Verify**: `python -m pytest test_core.py -q -k holiday` → all pass.

### Step 2: Prove it is genuinely time-independent

Run the test with the machine clock irrelevant by running it repeatedly; then
confirm by reading that no assertion in it depends on `date.today()` or
`datetime.now()`.

**Verify**: `python -m pytest test_core.py -q -k holiday --count=3` if
`pytest-repeat` is available; if it is not (likely — it is not in
`requirements.txt`), skip the flag and instead run the single-shot command three
times in a row. All runs must pass.

**Verify**: `grep -n "gate_reason" test_core.py` → every call in the
holiday test passes an explicit `now=`.

### Step 3: Full suite

**Verify**: `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q`
→ **0 failures**. (Before this plan, this suite had exactly one failure, this
test, and only at certain times of day. After it, there must be none at any
time.)

## Test plan

- The rewritten `test_the_gate_reads_the_recorded_holiday_list`, now asserting a
  before/after pair at one pinned moment.
- No new file. Structural pattern: `test_core.py:3252-3260`.

## Done criteria

ALL must hold:

- [ ] `python -m pytest test_core.py -q -k holiday` → all pass, run 3 times in a row
- [ ] `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` → 0 failures
- [ ] `grep -n "holidays={\"2026-08-21\"}" test_core.py` → no matches (the old fixed-date call is gone)
- [ ] `git diff --stat -- session_gate.py market_holidays.json` → empty
- [ ] `git status --porcelain` shows only `test_core.py` modified

## STOP conditions

Stop and report back if:

- `test_core.py:3266-3272` does not match the excerpt above.
- The rewritten test fails. That would mean `gate_reason` does **not** block on a
  recorded holiday during the pre-open window — a real production bug in the
  trading gate, far more serious than the flaky test. Report the exact observed
  return value; do not edit `session_gate.py` to make the test pass.
- 2026-08-20 turns out not to be a trading weekday under
  `session_gate.TRADING_WEEKDAYS` (Sun–Thu, i.e. Python weekday 6,0,1,2,3). Check
  it; if wrong, report rather than guessing another date.
- The full suite still has failures after your change. Name them.

## Maintenance notes

- The general rule this fixes: any test touching `session_gate` must pass an
  explicit `now=`. There is at least one other clock-reading call site worth
  auditing later (`main.mode_digest_guard` calls
  `session_gate.is_pre_open_window()` with no argument) — out of scope here, but
  a reviewer should watch for the same pattern spreading.
- A reviewer should confirm the test still fails if `is_trading_day`'s holiday
  check is removed — that is the mutation this test exists to catch.
