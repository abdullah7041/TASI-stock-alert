import assert from "node:assert/strict";
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

test("renders an action-first cockpit instead of a generic loading page", async () => {
  const response = await renderDashboard();
  const html = await response.text();

  assert.match(html, /TASI Action Cockpit/i);
  assert.doesNotMatch(html, /Your site is taking shape/i);
});

test("limits Home scanner cards to qualified names and labels preview data", async () => {
  const response = await renderDashboard();
  const html = await response.text();

  assert.match(html, /Preview data — delayed\/daily/i);
  assert.match(html, /Al-Babtain/i);
  assert.match(html, /Why this action\?/i);
  assert.equal((html.match(/data-state="qualified"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Tabuk Agricultural/i);
});
