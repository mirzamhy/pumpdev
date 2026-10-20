import { describe, expect, it } from "vitest";
import type { ChainNode } from "@pumpfun/shared";
import { DEFAULT_CONFIG, type TraceConfig } from "../src/config";
import { traceChain } from "../src/trace/funders";
import { FakeChain, MemoryStore, addr, makeTx, systemTransfer } from "../src/testing";

const A = addr(1);
const B = addr(2);
const C = addr(3);
const D = addr(4);
const NOW = 2_000_000_000;
const cfg: TraceConfig = { ...DEFAULT_CONFIG, pageSize: 2, walletMaxPages: 2 };

/** `wallet` first received SOL from `funder` in tx `sig`, then did one more (unfetched) tx. */
function funded(chain: FakeChain, wallet: string, funder: string, sig: string, inner = false) {
  const ix = systemTransfer(funder, wallet, 1_000_000_000);
  const tx = makeTx({ signature: sig, blockTime: 100, ...(inner ? { inner: [ix] } : { instructions: [ix] }) });
  chain.setHistory(wallet, [{ signature: sig, tx }, { signature: `${sig}-later` }]);
}

function busy(chain: FakeChain, wallet: string) {
  chain.setHistory(wallet, Array.from({ length: 5 }, (_, i) => ({ signature: `busy-${i}` })));
}

async function run(chain: FakeChain, store = new MemoryStore(), c = cfg, signal?: AbortSignal) {
  const nodes: ChainNode[] = [];
  await traceChain(A, "deployer", chain, store, c, NOW, (n) => nodes.push(n), signal);
  return nodes;
}

const shape = (nodes: ChainNode[]) => nodes.map((n) => [n.address, n.depth, n.role, n.fundedBy, n.terminal]);

describe("traceChain", () => {
  it("follows first SOL funding up to a high-activity wallet", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    funded(chain, B, C, "fb", true);
    busy(chain, C);
    const store = new MemoryStore();
    const nodes = await run(chain, store);
    expect(shape(nodes)).toEqual([
      [A, 0, "deployer", B, null],
      [B, 1, "funder", C, null],
      [C, 2, "funder", null, "high_activity"],
    ]);
    expect(nodes[0]).toMatchObject({ chainRoot: A, fundingAmountLamports: "1000000000", fundingSignature: "fa", fundedAt: 100 });
    expect(store.getWallet(A)?.firstSeenAt).toBe(100);
    expect(store.getWallet(C)?.firstSeenAt).toBeNull();
  });

  it("stops with unknown_origin when no SOL transfer funded the wallet", async () => {
    const chain = new FakeChain();
    chain.setHistory(A, [{ signature: "x", tx: makeTx({ signature: "x", instructions: [systemTransfer(A, D, 5)] }) }]);
    expect(shape(await run(chain))).toEqual([[A, 0, "deployer", null, "unknown_origin"]]);
  });

  it("stops on a funding loop", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    funded(chain, B, A, "fb");
    expect(shape(await run(chain))).toEqual([
      [A, 0, "deployer", B, null],
      [B, 1, "funder", A, "loop"],
    ]);
  });

  it("stops at maxHops", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    funded(chain, B, C, "fb");
    expect(shape(await run(chain, new MemoryStore(), { ...cfg, maxHops: 1 }))).toEqual([
      [A, 0, "deployer", B, null],
      [B, 1, "funder", C, "max_depth"],
    ]);
  });

  it("serves repeat traces from the store without RPC calls", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    funded(chain, B, C, "fb");
    busy(chain, C);
    const store = new MemoryStore();
    await run(chain, store);
    const before = chain.calls.length;
    await run(chain, store);
    expect(chain.calls.length).toBe(before);
  });

  it("re-checks an unknown-origin wallet after a day, since it may get funded later", async () => {
    const chain = new FakeChain();
    chain.setHistory(A, [{ signature: "x", tx: makeTx({ signature: "x", instructions: [systemTransfer(A, D, 5)] }) }]);
    const store = new MemoryStore();
    await run(chain, store);
    funded(chain, A, B, "fa");
    expect(shape(await run(chain, store))[0]![4]).toBe("unknown_origin");
    const nodes: ChainNode[] = [];
    await traceChain(A, "deployer", chain, store, cfg, NOW + 2 * 86_400, (n) => nodes.push(n));
    expect(nodes[0]).toMatchObject({ fundedBy: B, terminal: null });
  });

  it("marks a node incomplete on RPC failure and does not cache it", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    chain.failTx.add("fa");
    const store = new MemoryStore();
    expect(shape(await run(chain, store))).toEqual([[A, 0, "deployer", null, "incomplete"]]);
    expect(store.getWallet(A)).toBeNull();
  });

  it("rethrows aborts", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(run(chain, new MemoryStore(), cfg, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
