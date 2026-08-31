// Test double for the `cloudflare:workers` module.
//
// That specifier only exists inside the workerd runtime. Vite's import-analysis
// resolves imports at TRANSFORM time, before any `vi.mock` factory runs, so
// mocking it from inside a test file fails with "Failed to resolve import" and
// the suite never loads. Aliasing it to this stub in vitest.config.ts is what
// makes `app/lib/research-agent.ts` importable under test at all.
//
// `env` is mutable so each test can set exactly the bindings it needs and clear
// them afterwards.
export const env: Record<string, unknown> = {};
