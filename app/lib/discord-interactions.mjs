function hexBytes(value, expectedLength) {
  if (typeof value !== "string" || !/^[0-9a-f]+$/i.test(value) || value.length !== expectedLength * 2) return null;
  const output = new Uint8Array(expectedLength);
  for (let index = 0; index < expectedLength; index += 1) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return output;
}

export async function verifyDiscordSignature({ publicKey, signature, timestamp, raw }) {
  const keyBytes = hexBytes(publicKey, 32);
  const signatureBytes = hexBytes(signature, 64);
  if (!keyBytes || !signatureBytes || typeof timestamp !== "string" || !timestamp || typeof raw !== "string" || !globalThis.crypto?.subtle) return false;
  try {
    const key = await globalThis.crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, ["verify"]);
    return await globalThis.crypto.subtle.verify("Ed25519", key, signatureBytes, new TextEncoder().encode(timestamp + raw));
  } catch {
    return false;
  }
}

function optionValue(options, name) {
  const option = Array.isArray(options) ? options.find((item) => item && item.name === name) : undefined;
  return option?.value;
}

export function interactionOption(options, name) {
  return optionValue(options, name);
}

function positiveWhole(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function positiveNumber(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function parseDiscordInteraction(interaction) {
  if (interaction?.type === 1) return { kind: "ping" };
  if (interaction?.type !== 2 || typeof interaction.id !== "string" || !interaction.id || !interaction.data || typeof interaction.data.name !== "string") return { kind: "unknown", message: "Unsupported interaction. No ledger record was created." };
  const command = interaction.data.name;
  if (command === "portfolio" || command === "budget") return { kind: command };
  if (command === "ask") {
    const question = String(optionValue(interaction.data.options, "question") ?? "").trim();
    return question ? { kind: "ask", question } : { kind: "invalid", message: "Enter a question. No request was sent." };
  }
  if (command === "decide") {
    const symbol = String(optionValue(interaction.data.options, "symbol") ?? "").trim().toUpperCase();
    const action = String(optionValue(interaction.data.options, "action") ?? "").trim().toUpperCase();
    const conditions = String(optionValue(interaction.data.options, "conditions") ?? "").trim();
    const invalidation = String(optionValue(interaction.data.options, "invalidation") ?? "").trim();
    if (!/^\d{4}$/.test(symbol) && symbol !== "PORTFOLIO") return { kind: "invalid", message: "Use a four-digit code or PORTFOLIO. No decision was saved." };
    if (!["WATCH", "AVOID", "HOLD", "REDUCE", "RESEARCH_MORE"].includes(action) || !conditions || !invalidation) return { kind: "invalid", message: "Action, conditions, and invalidation are required. No decision was saved." };
    return { kind: "decide", id: `discord:${interaction.id}`, draft: { symbol, action, conditions, invalidation } };
  }
  if (command !== "bought" && command !== "sold") return { kind: "unknown", message: "That command is unavailable. No ledger record was created." };
  const code = String(optionValue(interaction.data.options, "code") ?? "").trim();
  const shares = positiveWhole(optionValue(interaction.data.options, "shares"));
  const priceSar = positiveNumber(optionValue(interaction.data.options, "price"));
  if (!/^\d{4}$/.test(code)) return { kind: "invalid", message: "Use a four-digit TASI stock code. No ledger record was created." };
  if (shares === null) return { kind: "invalid", message: "Shares must be positive whole shares. No ledger record was created." };
  if (priceSar === null) return { kind: "invalid", message: "Price must be a positive SAR value. No ledger record was created." };
  return { kind: "record", operationId: `discord:${interaction.id}`, event: { kind: command === "bought" ? "buy" : "sell", code, shares, priceSar } };
}

export function discordMessage(content) {
  return { type: 4, data: { content, flags: 64 } };
}
