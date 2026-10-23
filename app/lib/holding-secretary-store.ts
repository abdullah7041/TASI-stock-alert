import type { D1Database } from 'cloudflare:workers';
import { HoldingSecretaryConflict, parseProfileInput, parseCaseInput, parseHoldingReview, type ProfileInput, type InvestorProfile, type CaseInput, type HoldingCase, type HoldingReview, type SecretaryView } from './holding-secretary-core';

type Row = { operation_id: string; owner_id: string; kind: string; symbol: string; revision: number; body: string; request_json: string };

export class HoldingSecretaryStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}
  async ready() {
    this.#ready ??= this.db.prepare('CREATE TABLE IF NOT EXISTS holding_secretary_entries (operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, symbol TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, request_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id,kind,symbol,revision))').run().then(() => undefined);
    return this.#ready;
  }
  private operation(operationId: string) { return this.db.prepare('SELECT * FROM holding_secretary_entries WHERE operation_id=?').bind(operationId).first<Row>(); }
  private validate(ownerId: string, operationId: string, expectedRevision = 0) {
    if (!ownerId?.trim() || !operationId?.trim() || operationId.length > 4000) throw new Error('Owner and operationId are required.');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('A nonnegative expectedRevision is required.');
  }
  private replay<T>(row: Row, ownerId: string, kind: string, request: string): T {
    if (row.owner_id !== ownerId || row.kind !== kind || row.request_json !== request) throw new HoldingSecretaryConflict('operationId has already been used for a different record.');
    return this.read<T>(row);
  }
  private read<T>(row: Row): T {
    try {
      const body = JSON.parse(row.body) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      if (row.kind === 'review') {
        const review = parseHoldingReview(body);
        if (review.id !== row.symbol || row.operation_id !== `review:${review.id}`) throw new Error();
        return review as T;
      }
      if (row.kind === 'ack') {
        if (body.reviewId !== row.symbol || typeof body.reviewId !== 'string') throw new Error();
        return body as T;
      }
      if (body.revision !== row.revision || !Number.isSafeInteger(row.revision) || row.revision < 1 || body.operationId !== row.operation_id || typeof body.confirmedAt !== 'string' || !Number.isFinite(Date.parse(body.confirmedAt))) throw new Error();
      const confirmation = { revision: row.revision, operationId: row.operation_id, confirmedAt: body.confirmedAt };
      if (row.kind === 'profile' && row.symbol === '') return { ...parseProfileInput(body), ...confirmation } as T;
      if (row.kind === 'case' && body.symbol === row.symbol && Number.isSafeInteger(body.profileRevision) && Number(body.profileRevision) >= 1) return { ...parseCaseInput(body), ...confirmation, profileRevision: Number(body.profileRevision) } as T;
      throw new Error();
    } catch { throw new Error('Saved secretary records could not be verified.'); }
  }
  async view(ownerId: string): Promise<SecretaryView> {
    await this.ready();
    const rows = await this.db.prepare('SELECT * FROM holding_secretary_entries WHERE owner_id=? ORDER BY rowid').bind(ownerId).all<Row>();
    const view: SecretaryView = { profile: null, cases: [], caseHistory: [], reviews: [], acknowledgedReviewIds: [] };
    const cases = new Map<string, HoldingCase>();
    for (const row of rows.results) {
      const body = this.read(row);
      if (row.kind === 'profile') view.profile = body as InvestorProfile;
      if (row.kind === 'case') { const holding = body as HoldingCase; view.caseHistory.push(holding); cases.set(holding.symbol, holding); }
      if (row.kind === 'review') view.reviews.push(body as HoldingReview);
      if (row.kind === 'ack' && !view.acknowledgedReviewIds.includes(row.symbol)) view.acknowledgedReviewIds.push(row.symbol);
    }
    view.cases = [...cases.values()];
    return view;
  }
  private async confirm<T>(ownerId: string, kind: 'profile' | 'case', symbol: string, input: ProfileInput | CaseInput, expectedRevision: number, operationId: string, profileRevision?: number): Promise<T> {
    this.validate(ownerId, operationId, expectedRevision);
    if (kind === 'case' && (!Number.isSafeInteger(profileRevision) || Number(profileRevision) < 1)) throw new Error('A confirmed profile revision is required.');
    await this.ready();
    const request = JSON.stringify({ input, expectedRevision, ...(kind === 'case' ? { profileRevision } : {}) });
    const previous = await this.operation(operationId);
    if (previous) return this.replay<T>(previous, ownerId, kind, request);
    const body = { ...input, revision: expectedRevision + 1, ...(kind === 'case' ? { profileRevision } : {}), confirmedAt: new Date().toISOString(), operationId };
    // The unique revision and both predicates are evaluated by the same insert:
    // a concurrent profile edit cannot silently confirm an outdated company case.
    const query = this.db.prepare(`INSERT INTO holding_secretary_entries (operation_id,owner_id,kind,symbol,revision,body,request_json,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM holding_secretary_entries WHERE owner_id=? AND kind=? AND symbol=?),0)=?
      ${kind === 'case' ? "AND COALESCE((SELECT MAX(revision) FROM holding_secretary_entries WHERE owner_id=? AND kind='profile'),0)=?" : ''}`);
    const args: (string | number)[] = [operationId, ownerId, kind, symbol, body.revision, JSON.stringify(body), request, body.confirmedAt, ownerId, kind, symbol, expectedRevision];
    if (kind === 'case') args.push(ownerId, profileRevision!);
    try { await query.bind(...args).run(); }
    catch (error) {
      const raced = await this.operation(operationId);
      if (raced) return this.replay<T>(raced, ownerId, kind, request);
      const current = await this.db.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM holding_secretary_entries WHERE owner_id=? AND kind=? AND symbol=?').bind(ownerId, kind, symbol).first<{ revision: number }>();
      const profile = kind === 'case' ? await this.db.prepare("SELECT COALESCE(MAX(revision),0) AS revision FROM holding_secretary_entries WHERE owner_id=? AND kind='profile'").bind(ownerId).first<{ revision: number }>() : null;
      if (current?.revision !== expectedRevision || (kind === 'case' && profile?.revision !== profileRevision)) throw new HoldingSecretaryConflict('Profile or case revision changed; refresh and confirm again.');
      throw error;
    }
    const saved = await this.operation(operationId);
    if (!saved) throw new HoldingSecretaryConflict('Profile or case revision changed; refresh and confirm again.');
    return this.replay<T>(saved, ownerId, kind, request);
  }
  async saveProfile(ownerId: string, input: ProfileInput, expectedRevision: number, operationId: string): Promise<InvestorProfile> {
    return this.confirm(ownerId, 'profile', '', parseProfileInput(input), expectedRevision, operationId);
  }
  async confirmCase(ownerId: string, input: CaseInput, expectedRevision: number, operationId: string, profileRevision: number): Promise<HoldingCase> {
    const parsed = parseCaseInput(input);
    return this.confirm(ownerId, 'case', parsed.symbol, parsed, expectedRevision, operationId, profileRevision);
  }
  async saveReview(ownerId: string, review: HoldingReview): Promise<HoldingReview> {
    const parsed = parseHoldingReview(review), request = JSON.stringify(parsed), operationId = `review:${parsed.id}`;
    this.validate(ownerId, operationId);
    await this.ready();
    const existing = await this.operation(operationId);
    if (existing) return this.replay(existing, ownerId, 'review', request);
    await this.db.prepare("INSERT INTO holding_secretary_entries (operation_id,owner_id,kind,symbol,revision,body,request_json,created_at) VALUES (?,?,'review',?,1,?,?,?) ON CONFLICT(operation_id) DO NOTHING").bind(operationId, ownerId, parsed.id, request, request, parsed.createdAt).run();
    return this.replay((await this.operation(operationId))!, ownerId, 'review', request);
  }
  async acknowledge(ownerId: string, reviewId: string, operationId: string): Promise<SecretaryView> {
    this.validate(ownerId, operationId);
    if (typeof reviewId !== 'string' || !reviewId.trim()) throw new Error('A reviewId is required.');
    await this.ready();
    const request = JSON.stringify({ reviewId });
    const existing = await this.operation(operationId);
    if (existing) { this.replay(existing, ownerId, 'ack', request); return this.view(ownerId); }
    const review = await this.operation(`review:${reviewId}`);
    if (!review || review.owner_id !== ownerId || review.kind !== 'review') throw new Error('The review does not exist for this owner.');
    // Retain even repeated acknowledgements so every operation id has a durable
    // receipt. The view deduplicates IDs without changing any confirmed case.
    await this.db.prepare("INSERT INTO holding_secretary_entries (operation_id,owner_id,kind,symbol,revision,body,request_json,created_at) SELECT ?,?,'ack',?,COALESCE((SELECT MAX(revision) FROM holding_secretary_entries WHERE owner_id=? AND kind='ack' AND symbol=?),0)+1,?,?,? ON CONFLICT(operation_id) DO NOTHING").bind(operationId, ownerId, reviewId, ownerId, reviewId, request, request, new Date().toISOString()).run();
    const committed = await this.operation(operationId);
    if (committed) this.replay(committed, ownerId, 'ack', request);
    return this.view(ownerId);
  }
}
