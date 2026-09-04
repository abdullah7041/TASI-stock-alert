# Plan 003: Stop trusting client-supplied identity headers for owner-only routes

> **Superseded:** Sites private dispatch authenticates visitors and supplies
> `oai-authenticated-user-*` headers. The custom `OWNER_PROXY_SECRET` design in
> this historical plan was removed before release; owner authorization remains
> enforced server-side through `AGENT_OWNER_EMAIL`.

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7bb9fdb..HEAD -- app/lib/research-agent.ts app/lib/cloudflare-env.d.ts tests/`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **This plan changes an authentication path.** Step 5 is a deliberate
> operator-coordination checkpoint. Do not skip it.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED — a wrong gate locks the owner out of their own cockpit
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `7bb9fdb` (origin/main), 2026-08-30 — re-based from 143b740; excerpts re-verified byte-identical at 7bb9fdb

## Why this matters

Every owner-only route on this site derives identity **entirely from request
headers the client sends**, with nothing proving the request actually came
through the authenticating proxy. `getPrivateResearchContext` reads
`oai-authenticated-user-id` and `oai-authenticated-user-email`, compares the
email to `AGENT_OWNER_EMAIL`, and grants access.

The machine-facing routes in the same codebase do **not** work this way — they
verify a bearer token (`app/api/dashboard/ingest/route.ts:9`,
`app/api/alerts/ingest/route.ts:23`). That asymmetry is the problem: the routes
that read the portfolio, write trades, approve the Top 10, and spend the OpenAI
budget are the ones with the weaker check.

Whether this is currently exploitable depends on something not knowable from
this repository: whether the hosting proxy strips inbound `oai-authenticated-*`
headers before forwarding. If it does, this change is defence in depth. If it
does not, anyone who knows the owner's email address — which is discoverable
from public commit metadata — has full owner access. **Add the check either
way**; an application must not depend on an unverified property of its
front door.

## Current state

`app/lib/research-agent.ts:16-32` — the entire trust boundary:

```typescript
export async function getPrivateResearchContext(request: Request): Promise<PrivateResearchContext> {
  const { env } = await import("cloudflare:workers");
  const ownerId = request.headers.get("oai-authenticated-user-id");
  const ownerEmail = request.headers.get("oai-authenticated-user-email");
  if (!ownerId || !ownerEmail) throw new Response("Sign in is required.", { status: 401 });
  if (!env.AGENT_OWNER_EMAIL || ownerEmail.toLowerCase() !== env.AGENT_OWNER_EMAIL.toLowerCase()) {
    throw new Response("This private agent is unavailable for this account.", { status: 403 });
  }
  if (!env.DB || !env.OPENAI_API_KEY) throw new Response("The research agent is not configured yet.", { status: 503 });
  return {
    ownerId,
    store: new ResearchStore(env.DB),
    openAiKey: env.OPENAI_API_KEY,
    reportModel: env.AGENT_REPORT_MODEL ?? "gpt-5.6-terra",
    chatModel: env.AGENT_CHAT_MODEL ?? "gpt-5.6-luna",
  };
}
```

Every caller (do not modify these — they all route through the one function):

- `app/api/portfolio/route.ts:5` — reads holdings and cash
- `app/api/portfolio/events/route.ts:5` — **writes trades to the ledger**
- `app/api/top10/approve/route.ts:3` — approves/rejects the Top 10
- `app/api/research/chat/route.ts:8` — spends OpenAI budget
- `app/api/research/report/route.ts:7` — spends OpenAI budget
- `app/api/research/budget/route.ts:5` — reads budget

The contrasting machine-route pattern to mirror — `app/api/dashboard/ingest/route.ts:8-9`:

```typescript
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Dashboard ingestion is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
```

Env bindings are declared in `app/lib/cloudflare-env.d.ts` — `AGENT_OWNER_EMAIL`
at line 23 and `DASHBOARD_INGEST_TOKEN` at line 26. Any new binding must be
added there or `npm run typecheck` fails.

### Conventions to match

- Auth failures return a `Response` thrown from the helper (callers catch
  `instanceof Response` and convert it). Keep throwing `Response`, not `Error`.
- Error strings are user-facing and plain. Do not leak which check failed in a
  way that helps an attacker distinguish "wrong email" from "missing proof" —
  reuse the existing generic wording.
- This repo's comments explain *why*, citing the incident or reasoning. Match that.

## Commands you will need

| Purpose     | Command             | Expected on success |
|-------------|---------------------|---------------------|
| Install     | `npm ci`            | exit 0              |
| Typecheck   | `npm run typecheck` | exit 0, no errors   |
| Lint        | `npm run lint`      | exit 0              |
| Node tests  | `node --test tests/dashboard-core.test.mjs tests/portfolio-core.test.mjs tests/research-core.test.mjs tests/alert-names.test.mjs tests/top10-lifecycle.test.mjs` | all pass |

Note: `npm test` also runs `npm run build` and the vitest UI suite. Run the full
`npm test` if your environment can build; if the build fails for environment
reasons (missing native bindings), say so in your report and rely on
`typecheck` + `lint` + the node tests above.

## Scope

**In scope**:
- `app/lib/research-agent.ts` — add the proxy-proof check to
  `getPrivateResearchContext` only.
- `app/lib/cloudflare-env.d.ts` — declare the new binding.
- `tests/ui/research-agent.test.ts` — add a test file for the auth helper.
- `vitest.config.ts` — widen the `include` glob (step 4a). REQUIRED: the glob
  is currently `tests/ui/**/*.test.tsx`, so a `.ts` test file is silently
  never collected. Without this the tests exist and never run.

**Out of scope** (do NOT touch):
- All six caller routes listed above. They must keep calling the same helper
  with the same signature. Centralising the check is the entire point.
- `app/api/dashboard/ingest/route.ts` and `app/api/alerts/ingest/route.ts` —
  the machine routes already verify a token correctly.
- The `AGENT_OWNER_EMAIL` comparison logic. Keep it; this plan **adds** a check,
  it does not replace one.
- Any change that would let a request through with *fewer* checks than today.

## Git workflow

- Branch: `advisor/003-verify-owner-proxy`
- Commit message style — match the repo's log, e.g.
  `fix: distinguish current and historical alerts (#9)`.
  Suggested: `fix: require proof that owner requests came through the proxy`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Declare the new binding

In `app/lib/cloudflare-env.d.ts`, alongside the existing `AGENT_OWNER_EMAIL`
(line 23) and `DASHBOARD_INGEST_TOKEN` (line 26) declarations, add:

```typescript
    /**
     * Shared secret proving a request reached the Worker through the
     * authenticating front door rather than directly at the origin. Owner
     * identity arrives as request headers, which a direct caller can set
     * freely; this is what makes those headers trustworthy.
     */
    OWNER_PROXY_SECRET?: string;
```

Keep it optional (`?`) to match the other bindings — the runtime check in step 2
handles absence explicitly.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Require the proof in `getPrivateResearchContext`

Add the check **before** the existing header reads, so an unproven request never
reaches identity logic at all:

```typescript
export async function getPrivateResearchContext(request: Request): Promise<PrivateResearchContext> {
  const { env } = await import("cloudflare:workers");
  // Owner identity below arrives as plain request headers. A caller that
  // reaches this Worker directly can set those headers to anything, so they
  // are only meaningful once we know the request came through the front door
  // that authenticates users. The machine routes already prove themselves with
  // a bearer token (see app/api/dashboard/ingest/route.ts); the owner routes
  // -- which read the portfolio, write trades, approve the Top 10 and spend
  // the model budget -- did not, which made them the weaker of the two.
  if (!env.OWNER_PROXY_SECRET) {
    throw new Response("Owner access is not configured.", { status: 503 });
  }
  if (request.headers.get("x-owner-proxy-secret") !== env.OWNER_PROXY_SECRET) {
    throw new Response("Sign in is required.", { status: 401 });
  }
  const ownerId = request.headers.get("oai-authenticated-user-id");
  // ...rest unchanged
```

Do not change any line below `const ownerId = ...`.

**Verify**: `npm run typecheck` → exit 0. `npm run lint` → exit 0.

### Step 3: Confirm no caller broke

The helper's signature and return type are unchanged, so this should be a
no-op for callers.

**Verify**: `grep -rn "getPrivateResearchContext" app/ | wc -l` → the same count
as before your change (7: one definition, six call sites). And
`git diff --stat -- app/api/` → empty.

### Step 4: Test the helper

Check whether a test file for this helper already exists:
`ls tests/ | grep -i research`. There is `tests/research-core.test.mjs`, which
covers `app/lib/research-core.mjs` — a **different** module. `research-agent.ts`
is TypeScript and imports `cloudflare:workers`, which the plain `node --test`
suites cannot load.

Therefore: add the test to the **vitest** suite instead, next to
`tests/ui/action-cockpit.test.tsx`, as `tests/ui/research-agent.test.ts`, mocking
the `cloudflare:workers` import. Follow the mocking style already used in
`tests/ui/action-cockpit.test.tsx` (it uses `vi.stubGlobal` / `vi.fn`).

Cases to cover:

1. A request with correct identity headers but **no** `x-owner-proxy-secret` →
   throws a `Response` with status 401.
2. A request with a **wrong** `x-owner-proxy-secret` → 401.
3. `OWNER_PROXY_SECRET` unset in env → 503, and identity headers are irrelevant.
4. Correct secret + correct owner email → resolves (does not throw).
5. Correct secret + **wrong** owner email → 403 (proves the existing check
   still runs and this plan did not weaken it).

If mocking `cloudflare:workers` in vitest proves impractical within a reasonable
attempt, STOP and report — do not delete the check, and do not ship it untested
without saying so explicitly in your report.

### Step 4a: Make vitest actually collect the file

`vitest.config.ts` line 14 reads:

```typescript
    include: ["tests/ui/**/*.test.tsx"],
```

That is `.tsx` ONLY. A `tests/ui/research-agent.test.ts` file matches nothing and
vitest exits with "No test files found" — the tests would exist, read fine in
review, and never execute. Widen it to cover both extensions:

```typescript
    include: ["tests/ui/**/*.test.{ts,tsx}"],
```

Do not rename the test to `.tsx` instead: it renders no components, and naming a
non-React test `.tsx` to satisfy a glob hides the problem for the next person.

**Verify**: `npx vitest run tests/ui/research-agent.test.ts` → 5 passed, and the
output does NOT say "No test files found".

**Verify (no collateral)**: `npx vitest run` → the pre-existing
`tests/ui/action-cockpit.test.tsx` and `tests/ui/smoke.test.tsx` still pass.

### Step 5: OPERATOR CHECKPOINT — do not deploy without this

This change makes every owner route return 401/503 until
`OWNER_PROXY_SECRET` is set as a Worker secret **and** the front door is
configured to inject `x-owner-proxy-secret` on forwarded requests.

Write into your final report, verbatim, for the operator:

> Before deploying plan 003:
> 1. Generate a high-entropy secret and set it on the Worker
>    (`npx wrangler secret put OWNER_PROXY_SECRET`).
> 2. Configure the authenticating front door to add
>    `x-owner-proxy-secret: <that value>` to requests it forwards.
> 3. If the front door cannot inject a header, this approach will not work —
>    report back rather than deploying, and the check should instead be built
>    on whatever signed assertion the platform does provide.
> 4. Verify after deploy: loading the cockpit while signed in still works, and
>    a direct request to `/api/portfolio` without the header returns 401.

**Verify**: this text appears in your report. There is no command for this step.

## Test plan

Five cases in `tests/ui/research-agent.test.ts` as listed in step 4. Case 5 is
the regression guard: it proves the owner-email check was not weakened while
adding the proxy check.

Structural pattern: `tests/ui/action-cockpit.test.tsx` for vitest + mocking style.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` → exit 0
- [ ] `npm run lint` → exit 0
- [ ] `npx vitest run tests/ui/research-agent.test.ts` → **5 passed**, and the
      output does NOT contain "No test files found" (that string means the
      include glob still excludes the file and nothing was verified)
- [ ] `npx vitest run` → all suites pass, including the two pre-existing ones
- [ ] `node --test tests/dashboard-core.test.mjs tests/portfolio-core.test.mjs tests/research-core.test.mjs tests/alert-names.test.mjs` → all pass
- [ ] `git diff --stat -- app/api/` is empty (no caller modified)
- [ ] `grep -n "x-owner-proxy-secret" app/lib/research-agent.ts` → 1 match
- [ ] The step 5 operator checklist is reproduced in your report
- [ ] No secret **value** appears anywhere in the diff — binding names only
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back if:

- `app/lib/research-agent.ts:16-32` does not match the excerpt above.
- You cannot mock `cloudflare:workers` to test the helper (see step 4).
- You discover the hosting platform already injects a verifiable signed
  assertion (a JWT, a signature header) — that is strictly better than a shared
  secret, and the plan should be revised to verify it instead. Report what you
  found; do not implement both.
- Any change appears to require editing a route under `app/api/`.
- You are tempted to make the check opt-in via an env flag, or to let the
  request through when `OWNER_PROXY_SECRET` is unset. Both defeat the purpose.
  If you believe fail-open is needed for rollout, stop and report.

## Maintenance notes

- The comparison in step 2 is a plain `!==`. A timing-safe compare was
  considered and judged unnecessary: this runs over HTTPS where network jitter
  dominates, and the secret is high-entropy. Do not "fix" it without a reason.
- **Rotation**: if `OWNER_PROXY_SECRET` is ever exposed, rotating it requires
  updating both the Worker secret and the front-door configuration in the same
  window, or the cockpit 401s in between. Note that in any runbook you touch.
- Any *new* owner-only route must call `getPrivateResearchContext` and must not
  re-implement identity checks locally. A reviewer should reject any route that
  reads `oai-authenticated-*` headers directly.
- This plan does not touch the machine ingest routes. If those ever move behind
  the same front door, their bearer-token check should stay — two independent
  proofs is correct for a route that writes the daily artifact.
