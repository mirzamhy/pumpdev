import { describe, expect, it } from "vitest";
import type { ChainNode, RecentTrace, TraceResult } from "@pumpfun/shared";
import { chooseExample, exampleCandidates, exampleSteps } from "./example";

const recent = (mint: string, score: number): RecentTrace => ({ mint, name: null, symbol: null, score, level: score >= 60 ? "high" : "low", finishedAt: 0 });

const node = (address: string, depth: number, role: ChainNode["role"] = "funder"): ChainNode => ({
  address,
  depth,
  role,
  chainRoot: "DEV",
  fundedBy: null,
  fundingAmountLamports: null,
  fundedAt: null,
  fundingSignature: null,
  terminal: null,
});

function result(over: Partial<TraceResult>): TraceResult {
  return {
    token: { mint: "MINT", symbol: "RUG", deployer: "DEV" } as TraceResult["token"],
    nodes: [],
    devHistory: [],
    devHistoryPartial: false,
    devStatus: null,
    holders: null,
    crosslinks: [],
    score: { score: 75, level: "high", factors: [], incomplete: false },
    partial: false,
    finishedAt: 0,
    ...over,
  };
}

const launch = (mint: string, status: "alive" | "migrated" | "dead_dev_exited") => ({
  mint,
  name: null,
  symbol: mint,
  createdAt: 0,
  complete: false,
  devBalance: "0",
  initialBuy: "0",
  status,
});

describe("exampleSteps", () => {
  it("uses the first-hop funder, crosslinked wallets first, and three launches", () => {
    const steps = exampleSteps(
      result({
        nodes: [node("DEV", 0, "deployer"), node("F2", 2), node("F1", 1), node("F3", 3)],
        crosslinks: [
          { wallet: "X1", role: "funder", otherMint: "O1", otherSymbol: null },
          { wallet: "DEV", role: "deployer", otherMint: "O2", otherSymbol: null },
          { wallet: "X1", role: "insider", otherMint: "O3", otherSymbol: null },
        ],
        devHistory: [launch("L1", "dead_dev_exited"), launch("L2", "alive"), launch("L3", "migrated"), launch("L4", "alive")],
      }),
    );
    expect(steps).toEqual({
      mint: "MINT",
      symbol: "RUG",
      score: 75,
      funder: "F1",
      deployer: "DEV",
      linked: ["X1", "F2", "F3"],
      launches: [
        { mint: "L1", symbol: "L1", status: "dead_dev_exited" },
        { mint: "L2", symbol: "L2", status: "alive" },
        { mint: "L3", symbol: "L3", status: "migrated" },
      ],
    });
  });

  it("copes with a dev that has no funder or history", () => {
    expect(exampleSteps(result({ nodes: [node("DEV", 0, "deployer")] }))).toMatchObject({ funder: null, linked: [], launches: [] });
  });
});

describe("chooseExample", () => {
  it("lists high-score candidates newest first, at most five", () => {
    const rows = [recent("A", 90), recent("B", 10), ...["C", "D", "E", "F", "G"].map((m) => recent(m, 70))];
    expect(exampleCandidates(rows)).toEqual(["A", "C", "D", "E", "F"]);
  });

  it("prefers the trace that shows the most, else the newest loaded", () => {
    const bare = result({});
    const launches = result({ devHistory: [launch("L1", "dead_dev_exited")] });
    const full = result({ devHistory: [launch("L1", "dead_dev_exited")], nodes: [node("F1", 1)] });
    expect(chooseExample([bare, undefined, launches, full])).toBe(full);
    expect(chooseExample([launches, result({ devHistory: [launch("L2", "alive")] })])).toBe(launches);
    expect(chooseExample([undefined, bare])).toBe(bare);
    expect(chooseExample([undefined])).toBeNull();
  });
});
