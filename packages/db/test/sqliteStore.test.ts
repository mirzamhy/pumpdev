import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChainNode, DevToken, HolderAnalysis, TraceResult } from "@pumpfun/shared";
import type { WalletRecord } from "@pumpfun/core";
import { SqliteStore } from "../src/index";

let store: SqliteStore;
beforeEach(() => {
  store = new SqliteStore(":memory:");
});
afterEach(() => store.close());

const node = (address: string, depth: number, chainRoot: string, over: Partial<ChainNode> = {}): ChainNode => ({
  address,
  depth,
  role: depth === 0 ? "deployer" : "funder",
  chainRoot,
  fundedBy: null,
  fundingAmountLamports: null,
  fundedAt: null,
  fundingSignature: null,
  terminal: null,
  ...over,
});

const dead = (mint: string): DevToken => ({
  mint,
  name: `dead ${mint}`,
  symbol: mint,
  createdAt: 1,
  complete: false,
  devBalance: "0",
  initialBuy: "10",
  status: "dead_dev_exited",
});

function result(mint: string, deployer: string, funders: string[], over: Partial<TraceResult> = {}): TraceResult {
  return {
    token: {
      mint,
      name: `Name ${mint}`,
      symbol: mint.slice(0, 3),
      uri: null,
      tokenProgram: null,
      quoteMint: null,
      deployer,
      creatorCurrent: deployer,
      creatorOriginal: deployer,
      createdAt: 100,
      createSignature: "c",
      createSlot: 1,
      complete: false,
      isMayhemMode: false,
      devInitialBuy: "10",
      createTxFound: true,
    },
    nodes: [node(deployer, 0, deployer), ...funders.map((f, i) => node(f, i + 1, deployer))],
    devHistory: [],
    devHistoryPartial: false,
    devStatus: null,
    holders: null,
    crosslinks: [],
    score: { score: 42, level: "medium", factors: [], incomplete: false },
    partial: false,
    finishedAt: 1000,
    ...over,
  };
}

const wallet = (address: string, over: Partial<WalletRecord> = {}): WalletRecord => ({
  address,
  funderResolved: false,
  funder: null,
  fundingSignature: null,
  fundingAmountLamports: null,
  fundedAt: null,
  terminal: "unknown_origin",
  firstSeenAt: null,
  fetchedAt: 5,
  ...over,
});

describe("SqliteStore cache", () => {
  it("round-trips wallets and upserts", () => {
    store.putWallet(wallet("W", { terminal: "high_activity" }));
    store.putWallet(wallet("W", { funderResolved: true, funder: "F", fundingAmountLamports: "9", fundedAt: 3, fundingSignature: "s", terminal: null, firstSeenAt: 2 }));
    expect(store.getWallet("W")).toEqual(wallet("W", { funderResolved: true, funder: "F", fundingAmountLamports: "9", fundedAt: 3, fundingSignature: "s", terminal: null, firstSeenAt: 2 }));
    expect(store.getWallet("missing")).toBeNull();
  });

  it("caches transactions", () => {
    const tx = { slot: 1, blockTime: 2, meta: null, transaction: { signatures: ["s"], message: { accountKeys: [], instructions: [] } } };
    store.putTx("s", tx);
    store.putTx("s", tx);
    expect(store.getTx("s")).toEqual(tx);
    expect(store.getTx("none")).toBeNull();
  });
});

describe("SqliteStore results", () => {
  it("saves, reads back and lists recent results", () => {
    store.saveResult(result("MINTA", "DEVA", ["F1"]));
    expect(store.getResult("MINTA")).toMatchObject({ finishedAt: 1000, result: { token: { mint: "MINTA" } } });
    expect(store.recent(10)).toEqual([{ mint: "MINTA", name: "Name MINTA", symbol: "MIN", score: 42, level: "medium", finishedAt: 1000 }]);
  });

  it("remembers the creation signature of traced tokens", () => {
    store.saveResult(result("MINTA", "DEVA", []));
    expect(store.findCreateSignature("MINTA")).toBe("c");
    expect(store.findCreateSignature("OTHER")).toBeNull();
  });

  it("finds wallets shared with other traces, ignoring high-activity wallets", () => {
    store.saveResult(
      result("MINTA", "DEVA", ["F1"], {
        nodes: [node("DEVA", 0, "DEVA"), node("F1", 1, "DEVA"), node("CEX", 2, "DEVA", { terminal: "high_activity" })],
      }),
    );
    expect(store.findCrosslinks(["F1", "CEX", "X"], "MINTB")).toEqual([{ wallet: "F1", role: "funder", otherMint: "MINTA", otherSymbol: "MIN" }]);
    expect(store.findCrosslinks(["F1"], "MINTA")).toEqual([]);
    expect(store.findCrosslinks([], "MINTB")).toEqual([]);
  });

  it("records dev transfer recipients as insiders", () => {
    store.saveResult(
      result("MINTA", "DEVA", [], {
        devStatus: { initialBuy: "1", bought: "0", sold: "0", transferredOut: "1", balance: "0", releasedPct: 100, transfers: [{ to: "INS", amount: "1", signature: "x" }], partial: false },
      }),
    );
    expect(store.findCrosslinks(["INS"], "MINTB")).toEqual([{ wallet: "INS", role: "insider", otherMint: "MINTA", otherSymbol: "MIN" }]);
  });

  it("counts dead tokens linked to a funder or deployer", () => {
    store.saveResult(result("MINTA", "DEVA", ["F1"], { devHistory: [dead("D1"), dead("D2")] }));
    expect(store.findTaintedFunders(["F1", "DEVA", "NOBODY"], "MINTB")).toEqual(
      expect.arrayContaining([
        { wallet: "F1", deadCount: 2 },
        { wallet: "DEVA", deadCount: 2 },
      ]),
    );
    expect(store.findTaintedFunders(["F1"], "MINTA")).toEqual([]);
  });
});

describe("SqliteStore jobs", () => {
  it("stores events in order and tracks job state", () => {
    store.createJob("j1", "MINTA", 10);
    store.appendEvent("j1", 1, { type: "done", data: { partial: false } });
    store.appendEvent("j1", 0, { type: "step", data: { step: "token", state: "running" } });
    expect(store.listEvents("j1").map((e) => e.seq)).toEqual([0, 1]);
    expect(store.getJob("j1")).toEqual({ id: "j1", mint: "MINTA", state: "running", partial: false });
    store.finishJob("j1", "done", true, 20);
    expect(store.getJob("j1")).toEqual({ id: "j1", mint: "MINTA", state: "done", partial: true });
  });

  it("marks running jobs interrupted on startup", () => {
    store.createJob("j1", "A", 1);
    store.createJob("j2", "B", 1);
    store.finishJob("j2", "done", false, 2);
    expect(store.markRunningJobsInterrupted(3)).toBe(1);
    expect(store.getJob("j1")?.state).toBe("interrupted");
  });
});

describe("SqliteStore walletView", () => {
  it("walks the cached funding chain and lists launches and appearances", () => {
    store.putWallet(wallet("DEVA", { funderResolved: true, funder: "F1", terminal: null, fundedAt: 50 }));
    store.putWallet(wallet("F1"));
    store.saveResult(result("MINTA", "DEVA", ["F1"]));
    const view = store.walletView("DEVA");
    expect(view.known).toBe(true);
    expect(view.chain.map((n) => [n.address, n.depth, n.fundedBy, n.terminal])).toEqual([
      ["DEVA", 0, "F1", null],
      ["F1", 1, null, "unknown_origin"],
    ]);
    expect(view.deployed.map((d) => d.mint)).toEqual(["MINTA"]);
    expect(view.appearances).toEqual([{ mint: "MINTA", symbol: "MIN", role: "deployer" }]);
  });

  it("reports unknown wallets", () => {
    expect(store.walletView("NEW")).toEqual({
      address: "NEW",
      known: false,
      chain: [],
      deployed: [],
      appearances: [],
      profile: null,
      firstSeenAt: null,
      cluster: { funder: null, siblings: [], funded: [], repeatBuyers: [], insiders: [] },
      feedLaunches: [],
      archetype: { kind: "unclear", evidence: [] },
    });
  });
});

describe("SqliteStore migrations", () => {
  it("adds first_seen_at to a database created by the first release", () => {
    const dir = mkdtempSync(join(tmpdir(), "pumpfun-db-"));
    const path = join(dir, "old.db");
    const old = new Database(path);
    old.exec(
      "CREATE TABLE wallets (address TEXT PRIMARY KEY, funder_resolved INTEGER NOT NULL, funder TEXT, funding_signature TEXT, " +
        "funding_amount_lamports TEXT, funded_at INTEGER, terminal TEXT, fetched_at INTEGER NOT NULL)",
    );
    old.prepare("INSERT INTO wallets VALUES ('W', 0, NULL, NULL, NULL, NULL, 'unknown_origin', 5)").run();
    old.close();
    const migrated = new SqliteStore(path);
    expect(migrated.getWallet("W")?.firstSeenAt).toBeNull();
    migrated.putWallet(wallet("W", { firstSeenAt: 9 }));
    expect(migrated.getWallet("W")?.firstSeenAt).toBe(9);
    migrated.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("SqliteStore early buyers", () => {
  const withBuyers = (mint: string, wallets: [string, number][]): TraceResult =>
    result(mint, `DEV-${mint}`, [], {
      holders: { earlyBuyers: wallets.map(([w, slotOffset]) => ({ wallet: w, slotOffset, bought: "1", holding: "0" })) } as HolderAnalysis,
    });

  it("finds wallets that bought early in 3+ other traced mints", () => {
    store.saveResult(withBuyers("M1", [["S", 0], ["X", 1]]));
    store.saveResult(withBuyers("M2", [["S", 2], ["X", 0]]));
    store.saveResult(withBuyers("M3", [["S", 1]]));
    store.saveResult(withBuyers("M4", [["S", 0]]));
    expect(store.findRepeatSnipers(["S", "X"], "M9")).toEqual([{ wallet: "S", count: 4 }]);
    expect(store.findRepeatSnipers(["S"], "M4")).toEqual([{ wallet: "S", count: 3 }]);
    expect(store.findRepeatSnipers([], "M9")).toEqual([]);
  });
});
