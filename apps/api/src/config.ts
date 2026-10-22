import { parseEndpoints, type EndpointConfig } from "@pumpfun/solana";
import type { FeedConfig } from "./feed/feedService";

export interface ApiConfig {
  port: number;
  dbPath: string;
  endpoints: EndpointConfig[];
  jobConcurrency: number;
  jobTimeoutMs: number;
  traceRateLimitPerMin: number;
  freshResultSec: number;
  feedEnabled: boolean;
  /** "all": fetch metadata for every new token (needed for recycled-socials checks); "traced": only when tracing. */
  metadataFetch: "all" | "traced";
  pumpPortalUrl: string;
  feed: FeedConfig;
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
    feedEnabled: env.FEED_ENABLED !== "false",
    metadataFetch: env.METADATA_FETCH === "traced" ? "traced" : "all",
    pumpPortalUrl: env.PUMPPORTAL_URL ?? "wss://pumpportal.fun/api/data",
    feed: {
      pollSec: num("FEED_POLL_SEC", 20),
      autoTraceMinProgress: num("AUTO_TRACE_MIN_PROGRESS", 40),
      autoTraceWindowSec: num("AUTO_TRACE_WINDOW_SEC", 900),
      autoTracePerHour: num("AUTO_TRACE_PER_HOUR", 20),
      retentionHours: num("FEED_RETENTION_HOURS", 24),
    },
  };
}
