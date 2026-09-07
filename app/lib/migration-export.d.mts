import type { D1Database } from 'cloudflare:workers';
export function exportPage(db: D1Database, table: string, offset?: number): Promise<{table: string; schema: unknown[]; columns: unknown[]; rows: unknown[]; nextOffset: number | null}>;
