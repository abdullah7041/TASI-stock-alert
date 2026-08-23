export function assertApprovableTop10(proposal) {
  if (!proposal || !Array.isArray(proposal.entries) || proposal.entries.length === 0) {
    throw new Error("A Top 10 proposal needs at least one researched entry before approval.");
  }
}

export function nextTop10ReviewAt(approvedAt) {
  const initial = new Date(approvedAt);
  if (!Number.isFinite(initial.getTime())) throw new Error("approvedAt must be a valid timestamp.");
  const year = initial.getUTCFullYear();
  const month = initial.getUTCMonth() + 3;
  const day = initial.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay), initial.getUTCHours(), initial.getUTCMinutes(), initial.getUTCSeconds(), initial.getUTCMilliseconds())).toISOString();
}
