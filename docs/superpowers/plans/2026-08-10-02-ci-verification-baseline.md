# Plan 02: Give the TypeScript half of the repo a CI verification gate

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `docs/superpowers/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 6ada068..HEAD -- .github/workflows/ package.json`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `2026-08-10-01-land-honest-cockpit-repair.md` — **hard
  dependency, see below**
- **Category**: tests
- **Planned at**: commit `6ada068`, 2026-08-10

## Why this matters

Half of this repository has never been verified by CI. The only workflow runs
`pytest` on two Python files. `test_cockpit.py` is never executed. `npm run lint`
and `npm test` are never executed at all. That covers the Next.js app: every API
route, both D1 stores, the snapshot validator, and the React component.

This is not hypothetical. Both JS checks are **red on `main` right now** and
have been since they broke, because nothing looks at them:

- `npm run lint` → exit 1, one error, `react-hooks/rules-of-hooks` at
  `app/components/ActionCockpit.tsx:21`. ESLint already knows about the hook
  bug that crashes the cockpit page. CI just never asked.
- `npm test` → exit 1, 10 pass / 2 fail in `tests/action-cockpit.test.mjs`.

Every other plan in this batch states its done criteria in terms of these
commands. Until they run automatically, "green" is a thing someone has to
remember to check by hand.

## Dependency: this plan MUST land after plan 01

`main` is currently an ancestor of the branch `codex/fix-honest-daily-cockpit`,
so that branch merges as a clean fast-forward. This plan modifies
`.github/workflows/tasi.yml`, which that branch also modifies. Landing this
first destroys the fast-forward and turns a trivial merge into a conflicting
one.

There is a second reason: plan 01 is what makes the JS suite green. If you add
these gates to CI while `main` is still red, every subsequent push fails CI on a
pre-existing defect that is not yours.

**Before starting, confirm plan 01 has landed:**

```bash
git log --oneline -1 --format=%s $(git rev-list -1 HEAD -- app/lib/dashboard-access.ts) 2>/dev/null || echo "NOT LANDED"
```

**Verify**: prints a commit subject, not `NOT LANDED`. `app/lib/dashboard-access.ts`
is a file that exists only on the repair branch. If it prints `NOT LANDED`, STOP.

## Current state

### The only workflow

`.github/workflows/tasi.yml` — this is the entire CI surface. Lines 26-57:

```yaml
jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
          cache: pip

      - run: pip install -r requirements.txt

      - name: Run tests
        run: python -m pytest test_core.py research/test_base_rate.py -v

      - name: Pick mode
        id: mode
        run: |
          ...
      - name: Run
        env:
          MODE: ${{ steps.mode.outputs.mode }}
          SAHMK_API_KEY: ${{ secrets.SAHMK_API_KEY }}
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
        run: python main.py
```

Two things to understand about this job before changing it:

1. **It is a scheduled production job, not a CI job.** Lines 12-16 fire it at
   06:45 UTC plus every 15 minutes from 07:00–11:59 UTC, Sunday–Thursday. That
   is roughly 21 runs per trading day. The `Run tests` step is a **safety gate**:
   it refuses to send real Discord alerts from a broken engine.
2. **It has no `push` or `pull_request` trigger at all.** Nothing runs when you
   commit. Lines 5-16 are `workflow_dispatch` + `schedule` only.

So the fix is not "add npm to this job". Adding a Node install and a Vite build
to a job that fires 21 times a day would burn minutes for no benefit — `python
main.py` does not execute a single line of TypeScript. The fix is a **second,
separate workflow** on push and pull request.

### Why `[skip ci]` matters here

`.github/workflows/tasi.yml:76` commits state back with:

```yaml
          git commit -m "state update [skip ci]" 2>/dev/null || echo "nothing to commit"
```

GitHub honors `[skip ci]` in the commit subject, so the ~21 daily state commits
will **not** trigger the new push-triggered workflow. Do not remove or alter
that marker.

### The npm scripts

`package.json:8-14`:

```json
  "scripts": {
    "dev": "vinext dev",
    "build": "vinext build",
    "start": "vinext start",
    "test": "npm run build && node --test tests/*.test.mjs",
    "lint": "eslint . --ignore-pattern dist --ignore-pattern .next --ignore-pattern .worktrees"
  },
```

`npm test` runs a full production build first. This is required, not incidental:
`tests/action-cockpit.test.mjs:6` imports `../dist/server/index.js`. Locally the
whole thing takes about 30 seconds.

`package.json:5-7` pins the runtime:

```json
  "engines": {
    "node": ">=22.13.0"
  },
```

### There is no typecheck script

`tsconfig.json` sets `"strict": true` and `"noEmit": true`, but nothing invokes
`tsc`. Adding one is **out of scope for this plan** — see the removed step 2; it
is plan 09. Note `tsconfig.json`
also sets `"incremental": true`, which makes `tsc` write a `.tsbuildinfo` file —
add `--incremental false` to the script so CI does not produce a stray artifact.

### Repo conventions

- Conventional Commits, lowercase subject, no trailing period. Recent examples
  from `git log`: `fix: harden digest delivery data`,
  `feat: sync daily digest to cockpit`, `chore: ignore local worktrees`.
- Workflow YAML in this repo uses two-space indentation and explains non-obvious
  scheduling or ordering choices in a `#` comment above the block — see
  `.github/workflows/tasi.yml:3-4` and `:13-16`. Match that: comment *why*, not
  *what*.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Python tests (full) | `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` | exit 0, all pass |
| Lint | `npm run lint` | exit 0, no errors |
| JS build + tests | `npm test` | exit 0, all pass |
| Workflow YAML parses | `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml',encoding='utf-8')); print('ok')"` | prints `ok` |

`pyyaml` may not be installed. If the last command fails with `ModuleNotFoundError`,
use `python -c "import json,sys; print('skip')"` and instead verify the YAML by
confirming GitHub accepts it — record that you could not parse it locally.

## Scope

**In scope** (the only files you may modify or create):

- `.github/workflows/ci.yml` (create)
- `.github/workflows/tasi.yml` (modify — one line, step 3 only)
- `package.json` (modify — add one script)
- `docs/superpowers/plans/README.md` (your status row)

**Out of scope** (do NOT touch, even though they look related):

- Any test file. If a test fails, that is a STOP condition, not an invitation to
  edit the test. The whole point of this plan is that the gate reports truth.
- Any source file under `app/`, `worker/`, `db/`, or any `.py` file.
- The `schedule:` and `workflow_dispatch:` blocks in `tasi.yml` — the trading
  schedule is not yours to change.
- The `[skip ci]` marker at `.github/workflows/tasi.yml:76`.
- `eslint.config.mjs` — do not widen the ignore list to make a *real* lint error
  pass. The one narrowly-scoped exception is step 2b below, which excludes a
  directory that contains no first-party source at all.

## Git workflow

- Branch: `advisor/02-ci-verification-baseline`
- One commit, message: `ci: verify typescript and cockpit tests on push`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the baseline is green before you add a gate

```bash
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q
npm run lint
npm test
```

**Verify**: all three exit 0.

If any is red, plan 01 has not fully landed. STOP and report which command
failed and its output. Do not proceed — adding CI on top of a red tree produces
a workflow that fails on its first run for reasons that are not yours.

### Step 2: (REMOVED — moved to plan 09)

**Revised 2026-08-10 after an executor correctly stopped here.**

This step used to say "add a `typecheck` script, and STOP if it reports errors."
An executor did exactly that, added the script, ran it, and hit four
pre-existing type errors. It stopped, as instructed, having completed nothing
else.

That was the executor behaving correctly and **the plan being wrong**. The plan
author asserted the repo would typecheck clean without ever running `tsc` — the
repo has no typecheck script, so nothing had ever type-checked it. Bundling an
unknown-outcome cleanup into the CI-gate plan made the whole gate hostage to it.

The four errors, reproduced on `55cde02` with
`node ./node_modules/typescript/bin/tsc --noEmit --incremental false`:

```
app/api/research/report/route.ts(9,66): error TS2345: ... Type 'string' is not assignable to type '"delayed-daily"'.
app/components/ActionCockpit.tsx(50,66): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
worker/index.ts(9,11):  error TS2304: Cannot find name 'Fetcher'.
worker/index.ts(20,48): error TS2304: Cannot find name 'ExecutionContext'.
```

None is a runtime bug — `npm run build`, `npm test` (16/0), and pytest (200) are
all green at that commit. Three are missing type-library configuration; one is a
real type-narrowing gap.

**Adding the `typecheck` script and fixing those four is now plan 09.** Do not
do it here. This plan ships the CI gate for lint, build, and both test suites —
all three of which are already green and therefore gateable today. When plan 09
lands, add a `Typecheck` step to `ci.yml`'s `web` job; that is called out in
plan 09's own steps.

Skip straight to step 2b.

### Step 2b: Make `npm run lint` ignore agent worktrees too

**Added 2026-08-10 after a real failure.** The lint script excludes
`.worktrees`, but agent tooling creates isolated worktrees under
**`.claude/worktrees/`**, which is not excluded. Each one holds a full copy of
the repo — including older `app/components/ActionCockpit.tsx` revisions and
built `dist/` bundles. Measured on the merged tree: `npm run lint` exited 1 with
9 error files, **every one of them** under `.claude/worktrees/agent-*`, and zero
in first-party source. Adding `--ignore-pattern .claude` took it to exit 0.

This does not matter in CI (a fresh checkout has no `.claude/worktrees`), but it
makes the command unusable locally — which is exactly when a developer would run
it. A gate nobody can run locally is a gate that gets ignored.

In `package.json`, extend the `lint` script:

```json
    "lint": "eslint . --ignore-pattern dist --ignore-pattern .next --ignore-pattern .worktrees --ignore-pattern .claude"
```

**Verify**:

```bash
npm run lint; echo "lint exit=$?"
```
→ `lint exit=0`.

```bash
node ./node_modules/eslint/bin/eslint.js app worker db --format unix | tail -3
```
→ no errors in first-party source, confirming you suppressed a directory of
copies rather than a real finding.

Note `tests/action-cockpit.test.mjs` already asserts the lint script keeps
`--ignore-pattern .worktrees`. Consider extending that assertion to `.claude` in
the same edit so the two ignores stay together; if you do, that is the only test
file you may touch in this plan.

### Step 3: Add `test_cockpit.py` to the production safety gate

In `.github/workflows/tasi.yml`, change the `Run tests` step (line 38-39) from:

```yaml
      - name: Run tests
        run: python -m pytest test_core.py research/test_base_rate.py -v
```

to:

```yaml
      - name: Run tests
        run: python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -v
```

This is the only change to this file. `test_cockpit.py` is pure-Python and
offline, so it adds no meaningful time to the 21 daily runs.

**Verify**:

```bash
git diff --stat .github/workflows/tasi.yml
```
→ exactly `1 insertion(+), 1 deletion(-)`.

### Step 4: Create the push/PR workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

# Separate from tasi.yml on purpose. tasi.yml is the scheduled trading job and
# fires ~21 times a trading day; a Node install and a Vite build there would
# cost minutes per run for code `python main.py` never executes. This workflow
# runs on code changes instead. The scheduled job's own state commits carry
# "[skip ci]", so they do not trigger it.
on:
  push:
    branches: ["**"]
  pull_request:
  workflow_dispatch:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt
      - name: Tests
        run: python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q

  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          # package.json declares engines.node ">=22.13.0". A range, not an
          # exact pin: pinning 22.13.0 here would freeze CI on the oldest
          # supported release forever.
          node-version: "22.x"
          cache: npm
      - run: npm ci
      - name: Lint
        run: npm run lint
      # `npm test` runs `npm run build` first: tests/action-cockpit.test.mjs
      # imports ../dist/server/index.js, so the build is a prerequisite, not
      # a duplicate step.
      - name: Build and test
        run: npm test
```

**Verify**:

```bash
python -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml',encoding='utf-8')); print(sorted(d['jobs']))"
```
→ prints `['python', 'web']`.

(If `pyyaml` is unavailable, skip this and note it.)

### Step 5: Re-run everything locally exactly as CI will

```bash
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q
npm run lint
npm test
```

**Verify**: all four exit 0.

### Step 6: Confirm nothing outside scope changed

```bash
git status --porcelain
```

**Verify**: lists only `.github/workflows/ci.yml`, `.github/workflows/tasi.yml`,
`package.json`, and `docs/superpowers/plans/README.md`.

`package-lock.json` must **not** appear. If it does, you ran `npm install`
instead of leaving the lockfile alone — revert it with
`git checkout -- package-lock.json`.

## Test plan

No new unit tests. The deliverable is the gate itself, and its test is that the
four commands in step 5 pass locally under the same versions CI pins.

One existing test is worth knowing about: `tests/action-cockpit.test.mjs:41-45`
already asserts that `package.json`'s lint script keeps `--ignore-pattern
.worktrees`. If you alter the lint script, that test fails and tells you so.
Do not alter it.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/ci.yml` exists and defines jobs `python` and `web`
- [ ] `grep -c "test_cockpit.py" .github/workflows/tasi.yml` returns `1`
- [ ] `grep -c "skip ci" .github/workflows/tasi.yml` returns `1` (still there)
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0
- [ ] `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` exits 0
- [ ] `git status --porcelain` lists no file outside the in-scope list, and does
      not list `package-lock.json`
- [ ] `docs/superpowers/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The pre-flight check in "Dependency" prints `NOT LANDED`.
- Step 1 finds any command red. Report which, with output.
- You are tempted to add a `typecheck` script or a `Typecheck` CI step. That is
  plan 09, and this plan was revised specifically to stop blocking on it.
- You are tempted to edit a test, widen an ignore pattern, add
  `continue-on-error`, or otherwise make a check pass by making it weaker. The
  gate exists to report truth.
- `npm ci` fails because `package-lock.json` and `package.json` disagree. That
  is a real problem worth its own report, not something to paper over with
  `npm install`.

## Maintenance notes

- **Two workflows now, with different jobs.** `tasi.yml` is production and runs
  on a schedule; `ci.yml` is verification and runs on code changes. When adding
  a check, ask which one it belongs in. Anything that does not gate the safety
  of a real Discord alert belongs in `ci.yml`.
- Plan 06 bumps `next` and `eslint-config-next` to `16.2.11`. That changes
  `package-lock.json`, so `npm ci` in the `web` job is what will catch a
  lockfile/manifest mismatch. That is the intended interaction.
- The `web` job uses `node-version: "22.x"`, which satisfies `engines.node`
  (`>=22.13.0`) while still picking up newer 22 releases. If the floor in
  `package.json` ever crosses into 23, change this too — nothing warns you.
- A reviewer should check that `ci.yml` has `permissions: contents: read` and no
  secrets. It runs on pull requests and must never be able to write state or
  reach the Discord webhook.
- Deliberately deferred: no coverage reporting, no matrix across Node versions,
  no caching beyond `setup-node`'s built-in npm cache. Get the gate green and
  boring first.
