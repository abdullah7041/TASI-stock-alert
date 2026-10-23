import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import type { D1Database } from 'cloudflare:workers';
import { HoldingSecretaryStore } from '@/app/lib/holding-secretary-store';
import { heldCompanies, parseCaseInput, parseProfileInput, parseHoldingReview, HoldingSecretaryConflict, type HoldingReview } from '@/app/lib/holding-secretary-core';
import { buildPortfolioBook } from '@/app/lib/portfolio-core.mjs';
import type { AccountRecord } from '@/app/lib/evidence-types';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
function database() {
  const sqlite = new DatabaseSync(':memory:');
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const query = { bind(...values: unknown[]) { args = values; return query; },
      async all() { return { results: sqlite.prepare(sql).all(...args as []) }; },
      async first() { return sqlite.prepare(sql).get(...args as []) ?? null; },
      async run() { return sqlite.prepare(sql).run(...args as []); } };
    return query;
  };
  const db = { prepare } as unknown as D1Database;
  return { store: new HoldingSecretaryStore(db), sqlite, db };
}
const profile = { objective: 'Long-term income', horizon: 'Five years', contributions: 'No commitment', riskSettings: 'Not set', constraints: 'Owner decides' };
const holdingCase = { symbol: '1303', reasons: 'Owner thesis', supportingEvidence: 'Owner assessment', risks: 'Demand may weaken', reconsiderWhen: 'Demand changes', sourceRefs: ['https://www.saudiexchange.sa/report'] };
const review = (id = 'review-one'): HoldingReview => ({ id, symbol: '1303', fingerprint: 'hash-one', caseRevision: 1, profileRevision: 1, createdAt: '2026-10-22T05:15:00Z', status: 'provisional', action: 'WATCH', changed: 'New report', supporting: 'No new support', contrary: 'Demand change', implications: 'Check the thesis', missing: 'Full filing', questions: 'Does this affect demand?', sourceRefs: ['https://www.saudiexchange.sa/report'], accounts: [{ accountId: 'al_rajhi', revision: 1, shares: 10 }] });

describe('holdings secretary storage', () => {
  it('normalizes inputs and rejects missing fields, invalid symbols and unsafe references', () => {
    expect(parseProfileInput({ ...profile, objective: '  Income  ' }).objective).toBe('Income');
    expect(() => parseProfileInput({ ...profile, horizon: '' })).toThrow();
    expect(() => parseCaseInput({ ...holdingCase, symbol: 'PORTFOLIO' })).toThrow();
    expect(() => parseCaseInput({ ...holdingCase, sourceRefs: ['javascript:alert(1)'] })).toThrow();
    expect(() => parseCaseInput({ ...holdingCase, sourceRefs: ['http://example.com'] })).toThrow();
    expect(parseCaseInput({ ...holdingCase, sourceRefs: [] }).sourceRefs).toEqual([]);
    expect(() => parseCaseInput({ ...holdingCase, risks: 'a'.repeat(4001) })).toThrow();
    expect(() => parseHoldingReview({ ...review(), action: 'BUY' })).toThrow();
    expect(() => parseHoldingReview({ ...review(), accounts: [{ accountId: 'al_rajhi', revision: 0, shares: 10 }] })).toThrow();
  });
  it('derives issuer cases only from healthy confirmed accounts and keeps broker context separate', () => {
    const record = (accountId: 'al_rajhi' | 'al_ahli', shares: number): AccountRecord => ({ operationId: accountId, kind: 'event', accountId, revision: 1, recordedAt: '2026-10-21T00:00:00Z', payload: { kind: 'opening_balance', cashSar: 100, holdings: [{ code: '1303', name: 'EIC', shares }], occurredAt: '2026-10-20T00:00:00Z', provenance: { source: 'manual' } } });
    expect(heldCompanies(undefined)).toEqual([]);
    expect(heldCompanies(buildPortfolioBook([], [{ code: '9999', shares: 99 }]))).toEqual([]);
    expect(heldCompanies(buildPortfolioBook([record('al_rajhi', 10), record('al_ahli', 20)], []))).toEqual([{ symbol: '1303', name: 'EIC', accounts: [{ accountId: 'al_rajhi', revision: 1, shares: 10 }, { accountId: 'al_ahli', revision: 1, shares: 20 }] }]);
    const book = buildPortfolioBook([record('al_rajhi', 10), record('al_ahli', 20)], []);
    book.accounts[0].error = 'Damaged';
    expect(heldCompanies(book)[0].accounts).toEqual([{ accountId: 'al_ahli', revision: 1, shares: 20 }]);
  });
  it('preserves every confirmed case revision beyond the chat window and across reloads', async () => {
    const { store, db } = database();
    expect(await store.view('owner')).toEqual({ profile: null, cases: [], caseHistory: [], reviews: [], acknowledgedReviewIds: [] });
    await store.saveProfile('owner', profile, 0, 'profile-one');
    for (let i = 0; i < 35; i++) await store.confirmCase('owner', { ...holdingCase, reasons: `Thesis ${i}` }, i, `case-${i}`, 1);
    const view = await new HoldingSecretaryStore(db).view('owner');
    expect(view.cases).toHaveLength(1);
    expect(view.cases[0]).toMatchObject({ reasons: 'Thesis 34', revision: 35, profileRevision: 1 });
    expect(view.caseHistory).toHaveLength(35);
    expect(view.caseHistory[0].reasons).toBe('Thesis 0');
    expect((await store.view('other')).cases).toEqual([]);
  });
  it('allows one competing revision and makes only exact operation retries idempotent', async () => {
    const { store } = database();
    const results = await Promise.allSettled([store.saveProfile('a', profile, 0, 'profile-a'), store.saveProfile('a', { ...profile, objective: 'Other objective' }, 0, 'profile-b')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(HoldingSecretaryConflict);
    const saved = (await store.view('a')).profile!;
    expect(await store.saveProfile('a', profile, 0, saved.operationId)).toMatchObject({ revision: 1 });
    await expect(store.saveProfile('a', { ...profile, objective: 'Changed' }, 0, saved.operationId)).rejects.toThrow(/operation/i);
    await expect(store.saveProfile('b', profile, 0, saved.operationId)).rejects.toThrow(/operation/i);
  });
  it('rejects stale profiles atomically during case confirmation and still replays committed confirmations', async () => {
    const { store } = database();
    await expect(store.confirmCase('a', holdingCase, 0, 'missing-profile', 1)).rejects.toThrow(/profile|revision/i);
    await store.saveProfile('a', profile, 0, 'profile-one');
    const first = await store.confirmCase('a', holdingCase, 0, 'case-one', 1);
    await store.saveProfile('a', { ...profile, objective: 'Changed' }, 1, 'profile-two');
    await expect(store.confirmCase('a', holdingCase, 1, 'stale-profile', 1)).rejects.toThrow(/profile|revision/i);
    expect(await store.confirmCase('a', holdingCase, 0, 'case-one', 1)).toEqual(first);
    const writes = await Promise.allSettled([store.confirmCase('a', holdingCase, 1, 'case-two', 2), store.confirmCase('a', { ...holdingCase, reasons: 'Competing thesis' }, 1, 'case-three', 2)]);
    expect(writes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await store.view('a')).caseHistory).toHaveLength(2);
  });
  it('rejects damaged saved case content without poisoning another owners view', async () => {
    const { store, sqlite } = database();
    await store.saveProfile('a', profile, 0, 'profile-one');
    await store.confirmCase('a', holdingCase, 0, 'case-one', 1);
    const broken = { ...holdingCase, reasons: '', revision: 1, profileRevision: 1, operationId: 'case-one', confirmedAt: '2026-10-22T05:15:00Z' };
    sqlite.prepare("UPDATE holding_secretary_entries SET body=? WHERE operation_id='case-one'").run(JSON.stringify(broken));
    await expect(store.view('a')).rejects.toThrow(/verified/i);
    expect((await store.view('b')).cases).toEqual([]);
  });
  it('persists readable source dates and evidence revisions and rejects malformed lineage', async () => {
    const { store } = database();
    const lineage = { evidenceRevisions: ['filing-revision-7'], collectionRunId: 'collection-2026-10-22', sources: [{ url: 'https://www.saudiexchange.sa/report', publishedAt: '2026-10-21T08:00:00Z', retrievedAt: '2026-10-22T05:15:00Z', reviewedAt: null, kind: 'announcement' }] };
    const parsed = parseHoldingReview({ ...review(), ...lineage });
    expect(parsed).toMatchObject(lineage);
    await store.saveReview('a', parsed);
    expect((await store.view('a')).reviews[0]).toMatchObject(lineage);
    expect(() => parseHoldingReview({ ...review(), sources: [{ ...lineage.sources[0], url: 'http://example.com' }] })).toThrow();
    expect(() => parseHoldingReview({ ...review(), sources: [{ ...lineage.sources[0], publishedAt: 'broken' }] })).toThrow();
    expect(() => parseHoldingReview({ ...review(), evidenceRevisions: [42] })).toThrow();
    expect(() => parseHoldingReview({ ...review(), collectionRunId: 42 })).toThrow();
  });
  it('persists stable review IDs once and acknowledges only the owners existing review without changing cases', async () => {
    const { store } = database();
    await store.saveProfile('a', profile, 0, 'profile-one');
    await store.confirmCase('a', holdingCase, 0, 'case-one', 1);
    const cases = (await store.view('a')).caseHistory;
    await Promise.all([store.saveReview('a', review()), store.saveReview('a', review())]);
    expect((await store.view('a')).reviews).toHaveLength(1);
    await expect(store.saveReview('a', { ...review(), changed: 'Different content' })).rejects.toThrow(/operation|review/i);
    await expect(store.acknowledge('b', 'review-one', 'ack-other')).rejects.toThrow(/review/i);
    await expect(store.acknowledge('a', 'missing', 'ack-missing')).rejects.toThrow(/review/i);
    await store.acknowledge('a', 'review-one', 'ack-one');
    await store.acknowledge('a', 'review-one', 'ack-one');
    const view = await store.view('a');
    expect(view.acknowledgedReviewIds).toEqual(['review-one']);
    expect(view.caseHistory).toEqual(cases);
    await store.saveReview('a', review('review-two'));
    await expect(store.acknowledge('a', 'review-two', 'ack-one')).rejects.toThrow(/operation/i);
    // A fresh operation acknowledging an already-seen review still consumes its
    // id: an uncertain retry cannot acknowledge a different review by accident.
    await store.acknowledge('a', 'review-one', 'ack-again');
    await expect(store.acknowledge('a', 'review-two', 'ack-again')).rejects.toThrow(/operation/i);
    expect((await store.view('a')).acknowledgedReviewIds).toEqual(['review-one']);
  });
});
