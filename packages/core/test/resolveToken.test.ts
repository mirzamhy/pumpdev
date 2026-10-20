import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config";
import { bondingCurvePda } from "../src/pda";
import { PUMP_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "../src/pump/constants";
import { NotPumpTokenError, resolveToken } from "../src/trace/resolveToken";
import { withTxCache } from "../src/cachedChain";
import {
  FakeChain,
  MemoryStore,
  addr,
  encodeBondingCurve,
  encodeCreateEvent,
  encodeToken2022Mint,
  encodeTradeEvent,
  makeTx,
  pumpEventIx,
} from "../src/testing";

const MINT = addr(20);
const DEV = addr(10);
const NEW_CREATOR = addr(12);

async function world(opts: { creator?: string; extraSigs?: number } = {}) {
  const chain = new FakeChain();
  const curve = await bondingCurvePda(MINT);
  chain.accounts.set(curve, {
    address: curve,
    owner: PUMP_PROGRAM_ID,
    data: encodeBondingCurve({ complete: false, creator: opts.creator ?? DEV, isMayhemMode: true }),
  });
  const createTx = makeTx({
    signature: "create",
    blockTime: 1000,
    inner: [
      pumpEventIx(encodeCreateEvent({ name: "Coin", symbol: "CN", uri: "https://u", mint: MINT, bondingCurve: curve, user: DEV, creator: DEV, timestamp: 1000 })),
      pumpEventIx(encodeTradeEvent({ mint: MINT, solAmount: 1n, tokenAmount: 777n, isBuy: true, user: DEV, timestamp: 1000 })),
    ],
  });
  const trades = Array.from({ length: opts.extraSigs ?? 2 }, (_, i) => ({ signature: `trade-${i}` }));
  chain.setHistory(curve, [{ signature: "create", tx: createTx }, ...trades]);
  return chain;
}

describe("resolveToken", () => {
  it("finds the creation tx, deployer and initial buy", async () => {
    const chain = await world();
    const { info } = await resolveToken(MINT, chain, DEFAULT_CONFIG);
    expect(info).toMatchObject({
      mint: MINT,
      name: "Coin",
      symbol: "CN",
      uri: "https://u",
      deployer: DEV,
      creatorCurrent: DEV,
      creatorOriginal: DEV,
      createdAt: 1000,
      createSignature: "create",
      complete: false,
      isMayhemMode: true,
      devInitialBuy: "777",
      createTxFound: true,
    });
  });

  it("keeps the deployer when creator rights were moved", async () => {
    const chain = await world({ creator: NEW_CREATOR });
    const { info } = await resolveToken(MINT, chain, DEFAULT_CONFIG);
    expect(info.deployer).toBe(DEV);
    expect(info.creatorCurrent).toBe(NEW_CREATOR);
  });

  it("falls back to the curve creator when history is too long", async () => {
    const chain = await world({ creator: NEW_CREATOR, extraSigs: 5 });
    const { info } = await resolveToken(MINT, chain, { ...DEFAULT_CONFIG, pageSize: 2, curveMaxPages: 2 });
    expect(info.createTxFound).toBe(false);
    expect(info.deployer).toBe(NEW_CREATOR);
    expect(info.devInitialBuy).toBeNull();
  });

  it("fills name, symbol and uri from on-chain metadata when the creation tx is out of reach", async () => {
    const chain = await world({ creator: NEW_CREATOR, extraSigs: 5 });
    chain.accounts.set(MINT, {
      address: MINT,
      owner: TOKEN_2022_PROGRAM_ID,
      data: encodeToken2022Mint({ name: "Busy Coin", symbol: "BUSY", uri: "https://m/b.json" }, MINT),
    });
    const { info } = await resolveToken(MINT, chain, { ...DEFAULT_CONFIG, pageSize: 2, curveMaxPages: 2 });
    expect(info).toMatchObject({
      createTxFound: false,
      deployer: NEW_CREATOR,
      name: "Busy Coin",
      symbol: "BUSY",
      uri: "https://m/b.json",
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
  });

  it("keeps going without a name when metadata lookup fails", async () => {
    const chain = await world({ creator: NEW_CREATOR, extraSigs: 5 });
    const getAccount = chain.getAccount.bind(chain);
    chain.getAccount = async (a) => (a === MINT ? Promise.reject(new Error("rpc down")) : getAccount(a));
    const { info } = await resolveToken(MINT, chain, { ...DEFAULT_CONFIG, pageSize: 2, curveMaxPages: 2 });
    expect(info).toMatchObject({ createTxFound: false, deployer: NEW_CREATOR, name: null });
  });

  it("uses a creation signature known from an earlier trace without walking history", async () => {
    const chain = await world({ extraSigs: 5 });
    const { info } = await resolveToken(MINT, chain, { ...DEFAULT_CONFIG, pageSize: 2, curveMaxPages: 2 }, "create");
    expect(info).toMatchObject({ createTxFound: true, deployer: DEV, devInitialBuy: "777" });
    expect(chain.calls.some((c) => c.startsWith("sigs:"))).toBe(false);
  });

  it("rejects tokens without a pump.fun bonding curve", async () => {
    await expect(resolveToken(addr(99), new FakeChain(), DEFAULT_CONFIG)).rejects.toBeInstanceOf(NotPumpTokenError);
  });

  it("rejects strings that are not addresses", async () => {
    await expect(resolveToken("not-an-address", new FakeChain(), DEFAULT_CONFIG)).rejects.toBeInstanceOf(NotPumpTokenError);
  });
});

describe("withTxCache", () => {
  it("fetches a transaction once", async () => {
    const chain = await world();
    const cached = withTxCache(chain, new MemoryStore());
    await cached.getTransaction("create");
    await cached.getTransaction("create");
    expect(chain.calls.filter((c) => c === "tx:create")).toHaveLength(1);
  });
});
