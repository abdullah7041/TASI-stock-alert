import assert from "node:assert/strict";
import test from "node:test";
import { parseDeliveryReceipt } from "../app/lib/delivery-core.mjs";

const artifactId = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("accepts an authenticated destination receipt for one canonical artifact", () => {
  assert.deepEqual(parseDeliveryReceipt({
    artifactId, destination: "discord", status: "success",
    attemptedAt: "2026-08-23T06:46:00Z",
  }), { artifactId, destination: "discord", status: "success", attemptedAt: "2026-08-23T06:46:00Z" });
});

test("rejects a receipt that could leak a bearer secret as an error detail", () => {
  assert.throws(() => parseDeliveryReceipt({
    artifactId, destination: "cockpit", status: "failure", attemptedAt: "2026-08-23T06:46:00Z",
    errorDetail: "Authorization: Bearer super-secret",
  }), /safe error detail/i);
});
