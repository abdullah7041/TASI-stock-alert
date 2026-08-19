"use client";

import { useId, useState } from "react";
import type { MovementAlert } from "@/app/lib/evidence-types";
import styles from "./ActionCockpit.module.css";

/** Repeated observations of one company, newest first. */
export type AlertGroup = {
  code: string;
  name: string;
  latest: MovementAlert;
  history: MovementAlert[];
};

const VOLUME_CONFIRMATION_RATIO = 2;

export function formatCockpitTimestamp(timestamp: string) {
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime())
    ? timestamp
    : `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(value)} Riyadh`;
}

/**
 * One card per company rather than one per event: the same name moving four
 * times in an hour is one thing to look at, not four.
 */
export function groupAlertsByCompany(alerts: MovementAlert[]): AlertGroup[] {
  const groups = new Map<string, MovementAlert[]>();
  for (const alert of alerts) {
    const existing = groups.get(alert.code);
    if (existing) existing.push(alert);
    else groups.set(alert.code, [alert]);
  }
  return [...groups.values()]
    .map((events) => {
      const ordered = [...events].sort((left, right) => right.observedAt.localeCompare(left.observedAt));
      const [latest, ...history] = ordered;
      return { code: latest.code, name: latest.name, latest, history };
    })
    .sort((left, right) => right.latest.observedAt.localeCompare(left.latest.observedAt));
}

function AlertDetail({ alert }: { alert: MovementAlert }) {
  const move = `${alert.excessMovePct > 0 ? "+" : ""}${alert.excessMovePct.toFixed(1)}%`;
  return (
    <dl className={styles.alertFacts}>
      <div><dt>Direction</dt><dd>{alert.direction}</dd></div>
      <div><dt>Excess movement</dt><dd>{move} beyond its own recent baseline</dd></div>
      <div><dt>Robust-Z score</dt><dd>{alert.robustZ.toFixed(1)}</dd></div>
      {typeof alert.volumeRatio === "number" && (
        <div>
          <dt>Volume</dt>
          <dd>{alert.volumeRatio >= VOLUME_CONFIRMATION_RATIO ? `Confirmed at ${alert.volumeRatio.toFixed(1)}× the median` : `${alert.volumeRatio.toFixed(1)}× the median, not confirming`}</dd>
        </div>
      )}
      <div><dt>Observed</dt><dd><time dateTime={alert.observedAt}>{formatCockpitTimestamp(alert.observedAt)}</time></dd></div>
      <div><dt>Received</dt><dd><time dateTime={alert.receivedAt}>{formatCockpitTimestamp(alert.receivedAt)}</time></dd></div>
      <div><dt>Reason</dt><dd>{alert.reason}</dd></div>
    </dl>
  );
}

function AlertCard({ group }: { group: AlertGroup }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const count = group.history.length + 1;

  return (
    <article className={styles.alertCard} data-code={group.code}>
      <h3 className={styles.alertHeading}>
        {/* A button, not a div with a click handler: Enter, Space and focus
            order all have to work without re-implementing them here. */}
        <button aria-controls={detailsId} aria-expanded={expanded} className={styles.alertToggle} onClick={() => setExpanded((open) => !open)} type="button">
          <span className={styles.companyName}>{group.name}</span>
          <span className={styles.symbol}>({group.code})</span>
          <span className={styles.alertDirection}>{group.latest.direction}</span>
          <span className={styles.count}>{count} {count === 1 ? "event" : "events"}</span>
        </button>
      </h3>
      <p className={styles.reason}>
        Latest observed <time dateTime={group.latest.observedAt}>{formatCockpitTimestamp(group.latest.observedAt)}</time>
      </p>
      {expanded && (
        <div className={styles.alertDetails} id={detailsId}>
          <p className={styles.staleNote}>Delayed data: this is a delayed bot confirmation, not a live quote. Check your broker app before acting.</p>
          <AlertDetail alert={group.latest} />
          {group.history.length > 0 && (
            <section aria-label={`Earlier observations for ${group.name}`} className={styles.alertHistory}>
              <h4>Earlier observations ({group.history.length})</h4>
              {group.history.map((alert) => (
                <div className={styles.alertHistoryItem} key={alert.alertId}>
                  <p className={styles.reason}>
                    <time dateTime={alert.observedAt}>{formatCockpitTimestamp(alert.observedAt)}</time>
                  </p>
                  <AlertDetail alert={alert} />
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </article>
  );
}

export function AlertBoard({ alerts }: { alerts: MovementAlert[] }) {
  const groups = groupAlertsByCompany(alerts);

  return (
    <section className={styles.section} aria-labelledby="alerts-heading">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>DELAYED ALERTS</p><h2 id="alerts-heading">Unusual movement</h2></div>
        <span className={styles.count}>{groups.length} {groups.length === 1 ? "company" : "companies"}</span>
      </div>
      {groups.length === 0
        ? <p className={styles.quiet}>No delayed price movement met the unusualness gate.</p>
        : <div className={styles.actionList}>{groups.map((group) => <AlertCard group={group} key={group.code} />)}</div>}
    </section>
  );
}
