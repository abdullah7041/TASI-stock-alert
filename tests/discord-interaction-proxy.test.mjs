import assert from "node:assert/strict";
import test from "node:test";
import { handleDiscordInteraction } from "../discord-interactions/src/interaction-proxy.mjs";

const env = { DISCORD_APP_PUBLIC_KEY: "00".repeat(32), COCKPIT_ORIGIN: "https://private.example", COCKPIT_SITE_AUTHORIZATION: "private-token" };

test("does not proxy an invalid Discord request", async () => {
  let called = false;
  const response = await handleDiscordInteraction(new Request("https://public.example/interactions", { method: "POST", headers: { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": "1724064000" }, body: '{"type":1}' }), env, async () => { called = true; return new Response("unexpected"); });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("forwards only a verified raw payload to the private Cockpit", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = '{"type":1}';
  const timestamp = "1724064000";
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(timestamp + raw));
  const publicKey = await crypto.subtle.exportKey("raw", pair.publicKey);
  const hex = (bytes) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
  let captured;
  const result = await handleDiscordInteraction(new Request("https://public.example/interactions", { method: "POST", headers: { "content-type": "application/json", "x-signature-ed25519": hex(signature), "x-signature-timestamp": timestamp, "x-untrusted": "drop-me" }, body: raw }), { ...env, DISCORD_APP_PUBLIC_KEY: hex(publicKey) }, async (url, init) => { captured = { url, request: new Request(url, init) }; return new Response("pong"); });
  assert.equal(result.status, 200);
  assert.equal(captured.url, "https://private.example/api/discord/interactions");
  assert.equal(await captured.request.text(), raw);
  assert.equal(captured.request.headers.get("oai-sites-authorization"), "private-token");
  assert.equal(captured.request.headers.get("x-untrusted"), null);
});

test("rejects unsupported paths, methods, and missing configuration", async () => {
  const fail = async () => { throw new Error("must not be called"); };
  assert.equal((await handleDiscordInteraction(new Request("https://public.example/other", { method: "POST", body: "bad" }), env, fail)).status, 404);
  assert.equal((await handleDiscordInteraction(new Request("https://public.example/interactions"), env, fail)).status, 405);
  assert.equal((await handleDiscordInteraction(new Request("https://public.example/interactions", { method: "POST", body: "bad" }), { ...env, COCKPIT_SITE_AUTHORIZATION: undefined }, fail)).status, 503);
});
