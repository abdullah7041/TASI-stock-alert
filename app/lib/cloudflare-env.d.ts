declare module "cloudflare:workers" {
  export interface D1Result {
    success: boolean;
    meta: { changes?: number };
    results?: unknown[];
  }

  export interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    run(): Promise<D1Result>;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
  }

  export interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  }

  export const env: {
    AUTH_MODE?: string;
    MIGRATION_EXPORT_TOKEN?: string;
    MIGRATION_EXPORT_UNTIL?: string;
    MIGRATION_READ_ONLY?: string;
    MACHINE_RELAY_SECRET?: string;
    ACCESS_ISSUER?: string;
    ACCESS_AUD?: string;
    DB?: D1Database;
    OPENROUTER_API_KEY?: string;
    AGENT_OWNER_EMAIL?: string;
    AGENT_DEFAULT_MODEL?: string;
    AGENT_REPORT_MODEL?: string;
    AGENT_CHAT_MODEL?: string;
    DASHBOARD_INGEST_TOKEN?: string;
    EVIDENCE_OFFICIAL_HOSTS?: string;
    PORTFOLIO_OWNER_ID?: string;
    DISCORD_APP_PUBLIC_KEY?: string;
    DISCORD_OWNER_USER_ID?: string;
    DEPLOYED_COMMIT_SHA?: string;
  };
}

// Cloudflare Workers runtime globals used by worker/index.ts. Declared by hand,
// deliberately: this repo describes only the surface it actually uses rather
// than depending on @cloudflare/workers-types, the same choice the
// "cloudflare:workers" module declaration above makes.
interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface ExecutionContext {
  access?: { aud?: string; getIdentity(): Promise<unknown> };
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
