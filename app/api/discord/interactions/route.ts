import { DashboardStore } from "@/app/lib/dashboard-store";
import { discordMessage, parseDiscordInteraction, verifyDiscordSignature } from "@/app/lib/discord-interactions.mjs";
import { PortfolioStore } from "@/app/lib/portfolio-store";
import { CopilotStore } from "@/app/lib/copilot-store";
import { answerPortfolioQuestion } from "@/app/lib/copilot-service";
import { parseDecision } from "@/app/lib/copilot-core";

function reply(content: string, status = 200) {
  return Response.json(discordMessage(content), { status });
}

function portfolioLine(view: { cashSar: number; holdings: Array<{ code: string; shares: number }> }) {
  const holdings = view.holdings.length ? view.holdings.map((item) => `${item.code}: ${item.shares} shares`).join(", ") : "no confirmed holdings";
  return `Confirmed ledger: ${view.cashSar.toFixed(2)} SAR cash; ${holdings}. This is a ledger view and never sends an order.`;
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const publicKey = env.DISCORD_APP_PUBLIC_KEY;
  if (!publicKey) return Response.json({ error: "Discord interactions are not configured." }, { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-signature-ed25519") ?? "";
  const timestamp = request.headers.get("x-signature-timestamp") ?? "";
  if (!await verifyDiscordSignature({ publicKey, signature, timestamp, raw })) return new Response("Invalid request signature.", { status: 401 });

  let interaction: unknown;
  try { interaction = JSON.parse(raw); }
  catch { return reply("Invalid interaction payload. No ledger record was created.", 400); }
  const actorId = (interaction as {member?: {user?: {id?: string}}; user?: {id?: string}}).member?.user?.id
    ?? (interaction as {user?: {id?: string}}).user?.id;
  if (!env.DISCORD_OWNER_USER_ID || actorId !== env.DISCORD_OWNER_USER_ID) {
    return reply("This private assistant is restricted to the portfolio owner.", 403);
  }
  const command = parseDiscordInteraction(interaction) as
    | { kind: "ping" }
    | { kind: "portfolio" | "budget" }
    | { kind: "ask"; question: string }
    | { kind: "decide"; id: string; draft: unknown }
    | { kind: "unknown" | "invalid"; message: string }
    | { kind: "record"; operationId: string; event: { kind: "buy" | "sell"; code: string; shares: number; priceSar: number } };
  if (command.kind === "ping") return Response.json({ type: 1 });
  if (command.kind === "unknown" || command.kind === "invalid") return reply(command.message);
  if (!env.DB || !env.PORTFOLIO_OWNER_ID) return reply("Portfolio storage is unavailable. No ledger record was created.", 503);

  const store = new PortfolioStore(env.DB);
  const month = new Date().toISOString().slice(0, 7);
  try {
    if (command.kind === "ask") {
      if (!env.OPENAI_API_KEY) return reply("The Discord assistant is not configured. No request was sent.", 503);
      const result = await answerPortfolioQuestion({ ownerId: env.PORTFOLIO_OWNER_ID, db: env.DB, openAiKey: env.OPENAI_API_KEY, chatModel: env.AGENT_CHAT_MODEL ?? "gpt-5.6-luna" }, command.question);
      const draft = result.reply.draft;
      const suffix = draft ? `\n\nDraft ${draft.action} for ${draft.symbol}: ${draft.conditions} Invalidation: ${draft.invalidation}. Use /decide to save it after reviewing.` : "";
      return reply(`${result.reply.answer}${suffix}`);
    }
    if (command.kind === "decide") {
      const draft = parseDecision(command.draft);
      await new CopilotStore(env.DB).confirm(env.PORTFOLIO_OWNER_ID, { ...draft, id: command.id, confirmedAt: new Date().toISOString() });
      return reply(`Decision note saved for ${draft.symbol}: ${draft.action}. Conditions and invalidation are recorded; no order was sent.`);
    }
    if (command.kind === "portfolio") return reply(portfolioLine(await store.view(env.PORTFOLIO_OWNER_ID)));
    const current = await store.ledger(month);
    const snapshot = await new DashboardStore(env.DB).latest();
    if (command.kind === "budget") {
      if (typeof snapshot?.monthlyBudgetSar !== "number") return reply("The daily buy budget is unavailable. No ledger record was created.");
      const remaining = Math.max(0, snapshot.monthlyBudgetSar - current.spentThisMonthSar);
      return reply(`Remaining monthly buy budget: ${remaining.toFixed(2)} SAR. This is a ledger calculation and never sends an order.`);
    }
    if (command.kind !== "record") return reply("Unsupported interaction. No ledger record was created.");
    const top10Entries = snapshot && "top10" in snapshot ? snapshot.top10.entries : [];
    const name = current.view.holdings.find((item) => item.code === command.event.code)?.name
      ?? top10Entries.find((item) => item.code === command.event.code)?.name
      ?? command.event.code;
    const view = await store.append(env.PORTFOLIO_OWNER_ID, { operationId: command.operationId, ...command.event, name, confirmedAt: new Date().toISOString() });
    return reply(`Confirmed ${command.event.kind} recorded. ${portfolioLine(view)}`);
  } catch {
    return reply("The ledger rejected that activity. Check shares, confirmed cash, and existing holdings. No order was sent.");
  }
}
