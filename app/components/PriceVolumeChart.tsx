"use client";

import { useId, useState } from "react";
import type { MarketChart } from "@/app/lib/dashboard-types";
import styles from "./ActionCockpit.module.css";

function levelText(levels: Record<string, number>) {
  return ["stop", "trim", "target"].flatMap((key) => typeof levels[key] === "number" ? [`${key[0].toUpperCase()}${key.slice(1)} ${levels[key].toFixed(2)}`] : []).join(" · ");
}

export function PriceVolumeChart({ chart }: { chart: MarketChart }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  if (chart.status === "unavailable") {
    return <article className={styles.chartUnavailable} aria-label={`${chart.name} chart unavailable`}><strong>{chart.name}</strong><span>{chart.reason}</span></article>;
  }
  const bars = chart.bars;
  const levels = chart.levels as Record<string, number>;
  const prices = [...bars.map((bar) => bar.Low), ...bars.map((bar) => bar.High), ...Object.values(levels)];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const left = 36;
  const width = 520;
  const priceBottom = 146;
  const priceTop = 14;
  const volumeTop = 166;
  const volumeBottom = 212;
  const x = (index: number) => left + (index / Math.max(bars.length - 1, 1)) * width;
  const y = (value: number) => priceBottom - ((value - min) / span) * (priceBottom - priceTop);
  const maxVolume = Math.max(...bars.map((bar) => bar.Volume), 1);
  const points = bars.map((bar, index) => `${x(index)},${y(bar.Close)}`).join(" ");

  return <article className={styles.chartCard} data-code={chart.code}>
    <div className={styles.chartHeader}>
      <div><h3 className={styles.companyName}>{chart.name}</h3><p className={styles.symbol}>({chart.code}) · last {bars.length} daily sessions</p></div>
      <button aria-controls={panelId} aria-expanded={expanded} className={styles.chartToggle} onClick={() => setExpanded((open) => !open)} type="button">
        {expanded ? "Hide" : "Show"} 3-month chart for {chart.name}
      </button>
    </div>
    <p className={styles.chartMeta}>{levelText(levels) || "No stop, trim, or target levels are available."}</p>
    {expanded && <div className={styles.chartPanel} id={panelId}>
      <svg aria-label={`${chart.name} 3-month price and volume chart`} className={styles.chartSvg} role="img" viewBox="0 0 590 232">
        <title>{chart.name} delayed daily price and volume chart</title>
        {[0, 0.5, 1].map((ratio) => <line key={ratio} x1={left} x2={left + width} y1={priceBottom - ratio * (priceBottom - priceTop)} y2={priceBottom - ratio * (priceBottom - priceTop)} className={styles.chartGridLine} />)}
        {Object.entries(levels).map(([name, value]) => <g key={name}><line x1={left} x2={left + width} y1={y(value)} y2={y(value)} className={`${styles.chartLevel} ${styles[`chartLevel${name[0].toUpperCase()}${name.slice(1)}`] ?? ""}`} /><text x={left + width - 2} y={y(value) - 3} textAnchor="end" className={styles.chartLabel}>{name} {value.toFixed(2)}</text></g>)}
        <polyline fill="none" points={points} className={styles.chartLine} />
        {bars.map((bar, index) => <rect key={bar.date} x={x(index) - Math.max(1, 260 / bars.length)} y={volumeBottom - (bar.Volume / maxVolume) * (volumeBottom - volumeTop)} width={Math.max(2, 430 / bars.length)} height={(bar.Volume / maxVolume) * (volumeBottom - volumeTop)} className={bar.Close >= bar.Open ? styles.chartVolumeUp : styles.chartVolumeDown} />)}
        <text x={left} y="228" className={styles.chartAxis}>{bars[0].date}</text><text x={left + width} y="228" textAnchor="end" className={styles.chartAxis}>{bars[bars.length - 1].date}</text>
      </svg>
      <p className={styles.chartCaption}>Delayed daily OHLCV. Volume is shown below price; confirm real-time values in your broker app.</p>
    </div>}
  </article>;
}
