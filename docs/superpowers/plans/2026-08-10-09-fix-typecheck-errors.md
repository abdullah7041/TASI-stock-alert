# Plan 09: Make `tsc` pass, then add a `typecheck` script

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `docs/superpowers/plans/README.md` — unless a reviewer dispatched you and told
> you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 55cde02..HEAD -- app/ worker/ tsconfig.json package.json`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 01 has landed; this works on merged `main`)
- **Category**: dx
- **Planned at**: commit `55cde02`, 2026-08-10

## Why this matters

`tsconfig.json` sets `"strict": true`. Nothing has ever run `tsc`. There is no
`typecheck` script, and no workflow invokes one — so "strict mode" has been
decorative for the life of the project.

Running it for the first time surfaces four errors. This plan exists because
plan 02 tried to add the script as a one-line side task, discovered the errors,
and correctly stopped — leaving the whole CI gate blocked on an unrelated
cleanup. Splitting it out unblocks that gate and gives this work the space it
actually needs.

Nothing here is a runtime bug. At `55cde02`, `npm run build`, `npm test` (16/0),
and `pytest` (200) are all green. Three of the four errors are missing type
declarations; one is a genuine type-narrowing gap that currently lets a
mistyped snapshot reach a money-spending route unchallenged.

## Current state

Reproduce first — do not take this list on trust:

```bash
node ./node_modules/typescript/bin/tsc --noEmit --incremental false
```

At `55cde02` this prints exactly four errors:

```
app/api/research/report/route.ts(9,66): error TS2345: Argument of type '{ schemaVersion: number; ... dataStatus: string; ... }' is not assignable to parameter of type '{ asOf: string; dataStatus: "delayed-daily"; }'.
  Types of property 'dataStatus' are incompatible.
    Type 'string' is not assignable to type '"delayed-daily"'.
app/components/ActionCockpit.tsx(50,66): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
worker/index.ts(9,11):  error TS2304: Cannot find name 'Fetcher'.
worker/index.ts(20,48): error TS2304: Cannot find name 'ExecutionContext'.
```

Invoke `tsc` through `node ./node_modules/typescript/bin/tsc` rather than `npx`
— this environment wraps tooling in a proxy that can swallow stdout, and you
need to read the actual error list.

### Error 1 — the real one: an untyped `.mjs` boundary

`app/api/research/report/route.ts:1-10`:

```typescript
import { loadCurrentResearchCandidate } from "@/app/lib/dashboard-access";
import { createOrReuseReport, getPrivateResearchContext } from "@/app/lib/research-agent";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { symbol?: string };
    const context = await getPrivateResearchContext(request);
    const { candidate, snapshot } = await loadCurrentResearchCandidate(body.symbol ?? "");
    const result = await createOrReuseReport(context, candidate, snapshot);
```

`app/lib/research-agent.ts:72` requires the literal type:

```typescript
export async function createOrReuseReport(context: PrivateResearchContext, candidate: Candidate, snapshot: { asOf: string; dataStatus: "delayed-daily" }) {
```

The `snapshot` flows from `DashboardStore.latest()`, which returns
`parseDashboardSnapshot(JSON.parse(...))`. That function lives in
**`app/lib/dashboard-core.mjs`** — plain JavaScript with no type declarations —
so TypeScript infers `dataStatus: string` and the literal check fails.

Meanwhile `app/lib/dashboard-types.ts` already declares the correct shape and is
not connected to the validator at all:

```typescript
export type DashboardSnapshot = {
  schemaVersion: 1;
  tradeDate: string;
  asOf: string;
  regime: string;
  dataStatus: "delayed-daily";
  warnings: string[];
  urgent: Array<{ code: string; name: string; action: string; price: number; reason: string; pnlPct: number }>;
  changed: Array<{ code: string; name: string; status: string; reason: string }>;
  qualified: Candidate[];
  researchCount: number;
  monthlyBudgetSar: number;
};

export type DashboardPayload = { snapshot: DashboardSnapshot; freshness: "current" | "stale" };
```

So the fix is not a cast. It is to **declare the types the `.mjs` module
actually produces**, which makes `dashboard-types.ts` load-bearing instead of
decorative. That is the whole value of this error: the validator is the trust
boundary for a route that spends money against an OpenAI budget, and right now
its output is `any`-adjacent to the compiler.

### Errors 2–4 — missing ambient declarations

`app/components/ActionCockpit.tsx:50`:

```tsx
  const researchEnabled = freshness === "current" && import.meta.env.VITE_AGENT_ENABLED !== "false";
```

`import.meta.env` is Vite's, and `vite/client` types are not referenced anywhere.

`worker/index.ts:7-20` uses two Cloudflare Workers globals:

```typescript
interface Env {
  ASSETS: Fetcher;
  ...
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
```

**`@cloudflare/workers-types` is NOT installed.** `ls node_modules/@cloudflare/`
shows only `kv-asset-handler`, `unenv-preset`, `vite-plugin`, and
`workerd-windows-64`.

### The convention this repo already follows

Do **not** add `@cloudflare/workers-types` as a dependency. This repo already
hand-declares the Cloudflare surface it uses, in
`app/lib/cloudflare-env.d.ts`:

```typescript
declare module "cloudflare:workers" {
  export interface D1Result {
    success: boolean;
    meta: { changes?: number };
    results?: unknown[];
  }

  export interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    run(): Promise<D1Result>;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
  }

  export interface D1Database { ... }

  export const env: { DB?: D1Database; OPENAI_API_KEY?: string; ... };
}
```

Minimal, hand-written, exactly the surface in use. Match it. Pulling a large
ambient type package would contradict a deliberate choice and change how every
existing `D1Database` reference resolves.

### Repo conventions

- Conventional Commits, lowercase subject, no trailing period.
- `tsconfig.json` has `"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"]`
  and `"paths": { "@/*": ["./*"] }`. New `.d.ts` files under `app/lib/` are
  picked up automatically.
- Note `"allowJs": true` but **`**/*.mjs` is not in `include`** — `.mjs` modules
  are pulled in only via import, which is why `dashboard-core.mjs` contributes no
  types today.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `node ./node_modules/typescript/bin/tsc --noEmit --incremental false` | exit 0, no output |
| Build | `npm run build` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| JS tests | `npm test` | exit 0, 16 pass / 0 fail |
| Python tests | `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` | exit 0, 200 passed |

If `node_modules` is absent (fresh worktree), run `npm ci` first, in the
foreground, with a timeout of at least 10 minutes.

## Scope

**In scope**:

- `app/lib/dashboard-core.d.ts` (create) — type declarations for the `.mjs` validator
- `app/lib/cloudflare-env.d.ts` (modify) — add `Fetcher` and `ExecutionContext`
- `app/lib/vite-env.d.ts` (create) — Vite client types reference
- `package.json` (modify) — add the `typecheck` script, last
- `docs/superpowers/plans/README.md` (your status row)

**Out of scope** (do NOT touch, even though they look related):

- `app/lib/dashboard-core.mjs` — do not convert it to TypeScript and do not
  change a line of its logic. It is covered by `tests/dashboard-core.test.mjs`
  and is imported by both the app and, indirectly, the ingest path. You are
  describing it to the compiler, not rewriting it.
- `app/api/research/report/route.ts`, `app/lib/research-agent.ts`,
  `app/lib/dashboard-access.ts`, `app/components/ActionCockpit.tsx`,
  `worker/index.ts` — if the declarations are right, **no `.ts`/`.tsx` source
  needs to change**. Needing to edit one is a STOP condition.
- `tsconfig.json` — do not weaken `strict`, do not add `skipLibCheck` bypasses,
  do not exclude files. Silencing an error by loosening config defeats the plan.
- Any `as` cast, `any`, `@ts-ignore`, or `@ts-expect-error` to make an error go
  away. All four errors have a real declaration-level fix.
- `.github/workflows/` — wiring typecheck into CI is plan 02's job; see the
  handoff note in step 5.
- Adding `@cloudflare/workers-types` or any new dependency.

## Git workflow

- Branch: `advisor/09-fix-typecheck-errors`
- One commit: `fix: make the codebase typecheck under strict mode`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Reproduce, and record the exact baseline

```bash
node ./node_modules/typescript/bin/tsc --noEmit --incremental false 2>&1 | tee /tmp/tsc-before.txt
node ./node_modules/typescript/bin/tsc --noEmit --incremental false 2>&1 | grep -c "error TS"
```

**Verify**: exactly `4`, and the four match the "Current state" list by file,
line, and error code. If the count differs, the tree has drifted — STOP and
report the actual list.

Also confirm everything else is green before you start, so a later failure is
attributable:

```bash
npm run build >/dev/null 2>&1; echo "build exit=$?"
npm run lint >/dev/null 2>&1; echo "lint exit=$?"
npm test >/dev/null 2>&1; echo "test exit=$?"
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q 2>&1 | tail -1
```

**Verify**: build 0, lint 0, test 0, pytest 200 passed. If any is red, STOP.

### Step 2: Declare the Cloudflare globals `worker/index.ts` uses

Append to `app/lib/cloudflare-env.d.ts`, matching the file's existing
minimal-surface style:

```typescript
// Cloudflare Workers runtime globals used by worker/index.ts. Declared by hand,
// deliberately: this repo describes only the surface it actually uses rather
// than depending on @cloudflare/workers-types, the same choice the
// "cloudflare:workers" module declaration above makes.
declare global {
  interface Fetcher {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  }

  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }
}

export {};
```

The `export {}` is required to keep the file a module so `declare global`
is legal. The existing `declare module "cloudflare:workers"` block already makes
it a module, so confirm whether a second `export {}` is needed — add it only if
`tsc` complains that augmentations of the global scope are only allowed in
modules.

`waitUntil` / `passThroughOnException` are the two members actually used —
`tests/action-cockpit.test.mjs` passes `{ waitUntil() {}, passThroughOnException() {} }`
as the third argument to `worker.fetch`, which is your evidence for the shape.

**Verify**:

```bash
node ./node_modules/typescript/bin/tsc --noEmit --incremental false 2>&1 | grep -c "error TS"
```
→ `2`. The two `worker/index.ts` errors are gone; the other two remain.

### Step 3: Reference Vite's client types

Create `app/lib/vite-env.d.ts`:

```typescript
/// <reference types="vite/client" />
```

That is the whole file. `vite` is already a devDependency, so the types resolve
without a new install.

**Verify**:

```bash
node ./node_modules/typescript/bin/tsc --noEmit --incremental false 2>&1 | grep -c "error TS"
```
→ `1`. Only the `report/route.ts` error remains.

If `vite/client` does not resolve, do **not** fall back to declaring
`ImportMeta` by hand without reporting it — say so in your report, then declare
the minimal shape:

```typescript
interface ImportMetaEnv { readonly VITE_AGENT_ENABLED?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
```

### Step 4: Type the `.mjs` validator so the literal survives

Create `app/lib/dashboard-core.d.ts`:

```typescript
// Type declarations for dashboard-core.mjs, which is plain JavaScript. Without
// these, parseDashboardSnapshot's return type is inferred structurally and
// dataStatus widens to `string`, so the "delayed-daily" literal that
// research-agent.createOrReuseReport requires is lost at the boundary — the one
// place the app decides whether a snapshot may be researched against a paid
// OpenAI budget. Reuses DashboardSnapshot from dashboard-types.ts rather than
// restating the shape, so the two cannot drift.
import type { DashboardSnapshot } from "@/app/lib/dashboard-types";

export function parseDashboardSnapshot(value: unknown): DashboardSnapshot;
export function dashboardFreshness(snapshot: DashboardSnapshot): "current" | "stale";
```

Before writing it, **open `app/lib/dashboard-core.mjs` and confirm the exported
function names and their real return values**. The two above are what
`app/lib/dashboard-store.ts` and `app/lib/dashboard-access.ts` import; if the
module exports more, declare those too, and if `dashboardFreshness` returns
something other than `"current" | "stale"`, declare what it actually returns —
`app/lib/dashboard-types.ts` has a `DashboardPayload` type whose `freshness`
field is the reference.

**Verify**:

```bash
node ./node_modules/typescript/bin/tsc --noEmit --incremental false; echo "tsc exit=$?"
```
→ `tsc exit=0`, no output.

If a *new* error appears — for instance because the declared return type is
stricter than what `parseDashboardSnapshot` really guarantees — that is a real
finding about the validator, not a reason to loosen the declaration. Report it
and STOP.

### Step 5: Add the `typecheck` script

In `package.json`, add one entry to `"scripts"`, after `"test"`:

```json
    "typecheck": "tsc --noEmit --incremental false",
```

`--incremental false` matters: `tsconfig.json` sets `"incremental": true`, which
would otherwise write a stray `.tsbuildinfo`.

**Verify**:

```bash
npm run typecheck; echo "typecheck exit=$?"
git status --porcelain
```
→ `typecheck exit=0`, and `git status` shows no `.tsbuildinfo`.

**Handoff note for plan 02**: once this lands, `ci.yml`'s `web` job should gain

```yaml
      - name: Typecheck
        run: npm run typecheck
```

between its `Lint` and `Build and test` steps. Do not edit `.github/` here —
just say so in your report so the reviewer can sequence it.

### Step 6: Prove nothing else moved

```bash
npm run build >/dev/null 2>&1; echo "build exit=$?"
npm run lint >/dev/null 2>&1; echo "lint exit=$?"
npm test 2>&1 | grep -cE "^✔"; echo "test exit=${PIPESTATUS[0]}"
python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q 2>&1 | tail -1
git status --porcelain
```

**Verify**: build 0, lint 0, 16 passing JS tests with exit 0, pytest 200 passed.
`git status --porcelain` lists only the in-scope files — no `dashboard.json`
(revert it if pytest dirtied it), no `.tsbuildinfo`, no `/tmp` artifacts.

## Test plan

**No new unit tests.** Type declarations are verified by the compiler; a runtime
test cannot assert them, and a test that tried would assert nothing meaningful.
`tsc --noEmit` exiting 0 **is** the test, and step 5 makes it a permanent,
runnable one — which is the durable deliverable here.

The guard against over-reach is step 6: the existing suites must be **exactly**
as green as step 1 recorded them. Because no `.ts`/`.tsx`/`.mjs` source is in
scope, any change in those numbers means something was touched that should not
have been.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node ./node_modules/typescript/bin/tsc --noEmit --incremental false` exits 0 with no output
- [ ] `npm run typecheck` exists and exits 0
- [ ] `npm run build` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0 with 16 passing
- [ ] `python -m pytest test_core.py test_cockpit.py research/test_base_rate.py -q` exits 0 with 200 passed
- [ ] `git grep -n "@ts-ignore\|@ts-expect-error\|: any\b" -- app/ worker/ db/` returns no new matches versus the step 1 baseline
- [ ] `git diff --name-only` lists no file outside the in-scope list — in
      particular no `.ts`/`.tsx` source file and not `app/lib/dashboard-core.mjs`
- [ ] `git status --porcelain` shows no `.tsbuildinfo` and no `dashboard.json`
- [ ] `tsconfig.json` is unmodified (`git diff --quiet -- tsconfig.json`)

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's error count is not exactly 4, or the errors differ from the listed
  four by file/line/code.
- Step 1 finds build, lint, `npm test`, or pytest already red.
- Fixing an error appears to require editing a `.ts`/`.tsx` source file,
  `app/lib/dashboard-core.mjs`, or `tsconfig.json`. All four have a
  declaration-level fix; needing more means the diagnosis in this plan is wrong
  and you should report that rather than work around it.
- You are about to write `as`, `any`, `@ts-ignore`, or `@ts-expect-error`.
- Step 4 produces a *new* error indicating `parseDashboardSnapshot` does not
  actually guarantee `DashboardSnapshot`. That is a genuine finding about the
  trust boundary in front of a paid API — report it, do not paper over it.
- `vite/client` does not resolve (report before using the fallback in step 3).

## Maintenance notes

- **What this buys**: `"strict": true` stops being decorative. The highest-value
  piece is step 4 — the snapshot validator is the gate deciding which symbols may
  be researched against a real OpenAI budget, and until now its output was
  untyped at the boundary.
- **The `.mjs` pattern**: `dashboard-core.mjs` and `research-core.mjs` are plain
  JS so both Node tests and the app can import them without a build step. That is
  deliberate. The cost is that each needs a hand-written `.d.ts` to participate
  in typechecking. `research-core.mjs` does not yet have one and does not
  currently error — if it starts being consumed from typed code in a way that
  matters, give it the same treatment.
- **What a reviewer should scrutinize**: that `app/lib/dashboard-core.d.ts`
  matches what `dashboard-core.mjs` actually returns. A `.d.ts` is an unchecked
  assertion — if it lies, the compiler now confidently propagates the lie. Read
  the `.mjs` and the `.d.ts` side by side.
- **Follow-up for plan 02**: add the `Typecheck` step to `ci.yml`'s `web` job so
  this cannot regress.
