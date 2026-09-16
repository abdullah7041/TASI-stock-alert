const stockOptions = [
  { name: "code", description: "Four-digit TASI stock code", type: 3, required: true, min_length: 4, max_length: 4 },
  { name: "shares", description: "Positive whole shares", type: 4, required: true, min_value: 1 },
  { name: "price", description: "Positive price in SAR", type: 10, required: true, min_value: 0.01 },
];

export const commands = [
  { name: "portfolio", description: "Show the confirmed portfolio ledger", type: 1 },
  { name: "budget", description: "Show remaining monthly buy budget", type: 1 },
  { name: "ask", description: "Ask TASI about your portfolio and evidence", type: 1, options: [
    { name: "question", description: "Your question", type: 3, required: true, min_length: 1, max_length: 4000 },
  ] },
  { name: "decide", description: "Confirm a decision note in the ledger", type: 1, options: [
    { name: "symbol", description: "Four-digit stock code or PORTFOLIO", type: 3, required: true, min_length: 4, max_length: 9 },
    { name: "action", description: "Decision action", type: 3, required: true, choices: ["WATCH", "AVOID", "HOLD", "REDUCE", "RESEARCH_MORE"].map(name => ({ name, value: name })) },
    { name: "conditions", description: "Conditions for this decision", type: 3, required: true, min_length: 1, max_length: 2000 },
    { name: "invalidation", description: "What invalidates it", type: 3, required: true, min_length: 1, max_length: 2000 },
  ] },
  { name: "bought", description: "Record a confirmed buy in the ledger", type: 1, options: stockOptions },
  { name: "sold", description: "Record a confirmed sale in the ledger", type: 1, options: stockOptions },
];

export function commandRegistrationUrl(applicationId, guildId) {
  const base = `https://discord.com/api/v10/applications/${encodeURIComponent(applicationId)}`;
  return guildId ? `${base}/guilds/${encodeURIComponent(guildId)}/commands` : `${base}/commands`;
}
