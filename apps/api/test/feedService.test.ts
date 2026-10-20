import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "@pumpfun/db";
import { PUMP_PROGRAM_ID, bondingCurvePda } from "@pumpfun/core";
import { FakeChain, addr, encodeBondingCurve } from "@pumpfun/core/testing";
import { FeedService, type FeedConfig } from "../src/feed/feedService";
import type { CreateEvent } from "../src/feed/pumpPortal";

const NOW = 1_800_000_000;
const CONFIG: FeedConfig = { pollSec: 20, autoTraceMinProgress: 40, autoTraceWindowSec: 900, autoTracePerHour: 2, retentionHours: 24 };

let store: SqliteStore;
let chain: FakeChain;
let now: number;
let started: [string, string][];
let backlog: number;
let service: FeedService;

beforeEach(() => {
  store = new SqliteStore(":memory:");
  chain = new FakeChain();
  now = NOW;
  started = [];
  backlog = 0;
  service = new FeedService({
    store,
    chain,
    jobs: { start: (mint, priority = "user") => (started.push([mint, priority]), "id"), autoBacklog: () => backlog },
    config: CONFIG,
    now: () => now,
  });
});
afterEach(() => store.close());

const createEvent = (n: number, over: Partial<CreateEvent> = {}): CreateEvent => ({
  signature: `sig${n}`,
  mint: addr(n),
  creator: addr(100 + n),
  name: `Token ${n}`,
  symbol: `T${n}`,
  uri: null,
  bondingCurve: addr(200 + n),
  initialBuySol: 1,
  marketCapSol: 30,
  vTokens: 1_073_000_000,
  isMayhemMode: false,
  ...over,
});

/** A curve with `soldPct` of the real token reserves sold. */
function setCurve(address: string, soldPct: number, complete = false) {
  const realTokens = (793_100_000_000_000n * BigInt(100 - soldPct)) / 100n;
  const virtualTokens = realTokens + 279_900_000_000_000n;
  const virtualQuote = (1_073_000_000_000_000n * 30_000_000_000n) / virtualTokens;
  chain.accounts.set(address, {
    address,
    owner: PUMP_PROGRAM_ID,
    data: encodeBondingCurve({
      complete,
      virtualTokenReserves: complete ? 0n : virtualTokens,
      virtualQuoteReserves: complete ? 0n : virtualQuote,
      realTokenReserves: complete ? 0n : realTokens,
      realQuoteReserves: complete ? 0n : virtualQuote - 30_000_000_000n,
      tokenTotalSupply: 1_000_000_000_000_000n,
      creator: addr(1),
    }),
  });
}

const feed = () => store.feed({ tab: "new", hideHigh: false, limit: 50, now });

describe("FeedService", () => {
  it("stores pump.fun creations with progress from the event", async () => {
    await service.handle({ type: "create", data: createEvent(1, { vTokens: 676_450_000 }) });
    await service.handle({ type: "create", data: createEvent(1, { name: "dupe" }) });
    expect(feed()).toEqual([
      expect.objectContaining({ mint: addr(1), name: "Token 1", creator: addr(101), createdAt: NOW, marketCapSol: 30, initialBuySol: 1 }),
    ]);
    expect(feed()[0]!.progressPct).toBeCloseTo(50, 5);
    expect(store.findCreateSignature(addr(1))).toBe("sig1");
  });

  it("derives the bonding curve when the event has none", async () => {
    await service.handle({ type: "create", data: createEvent(2, { bondingCurve: null }) });
    expect(store.feedTokensToPoll(NOW)).toEqual([{ mint: addr(2), bondingCurve: await bondingCurvePda(addr(2)) }]);
  });

  it("marks migrations", async () => {
    await service.handle({ type: "create", data: createEvent(3) });
    now += 30;
    await service.handle({ type: "migrate", data: { signature: "m", mint: addr(3) } });
    expect(feed()[0]).toMatchObject({ complete: true, migratedAt: NOW + 30, progressPct: 100 });
  });

  it("refreshes curves and auto-traces tokens that gain traction, within budget", async () => {
    for (const n of [4, 5, 6, 7]) await service.handle({ type: "create", data: createEvent(n) });
    setCurve(addr(204), 10);
    setCurve(addr(205), 60);
    setCurve(addr(206), 45);
    setCurve(addr(207), 100, true);
    now += 20;
    await service.tick();

    const byMint = new Map(feed().map((r) => [r.mint, r]));
    expect(byMint.get(addr(4))!.progressPct).toBeCloseTo(10, 5);
    expect(byMint.get(addr(4))!.marketCapSol).toBeGreaterThan(30);
    expect(byMint.get(addr(7))).toMatchObject({ complete: true, progressPct: 100 });
    // Budget 2/hour: the two strongest go now, in order of progress.
    expect(started).toEqual([
      [addr(7), "auto"],
      [addr(5), "auto"],
    ]);

    now += 20;
    await service.tick();
    expect(started).toHaveLength(2);

    // 30 minutes later one token of budget is back, but the window (15 min) has passed.
    now += 1800;
    await service.tick();
    expect(started).toHaveLength(2);
  });

  it("waits while background traces are backed up", async () => {
    await service.handle({ type: "create", data: createEvent(8) });
    setCurve(addr(208), 80);
    backlog = 2;
    await service.tick();
    expect(started).toEqual([]);
    backlog = 0;
    await service.tick();
    expect(started).toEqual([[addr(8), "auto"]]);
  });

  it("keeps going when the RPC fails", async () => {
    await service.handle({ type: "create", data: createEvent(9) });
    chain.getAccounts = async () => {
      throw new Error("429");
    };
    await expect(service.tick()).resolves.toBeUndefined();
  });

  it("prunes rows past retention", async () => {
    await service.handle({ type: "create", data: createEvent(10) });
    now += 25 * 3600;
    await service.tick();
    expect(feed()).toEqual([]);
  });
});
