# CLAUDE.md

Guidance for coding agents working in this repository. Read this before changing
anything. `README.md` is the human-facing explanation of *what the system does
and why*; this file is the operational contract for working in it.

## What this is

A Saudi/Tadawul equity alert system, in two stacks that talk over authenticated
HTTP:

- **The producer** — Python at the repo root. Runs on a GitHub Actions schedule,
  analyses delayed daily market data, and posts a pre-open digest to Discord.
  `main.py` is a mode dispatcher: the `MODES` dict maps the `MODE` env var to a
  `mode_*` function, and that is the entry point for every scheduled job.
- **The cockpit** — TypeScript/React in `app/`, `worker/`, `db/`. Deployed on
  Cloudflare Workers with a D1 database. Renders the same artifact the producer
  sends to Discord.

## Verify before you claim anything works

These are the exact commands CI runs (`.github/workflows/ci.yml`). Run them; do
not assert success without output.

**Python job**

| Purpose | Command |
|---|---|
| Install | `pip install -r requirements.txt` |
| Compile | `python -m compileall -q main.py movement.py session_gate.py runtime research` |
| Tests | `python -m pytest test_core.py test_alert_names.py test_runtime.py research/test_base_rate.py -q` |

**Web job**

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Build + tests | `npm test` |
| Patch integrity | `git diff --check` |

`npm test` runs `npm run build` **first** — `tests/action-cockpit.test.mjs`
imports `../dist/server/index.js`, so the build is a prerequisite, not a
duplicate step. If the build cannot run in your environment, `npm run lint`,
`npm run typecheck`, `node --test tests/<file>.test.mjs` and `npx vitest run`
still work individually.

## Layout

| Path | What lives there |
|---|---|
| `*.py` (root) | The producer: `main.py` (modes), `analyze.py`, `data.py`, `notify.py`, `llm.py`, `scanner.py`, `triggers.py`, `session_gate.py` |
| `app/` | Cockpit UI (`components/`), API routes (`api/`), shared logic (`lib/`) |
| `worker/` | Cloudflare Workers entry point |
| `db/` | D1 schema statements |
| `tests/` | `*.test.mjs` (node --test) and `ui/*` (vitest + jsdom) |
| `research/` | Offline analysis and its own pytest files |
| `docs/` | Findings, runbooks, decision records |

Three test suites, three runners: **pytest** (root `test_*.py` and
`research/test_*.py`), **node --test** (`tests/*.test.mjs`), **vitest**
(`tests/ui/*`). A change to shared logic may need all three.

## Rules that are easy to break

**1. Three-way honesty — the most important rule here.** A failed fetch, an
empty result, and real content must never render identically. Read `llm.py`'s
module docstring and `notify.py`'s `_fmt_news` / `_fmt_disclosures` before
touching any code that renders or degrades a data source. This is why so many
functions return a reason string instead of an empty value, and violating it is
the most common way a change here is wrong while looking right.

**2. Root JSON state files are machine-written.** `dashboard.json`,
`state.json`, `history.json`, `movement_state.json`, `levels.json`,
`symbols.json`, `news_archive.jsonl`, `top10_draft.json` are produced by the
scheduled job and committed back by the workflow as `state update [skip ci]`
commits. Do not hand-edit them to change behaviour — change the code that writes
them.

**3. Comments explain *why*, often citing the incident that caused them.** See
`main.py`'s `_INDEX_WARNING` block. Do not strip these when refactoring; they
are the only record of several production failures.

**4. `data.py`'s `_HISTORY_CACHE` is module-level and never reset between
tests.** It is keyed by `(code, period)`. Every data-layer test passes a unique
`period` string (e.g. `"1y_test_total_outage"`) to avoid reading another test's
cached result. If you add one and reuse a period string, your test will silently
assert nothing.

**5. Tests must not depend on the wall clock.** `session_gate` functions accept
an explicit `now=`; pass it. A test that omits it passes or fails depending on
the time of day.

**6. `cloudflare:workers` only exists inside workerd.** Under vitest it is
aliased to `tests/ui/cloudflare-workers-stub.ts` (see `vitest.config.ts`). It
must be an alias, not a `vi.mock` — Vite resolves imports at transform time,
before mock factories run.

## Testing conventions

Test names are full sentences describing the guarantee
(`test_get_histories_returns_empty_frames_when_the_source_is_totally_down`), and
most carry a docstring explaining *what would break silently* without the test —
frequently naming the incident that motivated it. Match this; a name like
`test_get_histories_2` will look wrong here.

## Secrets

Never commit a credential value, and never paste one into a file, a test
fixture, or a commit message. Configuration is by environment variable; the
producer's set is declared in `.github/workflows/tasi.yml` and the cockpit's
bindings in `app/lib/cloudflare-env.d.ts`.

Names only, for orientation: `DISCORD_WEBHOOK_URL`, `SAHMK_API_KEY`,
`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `TASI_LLM_PROVIDERS`,
`COCKPIT_INGEST_TOKEN`, `COCKPIT_SIWC_BYPASS_TOKEN`, `DASHBOARD_INGEST_TOKEN`,
`AGENT_OWNER_EMAIL`, `OPENAI_API_KEY`. Producer secrets are GitHub Actions
secrets; cockpit secrets are Worker secrets (`npx wrangler secret put <NAME>`).

If you find a credential value committed anywhere, treat it as burned: report
the `file:line` and the credential *type*, never the value, and recommend
rotation rather than deletion alone.
