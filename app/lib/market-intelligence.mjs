const verifiedHosts = new Map([
  ["saudiexchange.sa", "official"],
  ["cma.org.sa", "official"],
  ["ia.gov.sa", "official"],
  ["sama.gov.sa", "official"],
  ["reuters.com", "trusted"],
  ["bloomberg.com", "trusted"],
  ["argaam.com", "trusted"],
]);

function sourceClass(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    for (const [host, classification] of verifiedHosts) {
      if (url.hostname === host || url.hostname.endsWith(`.${host}`)) return classification;
    }
  } catch {
    return null;
  }
  return null;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordNewsStatus(record) {
  if (record?.news?.ok === false || record?.news?.status === "failed") return "failed";
  const headlines = Array.isArray(record?.news?.headlines) ? record.news.headlines : [];
  return headlines.length ? "available" : "empty";
}

export function buildMarketIntelligence(snapshot, alerts) {
  const records = Array.isArray(snapshot?.digestRecords) ? snapshot.digestRecords : [];
  const grouped = new Map();

  for (const record of records) {
    for (const headline of Array.isArray(record?.news?.headlines) ? record.news.headlines : []) {
      const classification = sourceClass(headline?.link);
      if (!classification || typeof headline?.title !== "string" || !headline.title.trim()) continue;
      const key = headline.link;
      const event = grouped.get(key) ?? {
        id: key,
        title: headline.title.trim(),
        sourceUrl: headline.link,
        sourceClass: classification,
        verification: "verified",
        publishedAt: typeof headline.published === "string" ? headline.published : null,
        reactionWindow: "daily-close",
        causation: "not-proven",
        related: [],
      };
      if (!event.related.some((item) => item.code === record.code)) {
        event.related.push({
          code: String(record.code ?? ""),
          name: String(record.name ?? record.code ?? "Unknown"),
          changePct: finite(record?.delta?.price_pct),
          priceDate: typeof record.priceDate === "string" ? record.priceDate : null,
        });
      }
      grouped.set(key, event);
    }
  }

  const events = [...grouped.values()].map((event) => ({
    ...event,
    breadth: event.related.reduce((counts, item) => {
      if (item.changePct === null) counts.unavailable += 1;
      else if (item.changePct > 0) counts.positive += 1;
      else if (item.changePct < 0) counts.negative += 1;
      return counts;
    }, { positive: 0, negative: 0, unavailable: 0 }),
  }));
  const codesWithVerifiedNews = new Set(events.flatMap((event) => event.related.map((item) => item.code)));

  const anomalies = (Array.isArray(alerts) ? alerts : []).map((alert) => {
    const newsStatus = recordNewsStatus(records.find((record) => record.code === alert.code));
    const eventLinked = codesWithVerifiedNews.has(alert.code);
    const explanation = eventLinked
      ? "Verified news exists in the same snapshot; the relationship to this move remains unproven."
      : newsStatus === "failed"
        ? "News retrieval failed, so the move cannot be classified as having no news."
        : "No timely verified news is linked yet. A later disclosure must retain its original publication time."
    return {
      ...alert,
      status: eventLinked ? "event-linked" : "unexplained",
      newsStatus,
      volumeConfirmed: finite(alert.volumeRatio) !== null && alert.volumeRatio >= 2,
      explanation,
    };
  });

  return { events, anomalies };
}

