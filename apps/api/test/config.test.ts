import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("has working defaults", () => {
    expect(loadConfig({})).toEqual({
      port: 3001,
      dbPath: "./pumpfun.db",
      endpoints: [{ url: "https://api.mainnet.solana.com", rps: 8, methodRps: 3.5 }],
      jobConcurrency: 2,
      jobTimeoutMs: 300_000,
      traceRateLimitPerMin: 10,
      freshResultSec: 300,
    });
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
