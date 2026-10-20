import { describe, expect, it } from "vitest";
import type { ChainNode, TraceResult } from "@pumpfun/shared";
import { applyEvent, emptyView, traceReducer, viewFromResult } from "./traceState";

const node = (address: string, chainRoot = "DEV"): ChainNode => ({
  address,
  depth: 0,
  role: "deployer",
  chainRoot,
  fundedBy: null,
  fundingAmountLamports: null,
  fundedAt: null,
  fundingSignature: null,
  terminal: null,
});

describe("applyEvent", () => {
  it("records step progress", () => {
    const v = applyEvent(emptyView, { type: "step", data: { step: "funders", state: "running" } });
    expect(v.steps).toEqual({ funders: "running" });
  });

  it("adds each node once per chain", () => {
    let v = applyEvent(emptyView, { type: "node", data: node("A") });
    v = applyEvent(v, { type: "node", data: node("A") });
    v = applyEvent(v, { type: "node", data: node("A", "CREATOR") });
    expect(v.nodes).toHaveLength(2);
  });

  it("finishes on done or error", () => {
    expect(applyEvent(emptyView, { type: "done", data: { partial: true } })).toMatchObject({ done: true, partial: true });
    expect(applyEvent(emptyView, { type: "error", data: { message: "boom" } })).toMatchObject({ done: true, error: "boom" });
  });
});

describe("traceReducer", () => {
  it("builds a finished view from a cached result", () => {
    const result = {
      token: { mint: "M" },
      nodes: [node("A")],
      devHistory: [],
      devHistoryPartial: false,
      devStatus: null,
      crosslinks: [],
      score: { score: 10, level: "low", factors: [], incomplete: false },
      partial: false,
      finishedAt: 1,
    } as unknown as TraceResult;
    const v = traceReducer(emptyView, { kind: "result", result });
    expect(v).toMatchObject({ done: true, nodes: [node("A")], score: { score: 10 } });
    expect(v.steps).toEqual({ token: "done", funders: "done", devActivity: "done", crosslinks: "done", score: "done" });
    expect(viewFromResult(result)).toEqual(v);
  });

  it("resets", () => {
    const busy = applyEvent(emptyView, { type: "node", data: node("A") });
    expect(traceReducer(busy, { kind: "reset" })).toBe(emptyView);
  });
});
