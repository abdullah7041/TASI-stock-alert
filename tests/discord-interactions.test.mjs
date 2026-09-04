import assert from "node:assert/strict";
import test from "node:test";
import { parseDiscordInteraction, verifyDiscordSignature } from "../app/lib/discord-interactions.mjs";

function hex(bytes) { return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join(""); }

test("verifies the exact timestamp plus raw body", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = '{"type":1}';
  const timestamp = "1724064000";
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(timestamp + raw));
  const publicKey = await crypto.subtle.exportKey("raw", pair.publicKey);
  assert.equal(await verifyDiscordSignature({ publicKey: hex(publicKey), signature: hex(signature), timestamp, raw }), true);
  assert.equal(await verifyDiscordSignature({ publicKey: hex(publicKey), signature: "00", timestamp, raw }), false);
});

test("dispatches only PING and documented ledger commands", () => {
  assert.deepEqual(parseDiscordInteraction({ type: 1 }), { kind: "ping" });
  assert.deepEqual(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "bought", options: [{ name: "code", value: "1303" }, { name: "shares", value: "20" }, { name: "price", value: "14.80" }] } }), { kind: "record", operationId: "discord:abc", event: { kind: "buy", code: "1303", shares: 20, priceSar: 14.8 } });
  assert.match(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "sold", options: [{ name: "code", value: "1303" }, { name: "shares", value: "2.5" }, { name: "price", value: "14.80" }] } }).message, /whole shares/i);
  assert.equal(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "portfolio" } }).kind, "portfolio");
  assert.equal(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "budget" } }).kind, "budget");
  assert.equal(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "anything-else" } }).kind, "unknown");
});
