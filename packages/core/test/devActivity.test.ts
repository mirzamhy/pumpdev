import { describe, expect, it } from "vitest";
import type { TokenInfo } from "@pumpfun/shared";
import { DEFAULT_CONFIG } from "../src/config";
import { bondingCurvePda } from "../src/pda";
import { PUMP_PROGRAM_ID } from "../src/pump/constants";
import { analyzeDev } from "../src/trace/devActivity";
import {
  FakeChain,
  addr,
  encodeBondingCurve,
  encodeCreateEvent,
  encodeTradeEvent,
  makeTx,
  pumpEventIx,
  tokenBal,
} from "../src/testing";

const DEV = addr(10);
const MINT = addr(20);
const OLD_DEAD = addr(21);
const OLD_MIGRATED = addr(22);
const YOUNG = addr(23);
const FRIEND = addr(30);
const NOW = 1_800_000_000;
const CREATED = NOW - 7200;
const DAY = 86_400;

function createTx(sig: string, mint: string, ts: number, buy: bigint) {
  return makeTx({
    signature: sig,
    blockTime: ts,
    inner: [
      pumpEventIx(encodeCreateEvent({ name: `Name ${sig}`, symbol: sig.toUpperCase(), uri: "u", mint, bondingCurve: addr(99), user: DEV, creator: DEV, timestamp: ts })),
      pumpEventIx(encodeTradeEvent({ mint, solAmount: 1n, tokenAmount: buy, isBuy: true, user: DEV, timestamp: ts })),
    ],
  });
}

async function world() {
  const chain = new FakeChain();
  for (const [mint, complete] of [[OLD_DEAD, false], [OLD_MIGRATED, true], [YOUNG, false]] as const) {
    const pda = await bondingCurvePda(mint);
    chain.accounts.set(pda, { address: pda, owner: PUMP_PROGRAM_ID, data: encodeBondingCurve({ complete, creator: DEV }) });
  }
  chain.setHistory(DEV, [
    { signature: "c21", tx: createTx("c21", OLD_DEAD, NOW - 10 * DAY, 1000n) },
    { signature: "c22", tx: createTx("c22", OLD_MIGRATED, NOW - 5 * DAY, 500n) },
    { signature: "cMain", tx: createTx("cMain", MINT, CREATED, 1000n) },
    { signature: "c23", tx: createTx("c23", YOUNG, NOW - 3600, 100n) },
    {
      signature: "s1",
      tx: makeTx({
        signature: "s1",
        blockTime: CREATED + 600,
        accountKeys: [DEV, addr(98)],
        preBalances: [1_000_000_000, 0],
        postBalances: [2_000_000_000, 0],
        preTokenBalances: [tokenBal(1, MINT, DEV, 1000)],
        postTokenBalances: [tokenBal(1, MINT, DEV, 600)],
      }),
    },
    {
      signature: "x1",
      tx: makeTx({
        signature: "x1",
        blockTime: CREATED + 900,
        accountKeys: [DEV, FRIEND],
        preBalances: [2_000_000_000, 0],
        postBalances: [1_990_000_000, 2_000_000],
        preTokenBalances: [tokenBal(1, MINT, DEV, 600)],
        postTokenBalances: [tokenBal(1, MINT, DEV, 400), tokenBal(2, MINT, FRIEND, 200)],
      }),
    },
    {
      signature: "b1",
      tx: makeTx({
        signature: "b1",
        blockTime: CREATED + 1200,
        accountKeys: [DEV],
        preBalances: [1_990_000_000],
        postBalances: [1_900_000_000],
        preTokenBalances: [tokenBal(1, MINT, DEV, 400)],
        postTokenBalances: [tokenBal(1, MINT, DEV, 450)],
      }),
    },
  ]);
  chain.holdings.set(DEV, [
    { mint: MINT, amount: "450" },
    { mint: OLD_DEAD, amount: "5" },
    { mint: YOUNG, amount: "100" },
  ]);
  return chain;
}

const token: TokenInfo = {
  mint: MINT,
  name: "Main",
  symbol: "MAIN",
  uri: null,
  tokenProgram: null,
  quoteMint: null,
  deployer: DEV,
  creatorCurrent: DEV,
  creatorOriginal: DEV,
  createdAt: CREATED,
  createSignature: "cMain",
  createSlot: 1,
  complete: false,
  isMayhemMode: false,
  devInitialBuy: "1000",
  createTxFound: true,
};

describe("analyzeDev", () => {
  it("lists the dev's other launches with status, newest first", async () => {
    const { history, historyPartial } = await analyzeDev(token, await world(), DEFAULT_CONFIG, NOW);
    expect(history.map((t) => [t.mint, t.status, t.initialBuy, t.devBalance])).toEqual([
      [YOUNG, "alive", "100", "100"],
      [OLD_MIGRATED, "migrated", "500", "0"],
      [OLD_DEAD, "dead_dev_exited", "1000", "5"],
    ]);
    expect(history[0]).toMatchObject({ symbol: "C23", createdAt: NOW - 3600, complete: false });
    expect(historyPartial).toBe(false);
  });

  it("classifies sells, transfer-outs and buys after launch", async () => {
    const { status } = await analyzeDev(token, await world(), DEFAULT_CONFIG, NOW);
    expect(status).toEqual({
      initialBuy: "1000",
      bought: "50",
      sold: "400",
      transferredOut: "200",
      balance: "450",
      releasedPct: 57.14,
      transfers: [{ to: FRIEND, amount: "200", signature: "x1" }],
      partial: false,
    });
  });

  it("counts launches signed by a launchpad tool with the dev as creator", async () => {
    const chain = new FakeChain();
    const BOT = addr(50);
    const LAUNCHED = addr(24);
    const pda = await bondingCurvePda(LAUNCHED);
    chain.accounts.set(pda, { address: pda, owner: PUMP_PROGRAM_ID, data: encodeBondingCurve({ complete: false, creator: DEV }) });
    const tx = makeTx({
      signature: "viaBot",
      blockTime: NOW - 2 * DAY,
      inner: [
        pumpEventIx(encodeCreateEvent({ name: "Bot", symbol: "BOT", uri: "u", mint: LAUNCHED, bondingCurve: pda, user: BOT, creator: DEV, timestamp: NOW - 2 * DAY })),
        pumpEventIx(encodeTradeEvent({ mint: LAUNCHED, solAmount: 1n, tokenAmount: 300n, isBuy: true, user: BOT, timestamp: NOW - 2 * DAY })),
      ],
    });
    chain.setHistory(DEV, [{ signature: "viaBot", tx }]);
    const { history } = await analyzeDev(token, chain, DEFAULT_CONFIG, NOW);
    expect(history.map((t) => [t.mint, t.initialBuy, t.status])).toEqual([[LAUNCHED, "300", "dead_dev_exited"]]);
  });

  it("flags partial results when the scan does not reach the launch", async () => {
    const { history, historyPartial, status } = await analyzeDev(token, await world(), { ...DEFAULT_CONFIG, devTxScan: 2 }, NOW);
    expect(history).toEqual([]);
    expect(historyPartial).toBe(true);
    expect(status.partial).toBe(true);
    // Only the 200-token transfer is visible, but holding 450 of 1050 acquired means 600 left the wallet.
    expect(status.transferredOut).toBe("200");
    expect(status.releasedPct).toBe(57.14);
  });
});
