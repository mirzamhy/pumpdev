import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config";
import { bondingCurvePda } from "../src/pda";
import { PUMP_PROGRAM_ID } from "../src/pump/constants";
import { NotPumpTokenError, resolveToken } from "../src/trace/resolveToken";
import { withTxCache } from "../src/cachedChain";
import {
  FakeChain,
  MemoryStore,
  addr,
  encodeBondingCurve,
  encodeCreateEvent,
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
  chain.setHistory(MINT, [{ signature: "create", tx: createTx }, ...trades]);
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
    const { info } = await resolveToken(MINT, chain, { ...DEFAULT_CONFIG, pageSize: 2, mintMaxPages: 2 });
    expect(info.createTxFound).toBe(false);
    expect(info.deployer).toBe(NEW_CREATOR);
    expect(info.devInitialBuy).toBeNull();
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
