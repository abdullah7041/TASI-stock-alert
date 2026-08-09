export function parseDashboardSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dashboard snapshot must be an object.");
  const list = (field) => { if (!Array.isArray(value[field])) throw new Error(`${field} must be a list.`); return value[field]; };
  const text = (item, field) => { if (typeof item[field] !== "string" || !item[field].trim()) throw new Error(`${field} is required.`); return item[field]; };
  const number = (item, field) => { if (typeof item[field] !== "number" || !Number.isFinite(item[field])) throw new Error(`${field} must be a number.`); return item[field]; };
  const qualified = list("qualified").map((item) => {
    if (!item || typeof item !== "object" || item.conditionsMet !== 2) throw new Error("Research candidates must meet two conditions.");
    return { code: text(item, "code"), name: text(item, "name"), relativeStrengthPct: number(item, "relativeStrengthPct"), squeeze: item.squeeze === true, conditionsMet: 2 };
  });
  const urgent = list("urgent").map((item) => ({ code: text(item, "code"), name: text(item, "name"), action: text(item, "action"), price: number(item, "price"), reason: text(item, "reason"), pnlPct: number(item, "pnlPct") }));
  const changed = list("changed").map((item) => ({ code: text(item, "code"), name: text(item, "name"), status: text(item, "status"), reason: text(item, "reason") }));
  return { asOf: text(value, "asOf"), regime: text(value, "regime"), dataStatus: "preview-delayed", urgent, changed, qualified, researchCount: number(value, "researchCount") };
}
