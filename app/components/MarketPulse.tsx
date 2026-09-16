import type { MarketPulse as MarketPulseArtifact } from "@/app/lib/market-pulse-core.mjs";
import styles from "./FriendlyCockpit.module.css";

const signed = (value: number | null) => value === null ? "Change unavailable" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

function observedAt(value: string) {
  const formatted = new Intl.DateTimeFormat("en-SA", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
  return `${formatted} Asia/Riyadh`;
}

export function MarketPulse({ pulse }: { pulse?: MarketPulseArtifact | null }) {
  return <section className={styles.marketPulse} aria-label="Delayed market pulse">
    <div className={styles.pulseHead}>
      <div><p className={styles.eyebrow}>DELAYED MARKET PULSE</p><h2>Latest observed prices</h2></div>
      <span>5-minute delayed quote · not real time</span>
    </div>
    {!pulse ? <p className={styles.emptyEvidence}>No delayed market pulse has been ingested yet. The daily snapshot remains available below.</p>
      : pulse.status === "failed" ? <p className={styles.pulseUnavailable}>The delayed quote fetch failed. The last saved daily snapshot remains visible; no empty result is implied.</p>
      : pulse.status === "empty" ? <p className={styles.emptyEvidence}>The provider returned a valid empty delayed quote set.</p>
      : <div className={styles.pulseGrid}>{pulse.quotes.map((quote) => <article className={styles.pulseQuote} key={quote.code}>
          <div><strong>{quote.name}</strong><span>{quote.code}</span></div>
          <p>{quote.price.toLocaleString("en-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</p>
          <span data-direction={(quote.changePct ?? 0) < 0 ? "down" : "up"}>{signed(quote.changePct)} since prior close</span>
          <small>Observed {observedAt(quote.observedAt)}</small>
        </article>)}</div>}
  </section>;
}
