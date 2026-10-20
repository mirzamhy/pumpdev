import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "@pumpfun/db";
import { bondingCurvePda } from "@pumpfun/core";
import { FakeChain, addr } from "@pumpfun/core/testing";
import { JobManager } from "../src/jobs";

let store: SqliteStore;
afterEach(() => store.close());

/** Every trace blocks on its first RPC call until `release()`; `started` lists mints in the order their traces began. */
async function setup(concurrency: number, mints: string[]) {
  store = new SqliteStore(":memory:");
  const chain = new FakeChain();
  const byCurve = new Map<string, string>();
  for (const m of mints) byCurve.set(await bondingCurvePda(m), m);
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  chain.getAccount = async (address) => {
    const mint = byCurve.get(address);
    if (mint && !started.includes(mint)) started.push(mint);
    await gate;
    return null;
  };
  const jobs = new JobManager({ store, chain, concurrency, timeoutMs: 10_000 });
  return { jobs, started, release };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const [A, B, C, D] = [addr(90), addr(91), addr(92), addr(93)];

describe("JobManager priorities", () => {
  it("runs one background trace at a time and keeps a slot for users", async () => {
    const { jobs, started, release } = await setup(2, [A, B, C, D]);
    jobs.start(A, "auto");
    jobs.start(B, "auto");
    jobs.start(C, "auto");
    await flush();
    expect([jobs.stateOf(A), jobs.stateOf(B), jobs.stateOf(C)]).toEqual(["running", "queued", "queued"]);
    jobs.start(D);
    await flush();
    expect(jobs.stateOf(D)).toBe("running");
    expect(started).toEqual([A, D]);
    release();
    await jobs.whenIdle();
    expect(jobs.stateOf(A)).toBeNull();
  });

  it("serves queued user traces before queued background traces", async () => {
    const { jobs, started, release } = await setup(1, [A, B, C]);
    jobs.start(A);
    jobs.start(B, "auto");
    jobs.start(C);
    release();
    await jobs.whenIdle();
    expect(started).toEqual([A, C, B]);
  });

  it("moves a queued background trace ahead when a user asks for it", async () => {
    const { jobs, started, release } = await setup(1, [A, B, C]);
    jobs.start(A);
    jobs.start(B, "auto");
    const id = jobs.start(C, "auto");
    expect(jobs.start(C)).toBe(id);
    release();
    await jobs.whenIdle();
    expect(started).toEqual([A, C, B]);
  });
});
