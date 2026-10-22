import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SqliteStore } from "@pumpfun/db";
import { addr, createScenario, type Scenario } from "@pumpfun/core/testing";
import { buildApp } from "../src/app";
import { JobManager } from "../src/jobs";

let s: Scenario;
let store: SqliteStore;
let jobs: JobManager;
let app: FastifyInstance;

beforeEach(async () => {
  s = await createScenario();
  store = new SqliteStore(":memory:");
  jobs = new JobManager({ store, chain: s.chain, concurrency: 1, timeoutMs: 10_000, now: () => s.now });
  app = await buildApp({ store, jobs, config: { traceRateLimitPerMin: 100, freshResultSec: 300 }, now: () => s.now + 10 });
});

afterEach(async () => {
  await app.close();
  store.close();
});

const startTrace = (mint: string) => app.inject({ method: "POST", url: "/api/trace", payload: { mint } });

describe("API", () => {
  it("rejects malformed addresses", async () => {
    const res = await startTrace("not a mint");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid token address" });
  });

  it("runs a trace, streams it, and serves the stored result", async () => {
    const res = await startTrace(s.mint);
    expect(res.statusCode).toBe(200);
    const { jobId } = res.json() as { jobId: string };
    expect(jobId).toEqual(expect.any(String));
    await jobs.whenIdle();

    const stream = await app.inject({ method: "GET", url: `/api/trace/${jobId}/stream` });
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    const events = stream.body
      .split("\n\n")
      .filter((chunk) => chunk.includes("data: "))
      .map((chunk) => JSON.parse(chunk.slice(chunk.indexOf("data: ") + 6)));
    expect(events[0]).toEqual({ type: "step", data: { step: "token", state: "running" } });
    expect(events.at(-1)).toEqual({ type: "done", data: { partial: false } });

    const again = await startTrace(s.mint);
    expect(again.json()).toMatchObject({ cached: true, result: { score: { score: 50 } } });

    const token = await app.inject({ method: "GET", url: `/api/token/${s.mint}` });
    expect(token.json()).toMatchObject({ token: { deployer: s.deployer }, score: { level: "medium" } });

    const recent = await app.inject({ method: "GET", url: "/api/recent" });
    expect(recent.json()).toHaveLength(1);

    const wallet = (await app.inject({ method: "GET", url: `/api/wallet/${s.deployer}` })).json();
    expect(wallet.known).toBe(true);
    expect(wallet.chain[0]).toMatchObject({ address: s.deployer, fundedBy: s.funder });
  });

  it("deduplicates concurrent traces of the same mint", async () => {
    // Hold the trace at its first RPC call so the second request arrives while it is still running.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const getAccount = s.chain.getAccount.bind(s.chain);
    s.chain.getAccount = async (address) => {
      await gate;
      return getAccount(address);
    };
    const a = (await startTrace(s.mint)).json() as { jobId: string };
    const b = (await startTrace(s.mint)).json() as { jobId: string };
    expect(b.jobId).toBe(a.jobId);
    release();
    await jobs.whenIdle();
  });

  it("streams an error for tokens that are not pump.fun tokens", async () => {
    const { jobId } = (await startTrace(addr(99))).json() as { jobId: string };
    await jobs.whenIdle();
    const stream = await app.inject({ method: "GET", url: `/api/trace/${jobId}/stream` });
    expect(stream.body).toContain('"type":"error"');
    expect(stream.body).toContain("not a pump.fun token");
  });

  it("ends the stream of a job interrupted by a restart with an error", async () => {
    store.createJob("old", s.mint, 1);
    store.appendEvent("old", 0, { type: "step", data: { step: "token", state: "running" } });
    store.markRunningJobsInterrupted(2);
    const stream = await app.inject({ method: "GET", url: "/api/trace/old/stream" });
    expect(stream.body).toContain('"type":"step"');
    expect(stream.body).toContain("This trace was interrupted");
  });

  it("does not add an error after a finished job's done event", async () => {
    const { jobId } = (await startTrace(s.mint)).json() as { jobId: string };
    await jobs.whenIdle();
    const stream = await app.inject({ method: "GET", url: `/api/trace/${jobId}/stream` });
    expect(stream.body).not.toContain('"type":"error"');
  });

  it("returns 404 for unknown jobs and untraced tokens", async () => {
    expect((await app.inject({ method: "GET", url: "/api/trace/nope/stream" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/token/${addr(5)}` })).statusCode).toBe(404);
  });

  it("serves the live feed with trace state", async () => {
    store.insertFeedToken({
      mint: s.mint,
      name: "Feed Coin",
      symbol: "FEED",
      uri: null,
      creator: s.deployer,
      bondingCurve: addr(77),
      createSignature: null,
      createdAt: s.now,
      initialBuySol: 1,
      isMayhemMode: false,
      marketCapSol: 30,
      progressPct: 5,
      realSol: 0,
    });
    const before = (await app.inject({ method: "GET", url: "/api/feed" })).json();
    expect(before.items).toEqual([expect.objectContaining({ mint: s.mint, symbol: "FEED", trace: { state: "none", score: null, level: null } })]);
    expect(before.items[0]).not.toHaveProperty("tracedAt");
    expect(before.stats).toEqual({ seenLastHour: 1, tracedLastHour: 0, highRiskShare: null, connected: false });

    await startTrace(s.mint);
    expect((await app.inject({ method: "GET", url: "/api/feed" })).json().items[0].trace.state).toMatch(/queued|running/);
    await jobs.whenIdle();
    const traced = (await app.inject({ method: "GET", url: "/api/feed?tab=traced&hideHigh=1" })).json();
    expect(traced.items[0].trace).toEqual({ state: "done", score: 50, level: "medium" });
  });

  it("rejects bad feed queries", async () => {
    expect((await app.inject({ method: "GET", url: "/api/feed?limit=500" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/feed?tab=nope" })).statusCode).toBe(400);
  });

  it("serves cached risky wallet lists", async () => {
    const first = (await app.inject({ method: "GET", url: "/api/risky" })).json();
    expect(first).toEqual({ serialDevs: [], funders: [], snipers: [], launchers: [], generatedAt: s.now + 10 });
    for (let i = 0; i < 3; i++) {
      store.insertFeedToken({
        mint: addr(60 + i), name: null, symbol: null, uri: null, creator: "BUSY", bondingCurve: addr(70 + i), createSignature: null,
        createdAt: s.now, initialBuySol: null, isMayhemMode: false, marketCapSol: null, progressPct: 0, realSol: 0,
      });
    }
    // Still the cached answer within a minute.
    expect((await app.inject({ method: "GET", url: "/api/risky" })).json().launchers).toEqual([]);
  });
});
