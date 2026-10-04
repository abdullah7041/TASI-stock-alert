const INDEX = "^TASI.SR";
const INTERVAL_MINUTES = 5;
const DECLARED_DELAY_MINUTES = 15;
const REGIME_BARS = 52; // 50-session MA plus two sessions for its direction.
const riyadhDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" });
const riyadhHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", hourCycle: "h23" });

const iso = (value) => new Date(value).toISOString().replace(".000Z", "Z");
const validCode = (code) => typeof code === "string" && /^\d{4}$/.test(code);

export function selectTrackedCodes(snapshot, approved) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const holdingCodes = snapshot.portfolio?.holdings?.map((item) => item.code) ?? [];
  const watchCodes = snapshot.digestRecords?.filter((item) => item.kind === "watchlist").map((item) => item.code) ?? [];
  const top10Codes = approved?.status === "approved" ? approved.entries?.map((item) => item.code) ?? [] : [];
  return [...new Set([...holdingCodes, ...watchCodes, ...top10Codes].filter(validCode))];
}

export function extractYahooBars(payload, expectedSymbol, interval) {
  const result = payload?.chart?.error ? null : payload?.chart?.result?.[0];
  if (!result || result.meta?.symbol !== expectedSymbol) throw new Error("Yahoo chart symbol is unavailable or mismatched.");
  if (result.meta?.currency !== "SAR" || result.meta?.exchangeName !== "SAU" || result.meta?.exchangeTimezoneName !== "Asia/Riyadh") {
    throw new Error("Yahoo chart is not qualified Saudi market data.");
  }
  if (result.meta?.dataGranularity !== interval) throw new Error("Yahoo chart interval is mismatched.");
  const times = result.timestamp;
  const closes = result.indicators?.quote?.[0]?.close;
  if (!Array.isArray(times) || !Array.isArray(closes) || times.length !== closes.length) throw new Error("Yahoo chart bars are missing.");
  return times.flatMap((seconds, i) => Number.isFinite(seconds) && Number.isFinite(closes[i]) && closes[i] > 0
    ? [{ at: new Date(seconds * 1000).toISOString(), close: closes[i] }] : []);
}

function usableBar(frame, fetchedAt) {
  if (!Array.isArray(frame)) return null;
  const now = Date.parse(fetchedAt);
  const completed = frame.filter((bar) => Number.isFinite(Date.parse(bar.at)) && Number.isFinite(bar.close)
    && bar.close > 0 && Date.parse(bar.at) + INTERVAL_MINUTES * 60_000 <= now)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (completed.length < 2) return null;
  const latest = completed.at(-1), previous = completed.at(-2);
  if (now - Date.parse(latest.at) > (DECLARED_DELAY_MINUTES + INTERVAL_MINUTES * 2) * 60_000) return null;
  return { price: Math.round(latest.close * 10_000) / 10_000,
    changePct: Math.round((latest.close / previous.close - 1) * 1_000_000) / 10_000,
    latestBarAt: iso(latest.at) };
}

function marketRegime(daily, fetchedAt) {
  const day = riyadhDay.format(new Date(fetchedAt));
  const closed = Number(riyadhHour.format(new Date(fetchedAt))) >= 15;
  const seen = new Set();
  const completed = (Array.isArray(daily) ? daily : []).filter((bar) => {
    if (!Number.isFinite(Date.parse(bar.at)) || !Number.isFinite(bar.close) || bar.close <= 0) return false;
    const session = riyadhDay.format(new Date(bar.at));
    if (session > day || (session === day && !closed) || seen.has(session)) return false;
    seen.add(session);
    return true;
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (completed.length < REGIME_BARS) return { status: "unavailable", reason: `Market regime unavailable: the index returned ${completed.length} usable daily bars; ${REGIME_BARS} are required.` };
  const closes = completed.map((bar) => bar.close);
  const mean = (items) => items.reduce((sum, price) => sum + price, 0) / items.length;
  const maNow = mean(closes.slice(-50)), maPrevious = mean(closes.slice(-51, -1));
  return { status: "available", label: closes.at(-1) < maNow && maNow < maPrevious ? "breakdown" : "ok", bars: completed.length };
}

export function buildMarketPulse({ frames = {}, daily = [], tracked = [], fetchedAt, prior = null, errors = [] }) {
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error("Fetch time is invalid.");
  const codes = [...new Set(tracked.filter(validCode))];
  const required = Math.ceil(codes.length * 0.7);
  const indexBar = usableBar(frames[INDEX], fetchedAt);
  const observations = codes.flatMap((code) => {
    const bar = usableBar(frames[code], fetchedAt);
    return bar ? [{ code, ...bar }] : [];
  });
  const coverage = { tracked: codes.length, usable: observations.length, required };
  const common = { schemaVersion: 1, artifactKind: "market-pulse", source: "yahoo-probe", dataStatus: "delayed-intraday",
    intervalMinutes: INTERVAL_MINUTES, declaredDelayMinutes: DECLARED_DELAY_MINUTES, fetchedAt: iso(fetchedAt), coverage,
    regime: marketRegime(daily, fetchedAt) };
  const gap = !codes.length ? "Market pulse unavailable: no tracked stock universe is available."
    : !indexBar ? "Market pulse unavailable: the index has no recent completed five-minute bar."
      : observations.length < required ? `Market pulse unavailable: ${observations.length} of ${codes.length} tracked stocks have usable completed bars; ${required} are required.` : null;
  const reason = gap && errors.length ? `${gap} Source fetch failed: ${errors.slice(0, 3).join("; ")}.` : gap;
  if (reason && prior?.index && (prior.status === "current" || prior.status === "stale")) {
    return { ...prior, status: "stale", fetchedAt: iso(fetchedAt), reason, lastValidAt: prior.lastValidAt ?? prior.fetchedAt };
  }
  if (reason) return { ...common, status: "unavailable", reason, observations: [] };
  return { ...common, status: "current", observedAt: indexBar.latestBarAt, index: { code: INDEX, ...indexBar }, observations };
}

export async function collectYahoo(tracked, fetcher = fetch) {
  const frames = {}, errors = [];
  const symbols = [INDEX, ...new Set(tracked.filter(validCode))];
  const requests = symbols.map((code) => ({ code, symbol: code === INDEX ? INDEX : `${code}.SR`, interval: "5m", range: "1d" }));
  requests.push({ code: "daily-index", symbol: INDEX, interval: "1d", range: "3mo" });
  let daily = [];
  // Cloudflare allows six simultaneous outgoing connections per invocation.
  for (let i = 0; i < requests.length; i += 4) {
    await Promise.all(requests.slice(i, i + 4).map(async ({ code, symbol, interval, range }) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
        const response = await fetcher(url, { headers: { accept: "application/json", "user-agent": "tasi-observational-pulse/1.0" }, signal: AbortSignal.timeout(12_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bars = extractYahooBars(await response.json(), symbol, interval);
        if (code === "daily-index") daily = bars;
        else frames[code] = bars;
      } catch (error) {
        errors.push(`${code}: ${error instanceof Error ? error.message : "source failure"}`);
      }
    }));
  }
  return { frames, daily, errors };
}

export async function runPulse({ tracked, prior, collect, saveAttempt, publish, publicationEnabled = false, fetchedAt }) {
  let collected;
  try { collected = await collect(tracked); }
  catch (error) { collected = { frames: {}, daily: [], errors: [error instanceof Error ? error.message : "source failure"] }; }
  const pulse = buildMarketPulse({ ...collected, tracked, prior, fetchedAt: fetchedAt ?? new Date().toISOString() });
  await saveAttempt(pulse, collected.errors);
  if (publicationEnabled) await publish(pulse);
  return pulse;
}
