/**
 * Dashboard replay may restore the canonical artifact and its Cockpit receipt,
 * but it must not recreate alerts or proposal drafts as a side effect.
 */
export function dashboardIngestProjection(snapshot, replayOnly) {
  if (replayOnly) return { top10Drafts: [], alerts: [] };
  const top10Drafts = [snapshot.top10];
  if (snapshot.schemaVersion === 3 && snapshot.top10Review) top10Drafts.push(snapshot.top10Review);
  return { top10Drafts, alerts: snapshot.alerts };
}
