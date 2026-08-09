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
  };
}
