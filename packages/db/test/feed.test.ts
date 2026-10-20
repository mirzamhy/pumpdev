import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RiskLevel, TraceResult } from "@pumpfun/shared";
import { SqliteStore, type FeedTokenInput } from "../src/index";

const NOW = 1_800_000_000;
let store: SqliteStore;
beforeEach(() => {
  store = new SqliteStore(":memory:");
});
afterEach(() => store.close());

const token = (mint: string, over: Partial<FeedTokenInput> = {}): FeedTokenInput => ({
  mint,
  name: `Name ${mint}`,
  symbol: mint,
  uri: null,
  creator: `DEV-${mint}`,
  bondingCurve: `CURVE-${mint}`,
  createSignature: `SIG-${mint}`,
  createdAt: NOW - 60,
  initialBuySol: 1,
  isMayhemMode: false,
  marketCapSol: 28,
  progressPct: 0,
  realSol: 0,
  ...over,
});

function traced(mint: string, score: number, level: RiskLevel, finishedAt: number): TraceResult {
  return {
    token: {
      mint,
      name: null,
      symbol: null,
      uri: null,
      tokenProgram: null,
      quoteMint: null,
      deployer: `DEV-${mint}`,
      creatorCurrent: null,
      creatorOriginal: null,
      createdAt: null,
      createSignature: "from-trace",
      createSlot: null,
      complete: false,
      isMayhemMode: false,
      devInitialBuy: null,
      createTxFound: true,
    },
    nodes: [],
    devHistory: [],
    devHistoryPartial: false,
    devStatus: null,
    holders: null,
    crosslinks: [],
    score: { score, level, factors: [], incomplete: false },
    partial: false,
    finishedAt,
  };
}

const mints = (rows: { mint: string }[]) => rows.map((r) => r.mint);

describe("feed tokens", () => {
  it("inserts once per mint", () => {
    expect(store.insertFeedToken(token("A"))).toBe(true);
    expect(store.insertFeedToken(token("A", { name: "again" }))).toBe(false);
    expect(store.feed({ tab: "new", hideHigh: false, limit: 10, now: NOW })).toHaveLength(1);
  });

  it("picks young tokens every tick and hot older tokens every two minutes", () => {
    store.insertFeedToken(token("YOUNG", { createdAt: NOW - 120 }));
    store.insertFeedToken(token("HOT", { createdAt: NOW - 3600, progressPct: 30 }));
    store.insertFeedToken(token("COLD", { createdAt: NOW - 3600, progressPct: 2 }));
    store.insertFeedToken(token("ANCIENT", { createdAt: NOW - 30_000, progressPct: 60 }));
    store.insertFeedToken(token("DONE", { createdAt: NOW - 60 }));
    store.markMigrated("DONE", NOW - 10);
    expect(mints(store.feedTokensToPoll(NOW))).toEqual(["YOUNG", "HOT"]);
    expect(store.feedTokensToPoll(NOW)[0]).toEqual({ mint: "YOUNG", bondingCurve: "CURVE-YOUNG" });

    store.updateFeedCurves([{ mint: "HOT", marketCapSol: 50, progressPct: 31, realSol: 9, complete: false }], NOW);
    expect(mints(store.feedTokensToPoll(NOW + 20))).toEqual(["YOUNG"]);
    expect(mints(store.feedTokensToPoll(NOW + 120))).toEqual(["YOUNG", "HOT"]);
  });

  it("stores curve updates and migrations", () => {
    store.insertFeedToken(token("A"));
    store.updateFeedCurves([{ mint: "A", marketCapSol: 70.5, progressPct: 50, realSol: 17.6, complete: false }], NOW);
    expect(store.feed({ tab: "new", hideHigh: false, limit: 10, now: NOW })[0]).toMatchObject({ marketCapSol: 70.5, progressPct: 50, realSol: 17.6, complete: false });
    store.updateFeedCurves([{ mint: "A", marketCapSol: 28, progressPct: 1, realSol: 0, complete: false }], NOW + 2);
    expect(store.feed({ tab: "new", hideHigh: false, limit: 10, now: NOW })[0]).toMatchObject({ progressPct: 1, peakProgressPct: 50 });
    store.markMigrated("A", NOW + 5);
    expect(store.feed({ tab: "new", hideHigh: false, limit: 10, now: NOW })[0]).toMatchObject({ complete: true, migratedAt: NOW + 5 });
  });

  it("lists auto-trace candidates by progress, skipping traced or old tokens", () => {
    store.insertFeedToken(token("LOW", { progressPct: 20 }));
    store.insertFeedToken(token("MID", { progressPct: 45 }));
    store.insertFeedToken(token("TOP", { progressPct: 90 }));
    store.insertFeedToken(token("OLD", { progressPct: 95, createdAt: NOW - 2000 }));
    store.insertFeedToken(token("DONE", { progressPct: 80 }));
    store.markAutoTraced("DONE", NOW - 5);
    store.insertFeedToken(token("FRESH", { progressPct: 70 }));
    store.saveResult(traced("FRESH", 10, "low", NOW - 100));
    expect(store.autoTraceCandidates(NOW, 40, 900)).toEqual(["TOP", "MID"]);
  });

  it("sorts tabs and joins trace scores", () => {
    store.insertFeedToken(token("A", { createdAt: NOW - 30, progressPct: 10 }));
    store.insertFeedToken(token("B", { createdAt: NOW - 20, progressPct: 60 }));
    store.insertFeedToken(token("C", { createdAt: NOW - 10, progressPct: 30 }));
    store.saveResult(traced("A", 80, "high", NOW - 5));
    store.saveResult(traced("C", 20, "low", NOW - 1));
    store.markAutoTraced("A", NOW - 20);

    expect(mints(store.feed({ tab: "new", hideHigh: false, limit: 10, now: NOW }))).toEqual(["C", "B", "A"]);
    expect(mints(store.feed({ tab: "hot", hideHigh: false, limit: 10, now: NOW }))).toEqual(["B", "C", "A"]);
    expect(mints(store.feed({ tab: "traced", hideHigh: false, limit: 10, now: NOW }))).toEqual(["C", "A"]);
    expect(mints(store.feed({ tab: "traced", hideHigh: true, limit: 10, now: NOW }))).toEqual(["C"]);
    expect(mints(store.feed({ tab: "new", hideHigh: false, limit: 2, now: NOW }))).toEqual(["C", "B"]);

    const a = store.feed({ tab: "traced", hideHigh: false, limit: 10, now: NOW }).find((r) => r.mint === "A");
    expect(a).toMatchObject({ score: 80, level: "high", tracedAt: NOW - 5, autoTraced: true, creator: "DEV-A", initialBuySol: 1, isMayhemMode: false });
  });

  it("drops migrated tokens from the hot tab", () => {
    store.insertFeedToken(token("A", { progressPct: 99 }));
    store.markMigrated("A", NOW);
    expect(store.feed({ tab: "hot", hideHigh: false, limit: 10, now: NOW })).toEqual([]);
  });

  it("counts other tokens with the same ticker in the last day", () => {
    store.insertFeedToken(token("K1", { symbol: "KOREAN" }));
    store.insertFeedToken(token("K2", { symbol: " korean " }));
    store.insertFeedToken(token("K3", { symbol: "Korean", createdAt: NOW - 90_000 }));
    store.insertFeedToken(token("U", { symbol: "UNIQUE" }));
    store.insertFeedToken(token("N", { symbol: null }));
    const rows = store.feed({ tab: "new", hideHigh: false, limit: 10, now: NOW });
    const count = (m: string) => rows.find((r) => r.mint === m)?.copycatCount;
    expect([count("K1"), count("K2"), count("U"), count("N")]).toEqual([1, 1, 0, 0]);
  });

  it("summarises the last hour", () => {
    store.insertFeedToken(token("A"));
    store.insertFeedToken(token("B"));
    store.insertFeedToken(token("OLD", { createdAt: NOW - 7200 }));
    expect(store.feedStats(NOW)).toEqual({ seenLastHour: 2, tracedLastHour: 0, highRiskShare: null });
    store.saveResult(traced("A", 80, "high", NOW - 10));
    store.saveResult(traced("B", 10, "low", NOW - 10));
    store.saveResult(traced("OLD", 80, "high", NOW - 7000));
    expect(store.feedStats(NOW)).toEqual({ seenLastHour: 2, tracedLastHour: 2, highRiskShare: 0.5 });
  });

  it("prunes old rows", () => {
    store.insertFeedToken(token("NEW"));
    store.insertFeedToken(token("OLD", { createdAt: NOW - 90_000 }));
    expect(store.pruneFeed(NOW - 86_400)).toBe(1);
    expect(mints(store.feed({ tab: "new", hideHigh: false, limit: 10, now: NOW }))).toEqual(["NEW"]);
  });

  it("knows creation signatures of feed tokens, preferring traced results", () => {
    store.insertFeedToken(token("A"));
    expect(store.findCreateSignature("A")).toBe("SIG-A");
    store.saveResult(traced("A", 1, "low", NOW));
    expect(store.findCreateSignature("A")).toBe("from-trace");
    expect(store.findCreateSignature("NONE")).toBeNull();
  });
});
