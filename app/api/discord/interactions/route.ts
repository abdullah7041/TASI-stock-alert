import type {PortfolioBook} from '@/app/lib/evidence-types';
import { discordMessage, parseDiscordInteraction, verifyDiscordSignature } from "@/app/lib/discord-interactions.mjs";
import { PortfolioStore } from "@/app/lib/portfolio-store";
import { CopilotStore } from "@/app/lib/copilot-store";
import { answerPortfolioQuestion } from "@/app/lib/copilot-service";
import { parseDecision } from "@/app/lib/copilot-core";

function reply(content: string, status = 200) {
  return Response.json(discordMessage(content), { status });
}

function portfolioLine(book: PortfolioBook) {
  return book.accounts.map(a=>`${a.accountId === 'al_rajhi'?'Al Rajhi':'Al Ahli'}: ${a.error?'records unavailable':a.initialized?`${a.cashSar?.toFixed(2)} SAR cash; ${a.holdings.map(h=>`${h.code}: ${h.shares} shares`).join(', ')||'no confirmed holdings'}`:'opening unconfirmed'}; reconciliation ${a.reconciliationStatus}.`).join('\n')+'\nAccounts remain separate. Company policy and sizing are unconfigured. Legacy records are unassigned. No order is sent.';
}

function assistantFailure(error: unknown) {
  if (error instanceof Response && error.status === 429) {
    return reply("The Discord assistant has reached its monthly AI budget. Try again next month. No ledger record was created.", 429);
  }
  return reply("The Discord assistant is temporarily unavailable. No ledger record was created.", 502);
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
    | { kind: "unknown" | "invalid"; message: string };
  if (command.kind === "ping") return Response.json({ type: 1 });
  if (command.kind === "unknown" || command.kind === "invalid") return reply(command.message);
  if (!env.DB || !env.PORTFOLIO_OWNER_ID) return reply("Portfolio storage is unavailable. No ledger record was created.", 503);

  const store = new PortfolioStore(env.DB);
  try {
    if (command.kind === "ask") {
      if (!env.OPENROUTER_API_KEY) return reply("The Discord assistant is not configured. No request was sent.", 503);
      const chatModel = env.AGENT_DEFAULT_MODEL ?? env.AGENT_CHAT_MODEL ?? "deepseek/deepseek-v4.1-flash";
      try {
        const result = await answerPortfolioQuestion({ ownerId: env.PORTFOLIO_OWNER_ID, db: env.DB, apiKey: env.OPENROUTER_API_KEY, chatModel }, command.question);
        const draft = result.reply.draft;
        const suffix = draft ? `\n\nDraft ${draft.action} for ${draft.symbol}: ${draft.conditions} Invalidation: ${draft.invalidation}. Use /decide to save it after reviewing.` : "";
        return reply(`${result.reply.answer}${suffix}`);
      } catch (error) {
        return assistantFailure(error);
      }
    }
    if (command.kind === "decide") {
      const draft = parseDecision(command.draft);
      await new CopilotStore(env.DB).confirm(env.PORTFOLIO_OWNER_ID, { ...draft, id: command.id, confirmedAt: new Date().toISOString() });
      return reply(`Decision note saved for ${draft.symbol}: ${draft.action}. Conditions and invalidation are recorded; no order was sent.`);
    }
    const book = await store.book(env.PORTFOLIO_OWNER_ID);
    if (command.kind === "portfolio") return reply(portfolioLine(book));
    if (command.kind === "budget") {
      return reply(`No monthly spending cap or sizing policy is configured.\n${portfolioLine(book)}`);
    }
    return reply("Unsupported interaction. No ledger record was created.");
  } catch {
    return reply("The ledger rejected that activity. Check shares, confirmed cash, and existing holdings. No order was sent.");
  }
}
