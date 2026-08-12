// Type declarations for dashboard-core.mjs, which is plain JavaScript. Without
// these, parseDashboardSnapshot's return type is inferred structurally and
// dataStatus widens to `string`, so the "delayed-daily" literal that
// research-agent.createOrReuseReport requires is lost at the boundary — the one
// place the app decides whether a snapshot may be researched against a paid
// OpenAI budget. Reuses DashboardSnapshot from dashboard-types.ts rather than
// restating the shape, so the two cannot drift.
import type { DashboardSnapshot, DashboardSnapshotV2 } from "@/app/lib/dashboard-types";

export function parseDashboardSnapshot(value: unknown): DashboardSnapshot | DashboardSnapshotV2;
export function dashboardFreshness(snapshot: DashboardSnapshot | DashboardSnapshotV2, now?: Date): "current" | "stale";
