import type { D1Database } from 'cloudflare:workers';
import type { CopilotMessage, DecisionNote } from './copilot-core';

export class CopilotStore {
  constructor(private db: D1Database) {}
  async ready() {
    await this.db.prepare('CREATE TABLE IF NOT EXISTS copilot_entries (owner_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id))').run();
  }
  async history(owner: string) {
    await this.ready();
    const rows = await this.db.prepare("SELECT kind,body FROM (SELECT rowid AS seq,kind,body FROM copilot_entries WHERE owner_id=? AND kind='message' ORDER BY rowid DESC LIMIT 30) ORDER BY seq").bind(owner).all<{kind: string; body: string}>();
    const notes = await this.db.prepare("SELECT body FROM copilot_entries WHERE owner_id=? AND kind='decision' ORDER BY rowid DESC LIMIT 50").bind(owner).all<{body: string}>();
    return { messages: rows.results.map(r => JSON.parse(r.body) as CopilotMessage), decisions: notes.results.map(r => JSON.parse(r.body) as DecisionNote) };
  }
  async saveMessages(owner: string, messages: CopilotMessage[]) {
    await this.ready();
    await this.db.batch(messages.map(m => this.db.prepare("INSERT INTO copilot_entries(owner_id,id,kind,body,created_at) VALUES (?,?,'message',?,?)").bind(owner,m.id,JSON.stringify(m),m.createdAt)));
  }
  async confirm(owner: string, note: DecisionNote) {
    await this.ready();
    // Confirmation is append-only: a revised decision retains the previous note.
    await this.db.prepare("INSERT INTO copilot_entries(owner_id,id,kind,body,created_at) VALUES (?,?,'decision',?,?) ON CONFLICT(owner_id,id) DO NOTHING").bind(owner,note.id,JSON.stringify(note),note.confirmedAt).run();
  }
}
