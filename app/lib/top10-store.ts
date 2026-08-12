import type { D1Database } from "cloudflare:workers";
import type { Top10Proposal } from "@/app/lib/evidence-types";
import { researchSchemaStatements } from "@/db/schema";
type Row = { proposal_id:string; proposal_json:string; status: Top10Proposal["status"] };
export class Top10Store {
  #ready: Promise<void> | undefined;
  constructor(private readonly db:D1Database) {}
  async ensureReady() { this.#ready ??= this.db.batch(researchSchemaStatements.map((sql)=>this.db.prepare(sql))).then(()=>undefined); return this.#ready; }
  async saveDraft(proposal: Top10Proposal, tradeDate:string) { await this.ensureReady(); await this.db.prepare("INSERT INTO top10_proposals (proposal_id,trade_date,researched_at,proposal_json,status) VALUES (?,?,?,?, 'draft') ON CONFLICT(proposal_id) DO NOTHING").bind(proposal.proposalId,tradeDate,proposal.researchedAt,JSON.stringify({...proposal,status:"draft"})).run(); }
  async current() { await this.ensureReady(); const rows=await this.db.prepare("SELECT proposal_id,proposal_json,status FROM top10_proposals WHERE status IN ('approved','draft') ORDER BY researched_at DESC").all<Row>(); const parsed=rows.results.map(row=>({...JSON.parse(row.proposal_json),status:row.status})); return {approved:parsed.find(item=>item.status==="approved") ?? null,draft:parsed.find(item=>item.status==="draft") ?? null}; }
  async decide(proposalId:string, decision:"approved"|"rejected", decidedAt:string) { await this.ensureReady(); const current=await this.db.prepare("SELECT proposal_id,status FROM top10_proposals WHERE proposal_id = ?").bind(proposalId).first<{proposal_id:string;status:Top10Proposal["status"]}>(); if(!current) throw new Error("proposal not found"); if(current.status !== "draft" && current.status !== decision) throw new Error("proposal already decided"); if(current.status === "draft") { const statements=decision === "approved" ? [this.db.prepare("UPDATE top10_proposals SET status = 'rejected', decided_at = ? WHERE status = 'approved'").bind(decidedAt),this.db.prepare("UPDATE top10_proposals SET status = 'approved', decided_at = ? WHERE proposal_id = ?").bind(decidedAt,proposalId)] : [this.db.prepare("UPDATE top10_proposals SET status = 'rejected', decided_at = ? WHERE proposal_id = ?").bind(decidedAt,proposalId)]; await this.db.batch(statements); } return this.current(); }
}
