import { buildDeterministicSections, estimateOperationCostSar, extractAnnotatedCitations, extractResponseText, reportResponseFormat } from "@/app/lib/research-core.mjs";
import { ResearchStore } from "@/app/lib/research-store";

const allowedDomains = ["saudiexchange.sa", "cma.org.sa", "argaam.com", "reuters.com", "bloomberg.com"];

type Candidate = { code: string; name: string; relativeStrengthPct: number; squeeze: boolean; conditionsMet: number };

type PrivateResearchContext = {
  ownerId: string;
  store: ResearchStore;
  openAiKey: string;
  reportModel: string;
  chatModel: string;
};

export async function getPrivateResearchContext(request: Request): Promise<PrivateResearchContext> {
  const { env } = await import("cloudflare:workers");
  // Sites authenticates private visitors before dispatch and supplies these
  // identity headers. Authorization remains server-side through the owner
  // allowlist below; machine ingestion uses its separate bearer token.
  const ownerId = request.headers.get("oai-authenticated-user-id");
  const ownerEmail = request.headers.get("oai-authenticated-user-email");
  if (!ownerId || !ownerEmail) throw new Response("Sign in is required.", { status: 401 });
  if (!env.AGENT_OWNER_EMAIL || ownerEmail.toLowerCase() !== env.AGENT_OWNER_EMAIL.toLowerCase()) {
    throw new Response("This private agent is unavailable for this account.", { status: 403 });
  }
  if (!env.DB || !env.OPENAI_API_KEY) throw new Response("The research agent is not configured yet.", { status: 503 });
  return {
    ownerId,
    store: new ResearchStore(env.DB),
    openAiKey: env.OPENAI_API_KEY,
    reportModel: env.AGENT_REPORT_MODEL ?? "gpt-5.6-terra",
    chatModel: env.AGENT_CHAT_MODEL ?? "gpt-5.6-luna",
  };
}

function riyadhDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

async function openAiResponse(context: PrivateResearchContext, input: string, useWebSearch: boolean) {
  const body: Record<string, unknown> = {
    model: useWebSearch ? context.reportModel : context.chatModel,
    input,
  };
  if (useWebSearch) {
    body.text = { format: reportResponseFormat() };
    body.tools = [{ type: "web_search", search_context_size: "medium", filters: { allowed_domains: allowedDomains } }];
    body.tool_choice = "required";
    body.include = ["web_search_call.action.sources"];
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${context.openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
  return response.json() as Promise<{ output_text?: string; output?: unknown[] }>;
}

function parseResearch(text: string | undefined) {
  try {
    const parsed = JSON.parse(text ?? "");
    if (typeof parsed.companyNews !== "string" || typeof parsed.risks !== "string" || !["RESEARCH", "WAIT", "SKIP"].includes(parsed.verdict)) throw new Error();
    return parsed as { companyNews: string; risks: string; verdict: "RESEARCH" | "WAIT" | "SKIP" };
  } catch {
    throw new Error("The research response was not in the expected format.");
  }
}

export async function createOrReuseReport(context: PrivateResearchContext, candidate: Candidate, snapshot: { asOf: string; dataStatus: "delayed-daily" }) {
  if (candidate.conditionsMet < 2) throw new Response("Only qualified scanner candidates can be researched.", { status: 403 });
  const date = riyadhDate();
  const existing = await context.store.findReport(context.ownerId, candidate.code, date);
  if (existing?.status === "completed") return { report: existing.report, reused: true };

  const operationKey = `report:${date}:${candidate.code}`;
  const reservation = await context.store.reserve(context.ownerId, monthKey(date), operationKey, estimateOperationCostSar("report"));
  if (reservation === "exhausted") throw new Response("Monthly AI budget reached. Research resumes next month.", { status: 429 });
  if (reservation === "duplicate") throw new Response("Research is already running. Try again shortly.", { status: 409 });

  const deterministicSections = buildDeterministicSections(candidate, snapshot);
  try {
    const modelResponse = await openAiResponse(context,
      `Research ${candidate.code} ${candidate.name} for a private Saudi-market decision workspace. Return only JSON: {"companyNews":"short cited factual summary","risks":"short cited risks","verdict":"RESEARCH|WAIT|SKIP"}. Official disclosures first. Do not give a buy instruction, entry price, stop, target, or portfolio advice.`,
      true,
    );
    const research = parseResearch(extractResponseText(modelResponse));
    const citations = extractAnnotatedCitations(modelResponse);
    const report = {
      id: crypto.randomUUID(),
      symbol: candidate.code,
      name: candidate.name,
      generatedAt: new Date().toISOString(),
      dataStatus: snapshot.dataStatus,
      verdict: research.verdict,
      sections: [
        { title: "Company & News", body: research.companyNews, provenance: "research", citations },
        deterministicSections[0],
        { title: "Risks", body: research.risks, provenance: "research", citations },
        deterministicSections[1],
      ],
    };
    await context.store.saveReport({ id: report.id, ownerId: context.ownerId, symbol: candidate.code, tradeDate: date, status: "completed", report });
    return { report, reused: false };
  } catch (error) {
    await context.store.release(context.ownerId, operationKey);
    throw error;
  }
}

export async function answerStockQuestion(context: PrivateResearchContext, candidate: Candidate, text: string, manualPrice?: number) {
  const date = riyadhDate();
  const existing = await context.store.findReport(context.ownerId, candidate.code, date);
  if (!existing || existing.status !== "completed") throw new Response("Research this qualified stock before starting a conversation.", { status: 409 });
  const operationKey = `chat:${date}:${candidate.code}:${crypto.randomUUID()}`;
  if (await context.store.reserve(context.ownerId, monthKey(date), operationKey, estimateOperationCostSar("chat")) !== "reserved") {
    throw new Response("Monthly AI budget reached. Research resumes next month.", { status: 429 });
  }
  try {
    const priceNote = Number.isFinite(manualPrice) ? ` User-supplied broker price: ${manualPrice} SAR; label it as unverified.` : "";
    const modelResponse = await openAiResponse(context, `Answer only from this saved report and its deterministic sections: ${JSON.stringify(existing.report)}\n\nQuestion: ${text}.${priceNote} Do not browse, create a trade instruction, invent levels, or give a buy verdict.`, false);
    const reply = extractResponseText(modelResponse).trim();
    if (!reply) throw new Error("The agent returned no answer.");
    const message = { id: crypto.randomUUID(), role: "assistant", text: reply, createdAt: new Date().toISOString(), citations: (existing.report as { sections?: Array<{ citations?: unknown[] }> }).sections?.flatMap((section) => section.citations ?? []) ?? [] };
    await context.store.saveMessage(context.ownerId, candidate.code, message);
    return message;
  } catch (error) {
    await context.store.release(context.ownerId, operationKey);
    throw error;
  }
}

export async function getBudget(context: PrivateResearchContext) {
  const date = riyadhDate();
  const usedSar = await context.store.usage(context.ownerId, monthKey(date));
  return { monthlyBudgetSar: 50, operationalStopSar: 45, usedSar, remainingSar: Math.max(0, 45 - usedSar) };
}
