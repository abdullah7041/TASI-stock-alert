import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function renderDashboard() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders an action-first cockpit instead of a generic page", async () => {
  const response = await renderDashboard();
  const html = await response.text();

  assert.match(html, /TASI Action Cockpit/i);
  assert.match(html, /Loading the latest saved daily digest/i);
  assert.doesNotMatch(html, /Your site is taking shape/i);
});

test("does not import preview fixtures and includes an unavailable state", () => {
  const source = readFileSync(new URL("../app/components/ActionCockpit.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /fixtures\/dashboard/);
  assert.match(source, /No verified daily snapshot is available/i);
  assert.match(source, /Delayed\/daily data/i);
});

test("uses separate Sites and app credentials for private ingestion", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tasi.yml", import.meta.url), "utf8");

  assert.match(workflow, /COCKPIT_SIWC_BYPASS_TOKEN/);
  assert.match(workflow, /OAI-Sites-Authorization: Bearer/);
});

test("lint ignores invalid files inside nested Claude worktrees", () => {
  const fixtureDir = fileURLToPath(new URL("../.claude/worktrees/lint-fixture", import.meta.url));
  const projectDir = fileURLToPath(new URL("../", import.meta.url));

  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(`${fixtureDir}/broken.ts`, "const = ;\n");
  try {
    const command = process.platform === "win32" ? "cmd.exe" : "npm";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run lint"] : ["run", "lint"];
    execFileSync(command, args, {
      cwd: projectDir,
      stdio: "pipe",
    });
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
