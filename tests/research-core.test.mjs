import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_MONTHLY_STOP_SAR,
  buildDeterministicSections,
  estimateOperationCostSar,
  extractResponseText,
  extractAnnotatedCitations,
  reportResponseFormat,
  validateQualifiedResearch,
} from "../app/lib/research-core.mjs";

const qualifiedCandidate = {
  code: "1150",
  name: "Alinma Bank",
  relativeStrengthPct: 10.4,
  squeeze: true,
  conditionsMet: 2,
};

test("rejects a scanner candidate that does not meet two conditions", () => {
  assert.throws(
    () => validateQualifiedResearch({ ...qualifiedCandidate, conditionsMet: 1 }),
    /qualified/i,
  );
});

test("builds technical setup and entry plan only from the deterministic snapshot", () => {
  const sections = buildDeterministicSections(qualifiedCandidate, {
    asOf: "03 Aug 2026 · 09:40 AST",
    dataStatus: "preview-delayed",
  });

  assert.deepEqual(sections.map((section) => section.title), ["Technical Setup", "Entry Plan"]);
  assert.match(sections[0].body, /10\.4%/);
  assert.match(sections[1].body, /delayed/i);
  assert.equal(sections.every((section) => section.provenance === "deterministic"), true);
});

test("uses bounded server-side operation costs instead of a caller supplied amount", () => {
  assert.equal(estimateOperationCostSar("report", 0), 1);
  assert.equal(estimateOperationCostSar("chat", 999), 0.15);
  assert.equal(AGENT_MONTHLY_STOP_SAR, 45);
});

test("keeps only URLs supplied by OpenAI URL annotations as citations", () => {
  const citations = extractAnnotatedCitations({
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "A cited sentence and an invented link https://invented.example.",
            annotations: [
              {
                type: "url_citation",
                url: "https://www.saudiexchange.sa/example",
                title: "Saudi Exchange disclosure",
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(citations, [
    { title: "Saudi Exchange disclosure", url: "https://www.saudiexchange.sa/example" },
  ]);
});

test("requires a strict structured report response instead of trusting prompt text", () => {
  assert.deepEqual(reportResponseFormat(), {
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
  });
});

test("reads structured text from the raw Responses API message content", () => {
  const response = {
    output_text: "",
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: '{"companyNews":"Official disclosure","risks":"Delayed data","verdict":"WAIT"}',
      }],
    }],
  };

  assert.equal(
    extractResponseText(response),
    '{"companyNews":"Official disclosure","risks":"Delayed data","verdict":"WAIT"}',
  );
});
