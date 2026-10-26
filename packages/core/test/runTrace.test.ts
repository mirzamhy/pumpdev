import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@pumpfun/shared";
import { runTrace } from "../src/runTrace";
import { NotPumpTokenError } from "../src/trace/resolveToken";
import { MemoryStore, addr, createScenario } from "../src/testing";

async function trace(opts: { store?: MemoryStore; signal?: AbortSignal; mutate?: (s: Awaited<ReturnType<typeof createScenario>>) => void } = {}) {
  const s = await createScenario();
  opts.mutate?.(s);
  const store = opts.store ?? new MemoryStore();
  const events: TraceEvent[] = [];
  const result = await runTrace(s.mint, { chain: s.chain, store, emit: (e) => events.push(e), now: () => s.now, signal: opts.signal });
  return { s, store, events, result };
}

describe("runTrace", () => {
  it("streams events and returns a scored result", async () => {
    const store = new MemoryStore();
    const s0 = await createScenario();
    store.crosslinks = [{ wallet: s0.funder, role: "funder", otherMint: addr(77), otherSymbol: "OTHER" }];
    const { s, events, result } = await trace({ store });

    expect(result.token.deployer).toBe(s.deployer);
    expect(result.nodes.map((n) => [n.address, n.role, n.terminal])).toEqual([
      [s.deployer, "deployer", null],
      [s.funder, "funder", "unknown_origin"],
    ]);
    expect(result.devStatus).toMatchObject({ sold: "600", transferredOut: "100", releasedPct: 70, partial: false });
    expect(result.crosslinks).toEqual(store.crosslinks);
    expect(result.score).toMatchObject({ score: 50, level: "medium", incomplete: false });
    expect(result.score.factors.map((f) => f.id)).toEqual(["devReleased", "devTransferOut", "freshFunding"]);
    expect(result.partial).toBe(false);

    const types = events.map((e) => e.type);
    expect(events[0]).toEqual({ type: "step", data: { step: "token", state: "running" } });
    expect(types.filter((t) => t === "node")).toHaveLength(2);
    expect(types.indexOf("token")).toBeLessThan(types.indexOf("node"));
    expect(types.indexOf("score")).toBeLessThan(types.indexOf("done"));
    expect(events.at(-1)).toEqual({ type: "done", data: { partial: false } });

    expect(result.holders).toMatchObject({ available: true, holderCount: 3, bundlePct: 5, insiderPct: 9 });
    expect(result.holders?.earlyBuyers).toEqual([
      { wallet: s.bundler, slotOffset: 0, bought: "500", holding: "500", signature: "bundle-buy", sameTxAsCreate: false, txBuyers: 1, fundedBy: null, fresh: false },
    ]);
    expect(types.indexOf("devStatus")).toBeLessThan(types.indexOf("holders"));
    expect(events).toContainEqual({ type: "step", data: { step: "holders", state: "done" } });
  });

  it("keeps going when the holder step fails, and reports the error", async () => {
    const s = await createScenario();
    s.chain.accounts.delete(s.mint);
    const failures: string[] = [];
    const events: TraceEvent[] = [];
    const result = await runTrace(s.mint, {
      chain: s.chain,
      store: new MemoryStore(),
      emit: (e) => events.push(e),
      now: () => s.now,
      onStepError: (step, err) => failures.push(`${step}: ${(err as Error).message}`),
    });
    expect(failures).toEqual(["holders: mint account not found"]);
    expect(events).toContainEqual({ type: "step", data: { step: "holders", state: "incomplete" } });
    expect(result.holders).toBeNull();
    expect(result.partial).toBe(true);
    expect(result.score.incomplete).toBe(true);
  });

  it("adds the tainted-funder factor from the store", async () => {
    const s0 = await createScenario();
    const store = new MemoryStore();
    store.tainted = [{ wallet: s0.funder, deadCount: 2 }];
    const { result } = await trace({ store });
    expect(result.score.factors.map((f) => f.id)).toContain("taintedFunder");
    expect(result.score).toMatchObject({ score: 70, level: "high" });
  });

  it("marks a failed step incomplete and keeps going", async () => {
    const { events, result } = await trace({ mutate: (s) => s.chain.failTx.add("sell-1") });
    expect(events).toContainEqual({ type: "step", data: { step: "devActivity", state: "incomplete" } });
    expect(result.devStatus).toBeNull();
    expect(result.partial).toBe(true);
    expect(result.score.incomplete).toBe(true);
    expect(result.nodes).toHaveLength(2);
  });

  it("returns a partial result when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { events, result } = await trace({ signal: ctrl.signal });
    expect(result.partial).toBe(true);
    expect(result.nodes).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "done", data: { partial: true } });
  });

  it("rejects tokens that are not pump.fun tokens", async () => {
    const s = await createScenario();
    await expect(
      runTrace(addr(99), { chain: s.chain, store: new MemoryStore(), emit: () => {}, now: () => s.now }),
    ).rejects.toBeInstanceOf(NotPumpTokenError);
  });
});
