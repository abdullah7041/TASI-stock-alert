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
    DB?: D1Database;
    OPENAI_API_KEY?: string;
    AGENT_OWNER_EMAIL?: string;
    AGENT_REPORT_MODEL?: string;
    AGENT_CHAT_MODEL?: string;
    DASHBOARD_INGEST_TOKEN?: string;
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
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
