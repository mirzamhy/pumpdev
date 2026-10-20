import { describe, expect, it } from "vitest";
import type { ChainNode, DevStatus, TokenInfo } from "@pumpfun/shared";
import { DEFAULT_CONFIG, type TraceConfig } from "../src/config";
import { bondingCurvePda } from "../src/pda";
import { TOKEN_2022_PROGRAM_ID } from "../src/pump/constants";
import { analyzeHolders } from "../src/trace/holders";
import { FakeChain, MemoryStore, addr, encodeToken2022Mint, makeTx, systemTransfer, tokenBal } from "../src/testing";

const NOW = 1_800_000_000;
const DAY = 86_400;
const MINT = addr(20);
const DEV = addr(10);
const INSIDER = addr(30);
const [H1, H2, H3, H4, H5, H6, FRESHY, SOLD, ZERO] = [41, 42, 43, 44, 45, 46, 47, 48, 49].map(addr) as string[];
const F1 = addr(61);
const F2 = addr(62);
const BUSY = addr(63);
const cfg: TraceConfig = { ...DEFAULT_CONFIG, pageSize: 2, walletMaxPages: 2 };

const token: TokenInfo = {
  mint: MINT,
  name: "Coin",
  symbol: "C",
  uri: null,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
  quoteMint: null,
  deployer: DEV,
  creatorCurrent: DEV,
  creatorOriginal: DEV,
  createdAt: NOW - 3600,
  createSignature: "create",
  createSlot: 100,
  complete: false,
  isMayhemMode: false,
  devInitialBuy: "50000",
  createTxFound: true,
};

const devNode: ChainNode = {
  address: DEV,
  depth: 0,
  role: "deployer",
  chainRoot: DEV,
  fundedBy: addr(11),
  fundingAmountLamports: "1",
  fundedAt: NOW - 10 * DAY,
  fundingSignature: "f-dev",
  terminal: null,
};

const devStatus: DevStatus = {
  initialBuy: "50000",
  bought: "0",
  sold: "0",
  transferredOut: "10000",
  balance: "50000",
  releasedPct: 16.66,
  transfers: [{ to: INSIDER, amount: "10000", signature: "move" }],
  partial: false,
};

function funded(chain: FakeChain, wallet: string, funder: string, blockTime = NOW - 10 * DAY) {
  const sig = `fund-${wallet.slice(0, 6)}`;
  chain.setHistory(wallet, [{ signature: sig, tx: makeTx({ signature: sig, blockTime, instructions: [systemTransfer(funder, wallet, 1_000_000)] }) }]);
}

function bought(owner: string, amount: number) {
  return { signature: `buy-${owner.slice(0, 6)}`, preTokenBalances: [], postTokenBalances: [tokenBal(1, MINT, owner, amount)] };
}

async function world() {
  const chain = new FakeChain();
  const store = new MemoryStore();
  const curve = await bondingCurvePda(MINT);
  chain.accounts.set(MINT, { address: MINT, owner: TOKEN_2022_PROGRAM_ID, data: encodeToken2022Mint({ name: "Coin", symbol: "C", uri: "u" }, MINT, 1_000_000n) });
  chain.mintHolders.set(MINT, [
    { owner: curve, amount: "500000" },
    { owner: DEV, amount: "50000" },
    { owner: H1, amount: "60000" },
    { owner: H1, amount: "40000" },
    { owner: H2, amount: "80000" },
    { owner: H3, amount: "70000" },
    { owner: H4, amount: "60000" },
    { owner: H5, amount: "30000" },
    { owner: H6, amount: "20000" },
    { owner: INSIDER, amount: "10000" },
    { owner: FRESHY, amount: "5000" },
    { owner: ZERO, amount: "0" },
  ]);
  funded(chain, DEV, addr(11));
  funded(chain, H1, F1);
  funded(chain, H2, F1);
  funded(chain, H3, BUSY);
  funded(chain, H4, BUSY);
  funded(chain, H5, H2);
  funded(chain, H6, DEV);
  funded(chain, INSIDER, addr(12));
  funded(chain, FRESHY, F2, NOW - 3600);
  chain.setHistory(F1, [{ signature: "f1" }]);
  chain.setHistory(F2, [{ signature: "f2" }]);
  chain.setHistory(BUSY, [{ signature: "b1" }, { signature: "b2" }, { signature: "b3" }]);
  chain.blocks.set(100, [bought(DEV, 50000), bought(H3, 70000)]);
  chain.blocks.set(101, [bought(H4, 60000)]);
  chain.blocks.set(102, [bought(SOLD, 9000)]);
  store.repeatSnipers = [{ wallet: H4, count: 3 }];
  return { chain, store };
}

async function analyze(over: Partial<TokenInfo> = {}) {
  const { chain, store } = await world();
  const result = await analyzeHolders({ token: { ...token, ...over }, nodes: [devNode], devStatus }, chain, store, cfg, NOW);
  return { chain, result };
}

describe("analyzeHolders", () => {
  it("skips migrated tokens without listing holders", async () => {
    const { chain, result } = await analyze({ complete: true });
    expect(result).toMatchObject({ available: false, reason: "migrated", top: [] });
    expect(chain.calls.some((c) => c.startsWith("holders:"))).toBe(false);
  });

  it("merges accounts per owner, drops the bonding curve and empty accounts, ranks by supply share", async () => {
    const { result } = await analyze();
    expect(result).toMatchObject({ available: true, holderCount: 9, totalSupply: "1000000", top10Pct: 42.5 });
    expect(result.top.map((h) => h.address)).toEqual([H1, H2, H3, H4, DEV, H5, H6, INSIDER, FRESHY]);
    expect(result.top[0]).toMatchObject({ address: H1, amount: "100000", pct: 10, rank: 1, fundedBy: F1 });
  });

  it("finds buyers in the creation slot and the next two, excluding the dev", async () => {
    const { result } = await analyze();
    expect(result.earlyBuyers).toEqual([
      { wallet: H3, slotOffset: 0, bought: "70000", holding: "70000" },
      { wallet: H4, slotOffset: 1, bought: "60000", holding: "60000" },
      { wallet: SOLD, slotOffset: 2, bought: "9000", holding: "0" },
    ]);
    expect(result.bundlePct).toBe(7);
  });

  it("leaves early buyers unknown without a creation slot", async () => {
    const { chain, result } = await analyze({ createSlot: null });
    expect(result.earlyBuyers).toBeNull();
    expect(result.bundlePct).toBeNull();
    expect(chain.calls.some((c) => c.startsWith("block:"))).toBe(false);
  });

  it("clusters holders by shared funder, holder-to-holder and dev funding, ignoring busy funders", async () => {
    const { result } = await analyze();
    expect(result.clusters).toEqual([
      { id: 1, members: [H1, H2, H5], pct: 21, linkedToDev: false, sharedFunder: null },
      { id: 2, members: [DEV, H6], pct: 7, linkedToDev: true, sharedFunder: null },
    ]);
    const byAddress = new Map(result.top.map((h) => [h.address, h]));
    expect(byAddress.get(H5)?.cluster).toBe(1);
    expect(byAddress.get(H3)?.cluster).toBeNull();
    expect(byAddress.get(H4)?.cluster).toBeNull();
  });

  it("tags dev, insiders, bundle, snipers, fresh wallets and repeat snipers", async () => {
    const { result } = await analyze();
    const tags = Object.fromEntries(result.top.map((h) => [h.address, h.tags]));
    expect(tags[DEV]).toEqual(["dev"]);
    expect(tags[INSIDER]).toEqual(["insider"]);
    expect(tags[H3]).toEqual(["bundle"]);
    expect(tags[H4]).toEqual(["sniper", "repeatSniper"]);
    expect(tags[FRESHY]).toEqual(["fresh"]);
    expect(tags[H1]).toEqual([]);
    expect(result.freshCount).toBe(1);
    expect(result.repeatSnipers).toEqual([{ wallet: H4, count: 3 }]);
  });

  it("sums insider supply once per wallet", async () => {
    const { result } = await analyze();
    // DEV 50k + INSIDER 10k + bundle H3 70k + H6 (dev-funded cluster) 20k
    expect(result.insiderPct).toBe(15);
  });

  it("names the shared funder when the whole cluster has one", async () => {
    const { chain, store } = await world();
    funded(chain, H5, addr(99));
    chain.setHistory(addr(99), [{ signature: "x" }]);
    const result = await analyzeHolders({ token, nodes: [devNode], devStatus }, chain, store, cfg, NOW);
    expect(result.clusters[0]).toMatchObject({ members: [H1, H2], sharedFunder: F1, pct: 18 });
  });
});
