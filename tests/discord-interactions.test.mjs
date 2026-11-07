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
  assert.match(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "bought" } }).message, /cockpit.*actual fees/i);
  assert.equal(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "sold" } }).kind, 'invalid');
  assert.equal(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "portfolio" } }).kind, "portfolio");
  assert.equal(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "budget" } }).kind, "budget");
  assert.equal(parseDiscordInteraction({ id: "abc", type: 2, data: { name: "anything-else" } }).kind, "unknown");
});

test("parses assistant questions and explicit decision confirmations", () => {
  assert.deepEqual(parseDiscordInteraction({ id: "ask-1", type: 2, data: { name: "ask", options: [{ name: "question", value: "Why did my portfolio move?" }] } }), { kind: "ask", question: "Why did my portfolio move?" });
  assert.deepEqual(parseDiscordInteraction({ id: "decide-1", type: 2, data: { name: "decide", options: [
    { name: "symbol", value: "PORTFOLIO" }, { name: "action", value: "WATCH" },
    { name: "conditions", value: "Wait for verified evidence" }, { name: "invalidation", value: "Evidence changes" },
  ] } }), { kind: "decide", id: "discord:decide-1", draft: { symbol: "PORTFOLIO", action: "WATCH", conditions: "Wait for verified evidence", invalidation: "Evidence changes" } });
});
