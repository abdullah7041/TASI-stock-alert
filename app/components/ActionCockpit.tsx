"use client";

import { useEffect, useState } from "react";
import type { Candidate, DashboardPayload, DashboardSnapshotV2 } from "@/app/lib/dashboard-types";
import styles from "./ActionCockpit.module.css";
import { ResearchWorkspace } from "./ResearchWorkspace";

type DashboardState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; payload: DashboardPayload };

function formatPrice(price: number) {
  return `${price.toFixed(2)} SAR`;
}

function formatTimestamp(timestamp: string) {
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? timestamp : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(value) + " Riyadh";
}

function LoadingCockpit() {
  return <main className={styles.cockpit}><p className={styles.subtitle}>Loading the latest saved daily digest…</p></main>;
}

function UnavailableCockpit({ message }: { message: string }) {
  return <main className={styles.cockpit}><p className={styles.brand}>TASI ACTION COCKPIT</p><h1>No verified daily snapshot is available.</h1><p className={styles.subtitle}>{message} The cockpit will show data after the next successful pre-open digest.</p></main>;
}

function isV2(snapshot: DashboardPayload["snapshot"]): snapshot is DashboardSnapshotV2 {
  return snapshot.schemaVersion === 2;
}

export function ActionCockpit({ dashboard }: { dashboard: DashboardPayload | null }) {
  const [state, setState] = useState<DashboardState>(() => dashboard ? { kind: "ready", payload: dashboard } : { kind: "loading" });
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as DashboardPayload & { error?: string };
        if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "No verified daily snapshot is available.");
        setState({ kind: "ready", payload });
      } catch (error) {
        if (!controller.signal.aborted) setState({ kind: "unavailable", message: error instanceof Error ? error.message : "The daily dashboard could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, []);

  if (selectedCandidate) return <ResearchWorkspace candidate={selectedCandidate} onClose={() => setSelectedCandidate(null)} />;
  if (state.kind === "loading") return <LoadingCockpit />;
  if (state.kind === "unavailable") return <UnavailableCockpit message={state.message} />;

  const { snapshot, freshness } = state.payload;
  const alerts = state.payload.alerts;
  const qualified = snapshot.qualified.slice(0, 3);
  const researchEnabled = freshness === "current" && import.meta.env.VITE_AGENT_ENABLED !== "false";
  const v2 = isV2(snapshot) ? snapshot : null;

  async function decideTop10(decision: "approved" | "rejected") {
    if (!v2 || v2.top10.status !== "draft" || actionBusy) return;
    setActionBusy(true);
    setActionStatus(null);
    try {
      const response = await fetch("/api/top10/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: v2.top10.proposalId, decision, decidedAt: new Date().toISOString() }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Top 10 decision could not be saved.");
      setActionStatus(`Top 10 ${decision}.`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Top 10 decision could not be saved.");
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmTrade() {
    const proposal = v2?.portfolio.proposal;
    if (!v2 || !proposal || !proposal.code || !proposal.shares || actionBusy) return;
    const kind = proposal.action === "buy" || proposal.action === "add" ? "buy" : proposal.action === "trim" || proposal.action === "sell" ? "sell" : null;
    const marketAction = snapshot.urgent.find((item) => item.code === proposal.code);
    const priceSar = kind === "buy" ? (proposal.estimatedSpendSar ?? 0) / proposal.shares : marketAction?.price;
    const name = v2.top10.entries.find((item) => item.code === proposal.code)?.name ?? v2.portfolio.holdings.find((item) => item.code === proposal.code)?.name ?? marketAction?.name;
    if (!kind || !name || !Number.isFinite(priceSar) || !priceSar || !window.confirm(`Record ${kind} of ${proposal.shares} ${proposal.code} at the broker-confirmed price? This records your decision only; it never sends an order.`)) return;
    setActionBusy(true);
    setActionStatus(null);
    try {
      const response = await fetch("/api/portfolio/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: crypto.randomUUID(), kind, code: proposal.code, name, shares: proposal.shares, priceSar, reason: proposal.reason, confirmedAt: new Date().toISOString() }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Trade confirmation could not be recorded.");
      setActionStatus("Broker-confirmed trade recorded. No order was sent by this cockpit.");
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Trade confirmation could not be recorded.");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <main className={styles.cockpit}>
      <header className={styles.header}>
        <div>
          <p className={styles.brand}>TASI ACTION COCKPIT</p>
          <h1>Today’s decisions, without the noise.</h1>
          <p className={styles.subtitle}>Review a clear proposal, understand why it exists, then decide what to do.</p>
        </div>
        <div className={styles.statusPanel}>
          <span className={styles.preview}>Delayed/daily data</span>
          <span className={styles.asOf}>Market observed <time dateTime={snapshot.asOf}>{formatTimestamp(snapshot.asOf)}</time></span>
        </div>
      </header>

      {freshness === "stale" && <section className={styles.staleNote} aria-label="Stale data warning"><p>This is the last successful daily snapshot. The expected pre-open refresh did not arrive, so research is disabled.</p></section>}
      {snapshot.warnings.map((warning) => <section className={styles.staleNote} aria-label="Data quality warning" key={warning}><p>{warning}</p></section>)}
      <section className={styles.safetyNote} aria-label="Trading safety notice">
        <span className={styles.safetyDot} aria-hidden="true" />
        <p>Broker app handles real-time price alerts. This cockpit provides delayed analysis and never sends an order.</p>
      </section>

      {v2 && <>
        <section className={styles.section} aria-labelledby="summary-heading">
          <div className={styles.sectionHeading}><div><p className={styles.kicker}>DISCORD-STYLE DIGEST</p><h2 id="summary-heading">Today&apos;s summary</h2></div></div>
          <ul className={styles.changeList}>{v2.summaryV1?.cards ? v2.summaryV1.cards.map((card) => <li className={styles.changeCard} key={`${card.kind}-${card.state}`}>{card.text}</li>) : v2.summary.map((line) => <li className={styles.changeCard} key={line}>{line}</li>)}</ul>
        </section>
        <section className={styles.section} aria-labelledby="alerts-heading">
          <div className={styles.sectionHeading}><div><p className={styles.kicker}>DELAYED ALERTS</p><h2 id="alerts-heading">Unusual movement</h2></div></div>
          {alerts.length === 0 ? <p className={styles.quiet}>No delayed price movement met the unusualness gate.</p> : <div className={styles.actionList}>{alerts.map((alert) => <article className={styles.actionCard} key={alert.alertId}><p className={styles.actionLabel}>{alert.direction}</p><h3>{alert.code}</h3><p>{alert.reason}</p><p className={styles.reason}>Delayed bot confirmation · observed <time dateTime={alert.observedAt}>{formatTimestamp(alert.observedAt)}</time></p></article>)}</div>}
        </section>
        <section className={styles.section} aria-labelledby="portfolio-heading">
          <div className={styles.sectionHeading}><div><p className={styles.kicker}>CONFIRMED PORTFOLIO</p><h2 id="portfolio-heading">Cash and holdings</h2></div><span className={styles.count}>{v2.portfolio.cashSar.toFixed(2)} SAR cash</span></div>
          <p className={styles.quiet}>Confirmed <time dateTime={v2.portfolio.confirmedAt}>{formatTimestamp(v2.portfolio.confirmedAt)}</time>. Monthly contribution: {v2.portfolio.contributionMonth ?? "not yet confirmed"}.</p>
          {v2.portfolio.proposal ? <article className={styles.actionCard}><p className={styles.actionLabel}>PROPOSAL</p><h3>{v2.portfolio.proposal.action.toUpperCase()} {v2.portfolio.proposal.code ?? ""}</h3><p>{v2.portfolio.proposal.reason}</p><button className={styles.researchButton} disabled={actionBusy} onClick={confirmTrade} type="button">Confirm trade</button></article> : <p className={styles.quiet}>No trade proposal is awaiting confirmation.</p>}
          {actionStatus && <p className={styles.quiet} role="status">{actionStatus}</p>}
        </section>
        <section className={styles.section} aria-labelledby="top10-heading">
          <div className={styles.sectionHeading}><div><p className={styles.kicker}>{v2.top10.status.toUpperCase()} TOP 10</p><h2 id="top10-heading">Evidence-ranked TASI companies</h2></div><span className={styles.candidateNote}>Evidence reviewed <time dateTime={v2.top10.researchedAt}>{formatTimestamp(v2.top10.researchedAt)}</time></span></div>
          {v2.top10.entries.length === 0 ? <p className={styles.quiet}>No researched Top 10 draft is available.</p> : <div className={styles.qualifiedGrid}>{v2.top10.entries.map((entry) => <article className={styles.qualifiedCard} key={entry.code}><p className={styles.symbol}>{entry.code} {entry.owned ? "· Owned" : ""}</p><h3>{entry.name}</h3><p>{entry.sector} · score <strong>{entry.totalScore.toFixed(1)}</strong></p><p className={styles.reason}>{entry.reasons.join(" ")}</p></article>)}</div>}
          {v2.top10.status === "draft" && <div className={styles.actionList}><button className={styles.researchButton} disabled={actionBusy} onClick={() => void decideTop10("approved")} type="button">Approve Top 10</button><button className={styles.researchButton} disabled={actionBusy} onClick={() => void decideTop10("rejected")} type="button">Reject Top 10</button></div>}
        </section>
        <section className={styles.section} aria-labelledby="forecast-heading"><div className={styles.sectionHeading}><div><p className={styles.kicker}>TARGET BEFORE STOP</p><h2 id="forecast-heading">Forecast</h2></div></div>{v2.forecast.status === "unavailable" ? <p className={styles.quiet}>Forecast unavailable: {v2.forecast.reason}</p> : <p className={styles.quiet}>{v2.forecast.targetFirstPct.toFixed(1)}% target-first probability over {v2.forecast.horizonSessions} sessions. Target {formatPrice(v2.forecast.target)} · stop {formatPrice(v2.forecast.stop)}.</p>}</section>
      </>}

      <section className={styles.section} aria-labelledby="urgent-heading">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>PRIORITY</p><h2 id="urgent-heading">Act now</h2></div><span className={styles.count}>{snapshot.urgent.length} to review</span></div>
        {snapshot.urgent.length === 0 ? <p className={styles.quiet}>No holding action crossed a decision level in this daily snapshot.</p> : <div className={styles.actionList}>{snapshot.urgent.map((action) => (
          <article className={styles.actionCard} data-state="urgent" key={action.code}>
            <div className={styles.cardTopline}><span className={styles.actionLabel}>{action.action}</span><span className={styles.price}>{formatPrice(action.price)}</span></div>
            <div className={styles.cardBody}><div><p className={styles.symbol}>{action.code}</p><h3>{action.name}</h3></div><div className={styles.loss}><span>Unrealized P/L</span><strong>{action.pnlPct.toFixed(1)}%</strong></div></div>
            <p className={styles.reason}>{action.reason}</p>
          </article>
        ))}</div>}
      </section>

      <section className={styles.section} aria-labelledby="changed-heading">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>PORTFOLIO</p><h2 id="changed-heading">What changed</h2></div></div>
        {snapshot.changed.length === 0 ? <p className={styles.quiet}>No other holding crossed a decision level in this daily snapshot.</p> : <div className={styles.changeList}>{snapshot.changed.map((change) => <article className={styles.changeCard} data-state="changed" key={change.code}><div><p className={styles.symbol}>{change.code}</p><h3>{change.name}</h3></div><div><p className={styles.changeStatus}>{change.status}</p><p className={styles.changeReason}>{change.reason}</p></div></article>)}</div>}
      </section>

      <section className={styles.section} aria-labelledby="qualified-heading">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>SCANNER</p><h2 id="qualified-heading">Qualified for research</h2></div><span className={styles.candidateNote}>Candidates, not trade instructions</span></div>
        {qualified.length === 0 ? <p className={styles.quiet}>No scanner candidates met both research conditions in this daily snapshot.</p> : <div className={styles.qualifiedGrid}>{qualified.map((candidate) => <article className={styles.qualifiedCard} data-state="qualified" key={candidate.code}><div className={styles.qualifiedHeader}><span className={styles.symbol}>{candidate.code}</span>{candidate.squeeze && <span className={styles.squeeze}>Squeeze</span>}</div><h3>{candidate.name}</h3><p>Relative strength <strong>+{candidate.relativeStrengthPct.toFixed(1)}%</strong></p>{researchEnabled ? <button aria-label={`Research ${candidate.name}`} className={styles.researchButton} onClick={() => setSelectedCandidate(candidate)} type="button">Research this idea →</button> : <p className={styles.researchDisabled}>{freshness === "stale" ? "Research waits for a fresh daily snapshot." : "Research is temporarily disabled."}</p>}</article>)}</div>}
        <p className={styles.researchLink}>Scanner research · {snapshot.researchCount} one-condition names withheld from Home</p>
      </section>

      <footer className={styles.footer}>Automates your rules. Not financial advice. You execute every trade.</footer>
    </main>
  );
}
