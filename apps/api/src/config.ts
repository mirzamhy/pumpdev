import { parseEndpoints, type EndpointConfig } from "@pumpfun/solana";

export interface ApiConfig {
  port: number;
  dbPath: string;
  endpoints: EndpointConfig[];
  jobConcurrency: number;
  jobTimeoutMs: number;
  traceRateLimitPerMin: number;
  freshResultSec: number;
}

export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  const num = (key: string, fallback: number) => (env[key] ? Number(env[key]) : fallback);
  return {
    port: num("PORT", 3001),
    dbPath: env.DB_PATH ?? "./pumpfun.db",
    endpoints: parseEndpoints(env.RPC_URLS ?? "https://api.mainnet.solana.com", num("RPC_RPS", 8), num("RPC_METHOD_RPS", 3.5)),
    jobConcurrency: num("JOB_CONCURRENCY", 2),
    jobTimeoutMs: num("JOB_TIMEOUT_MS", 480_000),
    traceRateLimitPerMin: num("TRACE_RATE_LIMIT", 10),
    freshResultSec: num("FRESH_RESULT_SEC", 300),
  };
}
