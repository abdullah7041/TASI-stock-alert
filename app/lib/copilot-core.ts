export const decisionActions = ['WATCH', 'AVOID', 'HOLD', 'REDUCE', 'RESEARCH_MORE'] as const;
const modelDecisionActions = ['WATCH','RESEARCH_MORE'] as const;
export type DecisionDraft = { symbol: string; action: typeof decisionActions[number]; conditions: string; invalidation: string; recommendationId?:string };
export type CopilotMessage = { id: string; role: 'user' | 'assistant'; text: string; createdAt: string; draft?: DecisionDraft | null };
export type DecisionNote = DecisionDraft & { id: string; confirmedAt: string };

export function parseDecision(value: unknown): DecisionDraft {
  if (!value || typeof value !== 'object') throw new Error('A decision draft is required.');
  const v = value as Record<string, unknown>;
  if (typeof v.symbol !== 'string' || !/^(?:\d{4}|PORTFOLIO)$/.test(v.symbol)) throw new Error('Use a four-digit stock code or PORTFOLIO.');
  if (!decisionActions.includes(v.action as DecisionDraft['action'])) throw new Error('Choose a supported decision.');
  for (const key of ['conditions', 'invalidation']) {
    if (typeof v[key] !== 'string' || !v[key].trim() || v[key].length > 2000) throw new Error('Conditions and invalidation are required (up to 2000 characters each).');
  }
  if(v.recommendationId!==undefined&&(typeof v.recommendationId!=='string'||!/^[a-f0-9]{64}$/.test(v.recommendationId)))throw new Error('Invalid recommendation reference.');
  return { ...(typeof v.recommendationId==='string'?{recommendationId:v.recommendationId}:{}), symbol: v.symbol, action: v.action as DecisionDraft['action'], conditions: (v.conditions as string).trim(), invalidation: (v.invalidation as string).trim() };
}

export function parseCopilotReply(text: string): { answer: string; draft: DecisionDraft | null } {
  const result = JSON.parse(text);
  if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('The assistant returned no answer.');
  const draft = result.draft === null ? null : parseDecision(result.draft);
  if (draft && !modelDecisionActions.some(action=>action===draft.action)) throw new Error('Company policy permits only WATCH or RESEARCH_MORE model drafts.');
  return { answer: result.answer.trim(), draft };
}

export const copilotFormat = {
  type: 'json_schema', name: 'portfolio_conversation', strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['answer', 'draft'], properties: {
    answer: { type: 'string' },
    draft: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
      required: ['symbol', 'action', 'conditions', 'invalidation'], properties: {
        symbol: { type: 'string' }, action: { type: 'string', enum: [...modelDecisionActions] },
        conditions: { type: 'string' }, invalidation: { type: 'string' },
      } }] },
  } },
};
