"use client";

import { useCallback, useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { EvidenceReviewForm } from "./EvidenceReviewForm";
import type { Candidate, DashboardPayload, DashboardSnapshotV2, DashboardSnapshotV3 } from "@/app/lib/dashboard-types";
import { AlertBoard, formatCockpitTimestamp } from "./AlertBoard";
import styles from "./ActionCockpit.module.css";
import { ResearchWorkspace } from "./ResearchWorkspace";
import { PriceVolumeChart } from "./PriceVolumeChart";

type DashboardState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; payload: DashboardPayload };

function formatPrice(price: number) {
  return `${price.toFixed(2)} SAR`;
}

const formatTimestamp = formatCockpitTimestamp;

function LoadingCockpit() {
  return <main className={styles.cockpit}><p className={styles.subtitle}>Loading the latest saved daily digest…</p></main>;
}

function UnavailableCockpit({ message }: { message: string }) {
  return <main className={styles.cockpit}><p className={styles.brand}>TASI ACTION COCKPIT</p><h1>No verified daily snapshot is available.</h1><p className={styles.subtitle}>{message} The cockpit will show data after the next successful pre-open digest.</p></main>;
}

function isV2(snapshot: DashboardPayload["snapshot"]): snapshot is DashboardSnapshotV2 | DashboardSnapshotV3 {
  return snapshot.schemaVersion === 2 || snapshot.schemaVersion === 3;
}

function isV3(snapshot: DashboardPayload["snapshot"]): snapshot is DashboardSnapshotV3 {
  return snapshot.schemaVersion === 3;
}

/**
 * One compact line per supporting surface. The cockpit used to render a full
 * empty section for every one of these; a reader then had to scroll past four
 * "nothing here" panels to reach the alerts that actually changed.
 */
function StatusRow({ children, label, state, summary }: { children?: ReactNode; label: string; state: string; summary: string }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const expandable = Boolean(children);

  return (
    <div className={styles.statusRow} data-label={label}>
      {expandable ? (
        <button aria-controls={detailsId} aria-expanded={expanded} className={styles.statusToggle} onClick={() => setExpanded((open) => !open)} type="button">
          <span className={styles.statusLabel}>{label}</span>
          <span className={styles.statusState}>{state}</span>
          <span className={styles.statusSummary}>{summary}</span>
        </button>
      ) : (
        <p className={styles.statusStatic}>
          <span className={styles.statusLabel}>{label}</span>
          <span className={styles.statusState}>{state}</span>
          <span className={styles.statusSummary}>{summary}</span>
        </p>
      )}
      {expandable && expanded && <div className={styles.statusDetails} id={detailsId}>{children}</div>}
    </div>
  );
}

export function ActionCockpit({ dashboard }: { dashboard: DashboardPayload | null }) {
  const [state, setState] = useState<DashboardState>(() => dashboard ? { kind: "ready", payload: dashboard } : { kind: "loading" });
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setRefreshBusy(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const payload = await response.json() as DashboardPayload & { error?: string };
      if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "No verified daily snapshot is available.");
      setState({ kind: "ready", payload });
      setRefreshError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The daily dashboard could not be loaded.";
      setState((current) => current.kind === "ready" ? current : { kind: "unavailable", message });
      setRefreshError(`Refresh failed: ${message}. Showing the last good view.`);
    } finally {
      setRefreshBusy(false);
    }
  }, []);

  useEffect(() => {
    // Schedule after paint: the existing server/last-good payload stays visible
    // while the client confirms it, instead of causing a synchronous effect update.
    const initialRefresh = window.setTimeout(() => { void loadDashboard(); }, 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadDashboard();
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadDashboard]);

  if (selectedCandidate) return <ResearchWorkspace candidate={selectedCandidate} onClose={() => setSelectedCandidate(null)} />;
  if (state.kind === "loading") return <LoadingCockpit />;
  if (state.kind === "unavailable") return <UnavailableCockpit message={state.message} />;

  const { snapshot, freshness } = state.payload;
  const alerts = state.payload.alerts;
  const qualified = snapshot.qualified.slice(0, 3);
  const researchEnabled = freshness === "current" && import.meta.env.VITE_AGENT_ENABLED !== "false";
  const v2 = isV2(snapshot) ? snapshot : null;
  const v3 = isV3(snapshot) ? snapshot : null;
  const top10Review = v3?.top10Review ?? (v2?.top10.status === "draft" ? v2.top10 : null);
  const delivery = state.payload.delivery ?? { producer: { status: "confirmed" as const, attemptedAt: snapshot.asOf }, discord: { status: "unknown" as const }, cockpit: { status: "unknown" as const } };
  const decidedCount = snapshot.urgent.length + snapshot.changed.length;

  async function decideTop10(decision: "approved" | "rejected") {
    if (!top10Review || top10Review.status !== "draft" || top10Review.entries.length === 0 || actionBusy) return;
    setActionBusy(true);
    setActionStatus(null);
    try {
      const response = await fetch("/api/top10/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: top10Review.proposalId, decision, decidedAt: new Date().toISOString() }) });
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

  const portfolioSummary = v2
    ? `${v2.portfolio.cashSar.toFixed(2)} SAR cash · ${decidedCount === 0 ? "no holding crossed a decision level" : `${decidedCount} holding update${decidedCount === 1 ? "" : "s"}`}`
    : decidedCount === 0 ? "No holding crossed a decision level in this daily snapshot." : `${decidedCount} holding updates`;

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
          <button aria-label="Refresh cockpit" className={styles.refreshButton} disabled={refreshBusy} onClick={() => void loadDashboard()} type="button">{refreshBusy ? "Refreshing…" : "Refresh"}</button>
        </div>
      </header>

      {refreshError && <section className={styles.staleNote} aria-live="polite" role="status"><p>{refreshError}</p></section>}
      {freshness === "stale" && <section className={styles.staleNote} aria-label="Stale data warning"><p>This is the last successful daily snapshot. The expected pre-open refresh did not arrive, so research is disabled.</p></section>}
      {snapshot.warnings.map((warning) => <section className={styles.staleNote} aria-label="Data quality warning" key={warning}><p>{warning}</p></section>)}
      <section className={styles.safetyNote} aria-label="Trading safety notice">
        <span className={styles.safetyDot} aria-hidden="true" />
        <p>Broker app handles real-time price alerts. This cockpit provides delayed analysis and never sends an order.</p>
      </section>

      {/* The alert board leads: it is the only surface that changes during a
          session, so it must not sit below four mostly-empty panels. */}
      <AlertBoard alerts={alerts} tradeDate={snapshot.tradeDate} />

      {v2 && (
        <section className={styles.section} aria-labelledby="summary-heading">
          <div className={styles.sectionHeading}><div><p className={styles.kicker}>DISCORD-STYLE DIGEST</p><h2 id="summary-heading">Today&apos;s summary</h2></div></div>
          <ul className={styles.changeList}>{v2.summaryV1?.cards ? v2.summaryV1.cards.map((card) => <li className={styles.changeCard} key={`${card.kind}-${card.state}`}>{card.text}</li>) : v2.summary.map((line) => <li className={styles.changeCard} key={line}>{line}</li>)}</ul>
        </section>
      )}

      {v3 && <section className={styles.section} aria-labelledby="charts-heading">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>CANONICAL ARTIFACT</p><h2 id="charts-heading">Three-month charts</h2></div></div>
        <div className={styles.chartGrid}>{v3.charts.map((chart) => <PriceVolumeChart chart={chart} key={chart.code} />)}</div>
      </section>}

      <section className={styles.section} aria-labelledby="status-rail-heading">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>SUPPORTING STATE</p><h2 id="status-rail-heading">Everything else, in one line each</h2></div></div>
        <div className={styles.statusRail}>
          <StatusRow label="Delivery" state={delivery.discord.status === "confirmed" && delivery.cockpit.status === "confirmed" ? "confirmed" : "pending"} summary={`Producer ${delivery.producer.status} · Discord ${delivery.discord.status} · Cockpit ${delivery.cockpit.status}`}>
            <p className={styles.quiet}>Artifact {v3?.artifactId ?? "legacy snapshot"}. Discord is confirmed only by an authenticated receipt, not by a green workflow.</p>
          </StatusRow>
          {v3 && <StatusRow label="Gemini lean" state={v3.leanStatus.ok ? "available" : "unavailable"} summary={v3.leanStatus.ok ? `${v3.leanStatus.model ?? "Gemini"} · optional model judgement` : v3.leanStatus.reason ?? "No Gemini lean was produced."}>
            <p className={styles.quiet}>{v3.leanStatus.ok ? `Provider: ${v3.leanStatus.provider}. Model judgement is scored daily and never gates a buy.` : `Gemini unavailable: ${v3.leanStatus.reason}`}</p>
          </StatusRow>}
          <StatusRow
            label="Portfolio"
            state={decidedCount === 0 ? "quiet" : "updated"}
            summary={portfolioSummary}
          >
            {v2 && <p className={styles.quiet}>Confirmed <time dateTime={v2.portfolio.confirmedAt}>{formatTimestamp(v2.portfolio.confirmedAt)}</time>. Monthly contribution: {v2.portfolio.contributionMonth ?? "not yet confirmed"}.</p>}
            {snapshot.urgent.length === 0 ? <p className={styles.quiet}>No holding action crossed a decision level in this daily snapshot.</p> : <div className={styles.actionList}>{snapshot.urgent.map((action) => (
              <article className={styles.actionCard} data-state="urgent" key={action.code}>
                <div className={styles.cardTopline}><span className={styles.actionLabel}>{action.action}</span><span className={styles.price}>{formatPrice(action.price)}</span></div>
                <div className={styles.cardBody}><div><h3 className={styles.companyName}>{action.name}</h3><p className={styles.symbol}>({action.code})</p></div><div className={styles.loss}><span>Unrealized P/L</span><strong>{action.pnlPct.toFixed(1)}%</strong></div></div>
                <p className={styles.reason}>{action.reason}</p>
              </article>
            ))}</div>}
            {snapshot.changed.length === 0 ? <p className={styles.quiet}>No other holding crossed a decision level in this daily snapshot.</p> : <div className={styles.changeList}>{snapshot.changed.map((change) => <article className={styles.changeCard} data-state="changed" key={change.code}><div><h3 className={styles.companyName}>{change.name}</h3><p className={styles.symbol}>({change.code})</p></div><div><p className={styles.changeStatus}>{change.status}</p><p className={styles.changeReason}>{change.reason}</p></div></article>)}</div>}
            {v2?.portfolio.proposal
              ? <article className={styles.actionCard}><p className={styles.actionLabel}>PROPOSAL</p><h3>{v2.portfolio.proposal.action.toUpperCase()} {v2.portfolio.proposal.code ?? ""}</h3><p>{v2.portfolio.proposal.reason}</p><button className={styles.researchButton} disabled={actionBusy} onClick={confirmTrade} type="button">Confirm trade</button></article>
              : <p className={styles.quiet}>No trade proposal is awaiting confirmation.</p>}
            {actionStatus && <p className={styles.quiet} role="status">{actionStatus}</p>}
          </StatusRow>

          {v2 && <StatusRow
            label="Top 10"
            state={v2.top10.entries.length === 0 ? "evidence pending" : v2.top10.status}
            summary={v2.top10.entries.length === 0 ? "No researched Top 10 draft is available." : `${v2.top10.entries.length} researched names · evidence reviewed ${formatTimestamp(v2.top10.researchedAt)}`}
          >
            <p className={styles.candidateNote}>Evidence reviewed <time dateTime={v2.top10.researchedAt}>{formatTimestamp(v2.top10.researchedAt)}</time></p>
            {v2.top10.entries.length === 0
              ? <p className={styles.quiet}>No researched Top 10 draft is available, so there is nothing to approve or reject.</p>
              : <>
                <div className={styles.qualifiedGrid}>{v2.top10.entries.map((entry) => <article className={styles.qualifiedCard} key={entry.code}><h3 className={styles.companyName}>{entry.name}</h3><p className={styles.symbol}>({entry.code}){entry.owned ? " · Owned" : ""}</p><p>{entry.sector} · score <strong>{entry.totalScore.toFixed(1)}</strong></p><p className={styles.reason}>{entry.reasons.join(" ")}</p></article>)}</div>
                {/* Approval controls exist only when there is something to approve. */}
                {top10Review?.status === "draft" && <div className={styles.actionList}><p className={styles.candidateNote}>{v2.top10.status === "approved" ? "A researched replacement is awaiting approval; the approved list remains active until then." : "Research draft awaiting approval."}</p><button className={styles.researchButton} disabled={actionBusy} onClick={() => void decideTop10("approved")} type="button">Approve Top 10</button><button className={styles.researchButton} disabled={actionBusy} onClick={() => void decideTop10("rejected")} type="button">Reject Top 10</button></div>}
              </>}
            <EvidenceReviewForm />
          </StatusRow>}

          {v2 && <StatusRow
            label="Forecast"
            state={v2.forecast.status}
            summary={v2.forecast.status === "unavailable" ? `Forecast unavailable: ${v2.forecast.reason}` : `${v2.forecast.targetFirstPct.toFixed(1)}% target-first probability over ${v2.forecast.horizonSessions} sessions.`}
          >
            {v2.forecast.status === "unavailable"
              ? <p className={styles.quiet}>Forecast unavailable: {v2.forecast.reason}</p>
              : <p className={styles.quiet}>{v2.forecast.targetFirstPct.toFixed(1)}% target-first probability over {v2.forecast.horizonSessions} sessions. Target {formatPrice(v2.forecast.target)} · stop {formatPrice(v2.forecast.stop)}.</p>}
          </StatusRow>}

          <StatusRow
            label="Scanner"
            state={qualified.length === 0 ? "no candidates" : "candidates"}
            summary={qualified.length === 0 ? "No scanner candidates met both research conditions in this daily snapshot." : `${qualified.length} qualified · ${snapshot.researchCount} one-condition names withheld`}
          >
            <p className={styles.candidateNote}>Candidates, not trade instructions</p>
            {qualified.length === 0
              ? <p className={styles.quiet}>No scanner candidates met both research conditions in this daily snapshot.</p>
              : <div className={styles.qualifiedGrid}>{qualified.map((candidate) => <article className={styles.qualifiedCard} data-state="qualified" key={candidate.code}><div className={styles.qualifiedHeader}><span className={styles.symbol}>({candidate.code})</span>{candidate.squeeze && <span className={styles.squeeze}>Squeeze</span>}</div><h3 className={styles.companyName}>{candidate.name}</h3><p>Relative strength <strong>+{candidate.relativeStrengthPct.toFixed(1)}%</strong></p>{researchEnabled ? <button aria-label={`Research ${candidate.name}`} className={styles.researchButton} onClick={() => setSelectedCandidate(candidate)} type="button">Research this idea →</button> : <p className={styles.researchDisabled}>{freshness === "stale" ? "Research waits for a fresh daily snapshot." : "Research is temporarily disabled."}</p>}</article>)}</div>}
            <p className={styles.researchLink}>Scanner research · {snapshot.researchCount} one-condition names withheld from Home</p>
          </StatusRow>
        </div>
      </section>

      <footer className={styles.footer}>Automates your rules. Not financial advice. You execute every trade.</footer>
    </main>
  );
}
