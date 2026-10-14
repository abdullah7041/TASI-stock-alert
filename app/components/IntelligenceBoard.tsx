import type { DashboardPayload } from "@/app/lib/dashboard-types";
import type { MovementAlert } from "@/app/lib/evidence-types";
import { buildMarketIntelligence } from "@/app/lib/market-intelligence.mjs";
import { formatCockpitTimestamp } from "./AlertBoard";
import styles from "./FriendlyCockpit.module.css";

const signed = (value: number | null) => value === null ? "Unavailable" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

export function IntelligenceBoard({ snapshot, alerts, marketPulse, currentOnly = false }: { snapshot: DashboardPayload["snapshot"]; alerts: MovementAlert[]; marketPulse?: DashboardPayload["marketPulse"]; currentOnly?: boolean }) {
  const intelligence = buildMarketIntelligence(snapshot, alerts, marketPulse);
  if (currentOnly) {
    const cutoff = Date.parse(`${snapshot.expectedPriceDate ?? snapshot.tradeDate}T00:00:00+03:00`);
    const through = Date.parse(snapshot.asOf);
    intelligence.events = intelligence.events.filter(event => {
      const published = Date.parse(event.publishedAt ?? "");
      return Number.isFinite(published) && published >= cutoff && published <= through;
    });
    intelligence.anomalies = intelligence.anomalies.filter(alert => {
      const observed = Date.parse(alert.observedAt);
      return observed >= cutoff && observed <= Math.max(through, Date.parse(`${snapshot.tradeDate}T23:59:59+03:00`));
    });
    if (!intelligence.events.length && !intelligence.anomalies.length) return <p className={styles.sectionNote}>
      No current verified event is linked. Source availability is shown in company details; earlier movements remain in history.
    </p>;
  }
  return <section className={styles.intelligence} aria-label="Market intelligence">
    <div className={styles.sectionHead}>
      <div><p className={styles.eyebrow}>MARKET INTELLIGENCE</p><h2>Events and unusual moves</h2></div>
      <span className={styles.evidenceCount}>{intelligence.events.length} verified · {intelligence.anomalies.length} unusual</span>
    </div>
    <div className={styles.intelligenceStack}>
      <section className={styles.evidenceGroup} aria-labelledby="verified-events-heading">
        <div className={styles.evidenceGroupHead}><h3 id="verified-events-heading">Verified events</h3><span>Observed reaction</span></div>
        {intelligence.events.length ? intelligence.events.slice(0, 3).map((event) => <article className={styles.eventCard} key={event.id}>
          <div className={styles.eventMeta}><span className={styles.pill} data-tone="green">Verified {event.sourceClass}</span><span>{event.publishedAt ?? "Publication time unavailable"}</span></div>
          <h3>{event.title}</h3>
          <div className={styles.reactionGrid}>{event.related.slice(0, 6).map((stock) => <div key={stock.code}>
            <strong>{stock.name}</strong><span>{stock.code} · {signed(stock.changePct)}</span><small>{stock.observedAt ? `Observed ${formatCockpitTimestamp(stock.observedAt)} · since prior close` : stock.priceDate ? `Daily price ${stock.priceDate}` : "Price date unavailable"}</small>
          </div>)}</div>
          <p className={styles.honesty}>{event.reactionWindow === "delayed-intraday" ? "These delayed quotes were observed after the event publication time and show change since the prior close; causation is not proven." : "These moves were observed in the saved daily data; causation is not proven. An after-publication delayed quote is not available."}</p>
          <a href={event.sourceUrl} target="_blank" rel="noreferrer">Open verified source ↗</a>
        </article>) : <p className={styles.emptyEvidence}>No verified event is available in this snapshot. Social leads are not shown here until verified.</p>}
      </section>
      <section className={styles.evidenceGroup} aria-labelledby="unexplained-moves-heading">
        <div className={styles.evidenceGroupHead}><h3 id="unexplained-moves-heading">Unusual moves</h3><span>Kept separate from news</span></div>
        {intelligence.anomalies.length ? intelligence.anomalies.slice(0, 3).map((anomaly) => <article className={styles.anomalyCard} key={anomaly.alertId}>
          <div className={styles.eventMeta}><span className={styles.pill} data-tone={anomaly.status === "unexplained" ? "warning" : "blue"}>{anomaly.status === "unexplained" ? "No verified explanation" : "News also present"}</span><span>{anomaly.observedAt}</span></div>
          <h3>{anomaly.name} <small>{anomaly.code}</small></h3>
          <p><strong>{signed(anomaly.excessMovePct)}</strong> excess move · robust z {anomaly.robustZ.toFixed(1)} · volume {anomaly.volumeRatio?.toFixed(1) ?? "unavailable"}×</p>
          <p className={styles.honesty}>{anomaly.explanation}</p>
        </article>) : <p className={styles.emptyEvidence}>No delayed unusual-movement observation is stored.</p>}
      </section>
    </div>
  </section>;
}
