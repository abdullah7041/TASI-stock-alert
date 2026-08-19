// Type declarations for alert-names.mjs. Written by hand so the normalization
// boundary is expressed in the types: a stored alert may lack a name, and
// everything downstream of normalizeAlert is guaranteed to have one.
import type { MovementAlert, StoredMovementAlert } from "@/app/lib/evidence-types";

export const NAME_UNAVAILABLE: string;
export function verifiedCompanyName(code: string): string | null;
export function resolveAlertName(alert: StoredMovementAlert): string;
export function normalizeAlert(alert: StoredMovementAlert): MovementAlert;
