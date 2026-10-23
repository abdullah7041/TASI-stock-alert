import type { BrokerAccountId, PortfolioBook } from './evidence-types';

export type ProfileInput = { objective: string; horizon: string; contributions: string; riskSettings: string; constraints: string };
export type InvestorProfile = ProfileInput & { revision: number; confirmedAt: string; operationId: string };
export type CaseInput = { symbol: string; reasons: string; supportingEvidence: string; risks: string; reconsiderWhen: string; sourceRefs: string[] };
export type HoldingCase = CaseInput & { revision: number; profileRevision: number; confirmedAt: string; operationId: string };
export type AccountContext = { accountId: BrokerAccountId; revision: number; shares: number };
export type HoldingCompany = { symbol: string; name: string; accounts: AccountContext[] };
export type HoldingReview = {
  id: string; symbol: string; fingerprint: string; caseRevision: number; profileRevision: number; createdAt: string;
  status: 'provisional' | 'incomplete' | 'pending'; action: 'WATCH' | 'RESEARCH_MORE';
  changed: string; supporting: string; contrary: string; implications: string; missing: string; questions: string;
  sourceRefs: string[]; accounts: AccountContext[];
  evidenceRevisions?: string[]; collectionRunId?: string | null;
  sources?: Array<{ url: string; publishedAt: string | null; retrievedAt: string | null; reviewedAt: string | null; kind: 'reviewed' | 'announcement' }>;
};
export type SecretaryView = { profile: InvestorProfile | null; cases: HoldingCase[]; caseHistory: HoldingCase[]; reviews: HoldingReview[]; acknowledgedReviewIds: string[] };

// Strategy supplied by the owner; saving still requires explicit confirmation.
export const defaultProfile: ProfileInput = {
  objective: 'Grow long-term wealth through Saudi Main Market individual stocks.',
  horizon: 'Review after 3–5 years; may continue longer.',
  contributions: 'Variable contributions; no mandatory monthly purchase.',
  riskSettings: 'Numerical drawdown, concentration, sizing and fee settings are unconfigured.',
  constraints: 'Saudi individual stocks only. No ETFs, funds, REITs or international stocks; no Sharia screening. Keep Al Rajhi and Al Ahli separate. Manual execution.',
};

export class HoldingSecretaryConflict extends Error {
  constructor(message: string) { super(message); this.name = 'HoldingSecretaryConflict'; }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A secretary record is required.');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, required = true): string {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > 4000) throw new Error(`${field} must be text up to 4000 characters${required ? ' and cannot be empty' : ''}.`);
  return value.trim();
}
function symbol(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) throw new Error('Use a four-digit stock symbol.');
  return value;
}
function sourceRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 40) throw new Error('sourceRefs must contain up to 40 HTTPS URLs.');
  return [...new Set(value.map(ref => {
    if (typeof ref !== 'string' || ref.length > 2000) throw new Error('Each source reference must be an HTTPS URL.');
    let url: URL;
    try { url = new URL(ref); } catch { throw new Error('Each source reference must be an HTTPS URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Each source reference must be an HTTPS URL without credentials.');
    return ref;
  }))];
}
export function parseProfileInput(value: unknown): ProfileInput {
  const v = object(value);
  return { objective: text(v.objective, 'objective'), horizon: text(v.horizon, 'horizon'), contributions: text(v.contributions, 'contributions'), riskSettings: text(v.riskSettings, 'riskSettings'), constraints: text(v.constraints, 'constraints') };
}
export function parseCaseInput(value: unknown): CaseInput {
  const v = object(value);
  return { symbol: symbol(v.symbol), reasons: text(v.reasons, 'reasons'), supportingEvidence: text(v.supportingEvidence, 'supportingEvidence'), risks: text(v.risks, 'risks'), reconsiderWhen: text(v.reconsiderWhen, 'reconsiderWhen'), sourceRefs: sourceRefs(v.sourceRefs) };
}
export function parseHoldingReview(value: unknown): HoldingReview {
  const v = object(value);
  if (!['provisional', 'incomplete', 'pending'].includes(v.status as string) || !['WATCH', 'RESEARCH_MORE'].includes(v.action as string)) throw new Error('Unsupported review status or action.');
  if (!Number.isSafeInteger(v.caseRevision) || Number(v.caseRevision) < 1 || !Number.isSafeInteger(v.profileRevision) || Number(v.profileRevision) < 1) throw new Error('A review needs confirmed profile and case revisions.');
  if (typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt))) throw new Error('A review timestamp is required.');
  if (!Array.isArray(v.accounts) || v.accounts.length > 2) throw new Error('Review broker context is required.');
  const accounts: AccountContext[] = v.accounts.map(value => {
    const a = object(value);
    if (!['al_rajhi', 'al_ahli'].includes(a.accountId as string) || !Number.isSafeInteger(a.revision) || Number(a.revision) < 1 || !Number.isSafeInteger(a.shares) || Number(a.shares) < 1) throw new Error('Invalid review broker context.');
    return { accountId: a.accountId as BrokerAccountId, revision: Number(a.revision), shares: Number(a.shares) };
  });
  if (new Set(accounts.map(a => a.accountId)).size !== accounts.length) throw new Error('Duplicate review broker context.');
  const lineage: Pick<HoldingReview, 'evidenceRevisions' | 'collectionRunId' | 'sources'> = {};
  if (v.evidenceRevisions !== undefined) {
    if (!Array.isArray(v.evidenceRevisions) || v.evidenceRevisions.length > 100) throw new Error('Invalid evidence revisions.');
    lineage.evidenceRevisions = v.evidenceRevisions.map(id => text(id, 'evidence revision'));
  }
  if (v.collectionRunId !== undefined) lineage.collectionRunId = v.collectionRunId === null ? null : text(v.collectionRunId, 'collectionRunId');
  if (v.sources !== undefined) {
    if (!Array.isArray(v.sources) || v.sources.length > 100) throw new Error('Invalid review sources.');
    lineage.sources = v.sources.map(value => {
      const s = object(value);
      if (s.kind !== 'reviewed' && s.kind !== 'announcement') throw new Error('Invalid review source kind.');
      const date = (value: unknown): string | null => {
        if (value === null) return null;
        if (typeof value !== 'string' || value.length > 100 || !Number.isFinite(Date.parse(value))) throw new Error('Invalid review source date.');
        return value;
      };
      return { url: sourceRefs([s.url])[0], publishedAt: date(s.publishedAt), retrievedAt: date(s.retrievedAt), reviewedAt: date(s.reviewedAt), kind: s.kind };
    });
  }
  return { id: text(v.id, 'id'), symbol: symbol(v.symbol), fingerprint: text(v.fingerprint, 'fingerprint'), caseRevision: Number(v.caseRevision), profileRevision: Number(v.profileRevision), createdAt: v.createdAt,
    status: v.status as HoldingReview['status'], action: v.action as HoldingReview['action'], changed: text(v.changed, 'changed', false), supporting: text(v.supporting, 'supporting', false), contrary: text(v.contrary, 'contrary', false), implications: text(v.implications, 'implications', false), missing: text(v.missing, 'missing', false), questions: text(v.questions, 'questions', false), sourceRefs: sourceRefs(v.sourceRefs), accounts, ...lineage };
}

export function heldCompanies(book: PortfolioBook | null | undefined): HoldingCompany[] {
  const companies = new Map<string, HoldingCompany>();
  for (const account of book?.accounts ?? []) {
    if (!account.initialized || account.error || !account.confirmedAt || !Number.isSafeInteger(account.revision) || account.revision < 1) continue;
    for (const holding of account.holdings) {
      if (!/^\d{4}$/.test(holding.code) || !Number.isSafeInteger(holding.shares) || holding.shares <= 0) continue;
      let company = companies.get(holding.code);
      if (!company) { company = { symbol: holding.code, name: holding.name, accounts: [] }; companies.set(holding.code, company); }
      company.accounts.push({ accountId: account.accountId, revision: account.revision, shares: holding.shares });
    }
  }
  return [...companies.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}
