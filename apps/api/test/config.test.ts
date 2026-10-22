import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("has working defaults", () => {
    expect(loadConfig({})).toEqual({
      port: 3001,
      dbPath: "./pumpfun.db",
      endpoints: [{ url: "https://api.mainnet.solana.com", rps: 8, methodRps: 3.5 }],
      jobConcurrency: 2,
      jobTimeoutMs: 480_000,
      traceRateLimitPerMin: 10,
      freshResultSec: 300,
      feedEnabled: true,
      metadataFetch: "all",
      pumpPortalUrl: "wss://pumpportal.fun/api/data",
      feed: { pollSec: 20, autoTraceMinProgress: 40, autoTraceWindowSec: 900, autoTracePerHour: 20, retentionHours: 24 },
    });
  });

  it("reads feed overrides", () => {
    const cfg = loadConfig({ FEED_ENABLED: "false", AUTO_TRACE_PER_HOUR: "5", AUTO_TRACE_MIN_PROGRESS: "60", METADATA_FETCH: "traced" });
    expect(cfg.feedEnabled).toBe(false);
    expect(cfg.metadataFetch).toBe("traced");
    expect(cfg.feed).toMatchObject({ autoTracePerHour: 5, autoTraceMinProgress: 60 });
  });

  it("reads overrides", () => {
    const cfg = loadConfig({ PORT: "4000", RPC_URLS: "https://a|10|4,https://b", RPC_RPS: "5", RPC_METHOD_RPS: "2" });
    expect(cfg.port).toBe(4000);
    expect(cfg.endpoints).toEqual([
      { url: "https://a", rps: 10, methodRps: 4 },
      { url: "https://b", rps: 5, methodRps: 2 },
    ]);
  });
});
