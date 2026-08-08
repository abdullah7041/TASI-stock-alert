export const AGENT_MONTHLY_STOP_SAR = 45;

const OPERATION_COSTS_SAR = {
  report: 1,
  chat: 0.15,
  comparison: 0.25,
};

export function reportResponseFormat() {
  return {
    type: "json_schema",
    name: "tasi_research_report",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["companyNews", "risks", "verdict"],
      properties: {
        companyNews: { type: "string" },
        risks: { type: "string" },
        verdict: { type: "string", enum: ["RESEARCH", "WAIT", "SKIP"] },
      },
    },
  };
}

export function validateQualifiedResearch(candidate) {
  if (!candidate || Number(candidate.conditionsMet) < 2) {
    throw new Error("Only scanner-qualified candidates can be researched.");
  }

  return candidate;
}

export function buildDeterministicSections(candidate, snapshot) {
  validateQualifiedResearch(candidate);
  const delayed = snapshot.dataStatus === "preview-delayed" ? " Delayed/daily data — verify your broker quote." : "";
  const squeeze = candidate.squeeze ? "Squeeze confirmation is present." : "No squeeze confirmation is present.";

  return [
    {
      title: "Technical Setup",
      body: `Relative strength is +${Number(candidate.relativeStrengthPct).toFixed(1)}%. ${squeeze}${delayed}`,
      provenance: "deterministic",
      citations: [],
    },
    {
      title: "Entry Plan",
      body: `Use the existing scanner rules and verify the live broker price before acting.${delayed}`,
      provenance: "deterministic",
      citations: [],
    },
  ];
}

export function estimateOperationCostSar(operation) {
  const cost = OPERATION_COSTS_SAR[operation];
  if (cost === undefined) throw new Error("Unsupported research operation.");
  return cost;
}

export function extractAnnotatedCitations(response) {
  const unique = new Map();

  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content?.type !== "output_text") continue;
      for (const annotation of content.annotations ?? []) {
        if (annotation?.type !== "url_citation" || typeof annotation.url !== "string") continue;
        unique.set(annotation.url, {
          title: typeof annotation.title === "string" && annotation.title.trim() ? annotation.title : annotation.url,
          url: annotation.url,
        });
      }
    }
  }

  return [...unique.values()];
}
