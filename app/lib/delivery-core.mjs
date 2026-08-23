const ARTIFACT_ID = /^sha256:[a-f0-9]{64}$/;

export function parseDeliveryReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Delivery receipt must be an object.");
  if (typeof value.artifactId !== "string" || !ARTIFACT_ID.test(value.artifactId)) throw new Error("Delivery receipt needs a valid artifactId.");
  if (!["discord", "cockpit"].includes(value.destination)) throw new Error("Delivery receipt destination is invalid.");
  if (!["success", "failure"].includes(value.status)) throw new Error("Delivery receipt status is invalid.");
  if (typeof value.attemptedAt !== "string" || !Number.isFinite(Date.parse(value.attemptedAt))) throw new Error("Delivery receipt attemptedAt is invalid.");
  if (value.errorDetail !== undefined) {
    if (typeof value.errorDetail !== "string" || value.errorDetail.length > 300 || /authorization\s*:|bearer\s+|api[_ -]?key|token=/i.test(value.errorDetail)) {
      throw new Error("Delivery receipt needs a safe error detail.");
    }
  }
  return {
    artifactId: value.artifactId,
    destination: value.destination,
    status: value.status,
    attemptedAt: value.attemptedAt,
    ...(value.errorDetail ? { errorDetail: value.errorDetail } : {}),
  };
}
