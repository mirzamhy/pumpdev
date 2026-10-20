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

  it("returns 404 for unknown jobs and untraced tokens", async () => {
    expect((await app.inject({ method: "GET", url: "/api/trace/nope/stream" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/token/${addr(5)}` })).statusCode).toBe(404);
  });
});
