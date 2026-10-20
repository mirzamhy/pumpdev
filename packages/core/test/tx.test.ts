import { describe, expect, it } from "vitest";
import { findSolFunding, lamportDelta, ownerGainedOtherToken, pumpEvents, tokenDeltas } from "../src/tx";
import { SYSTEM_PROGRAM_ID } from "../src/pump/constants";
import { addr, encodeCreateEvent, encodeTradeEvent, makeTx, pumpEventIx, systemTransfer, tokenBal } from "../src/testing";

const W = addr(1);
const F = addr(2);
const MINT = addr(3);

describe("findSolFunding", () => {
  it("finds an outer System transfer into the wallet", () => {
    const tx = makeTx({ signature: "s1", blockTime: 100, instructions: [systemTransfer(F, W, 5)] });
    expect(findSolFunding(tx, W)).toEqual({ from: F, lamports: 5n, signature: "s1", blockTime: 100 });
  });

  it("finds a transfer inside inner instructions", () => {
    const tx = makeTx({ signature: "s2", inner: [systemTransfer(F, W, 7)] });
    expect(findSolFunding(tx, W)?.from).toBe(F);
  });

  it("finds createAccount funding", () => {
    const tx = makeTx({
      signature: "s3",
      instructions: [{ programId: SYSTEM_PROGRAM_ID, parsed: { type: "createAccount", info: { source: F, newAccount: W, lamports: 9 } } }],
    });
    expect(findSolFunding(tx, W)?.lamports).toBe(9n);
  });

  it("ignores self transfers, zero amounts, other destinations and failed txs", () => {
    expect(findSolFunding(makeTx({ signature: "a", instructions: [systemTransfer(W, W, 5)] }), W)).toBeNull();
    expect(findSolFunding(makeTx({ signature: "b", instructions: [systemTransfer(F, W, 0)] }), W)).toBeNull();
    expect(findSolFunding(makeTx({ signature: "c", instructions: [systemTransfer(F, addr(9), 5)] }), W)).toBeNull();
    expect(findSolFunding(makeTx({ signature: "d", err: { x: 1 }, instructions: [systemTransfer(F, W, 5)] }), W)).toBeNull();
  });
});

describe("balance helpers", () => {
  const tx = makeTx({
    signature: "t",
    accountKeys: [W, F],
    preBalances: [1000, 50],
    postBalances: [400, 650],
    preTokenBalances: [tokenBal(2, MINT, W, 100), tokenBal(5, addr(8), F, 0)],
    postTokenBalances: [tokenBal(2, MINT, W, 40), tokenBal(3, MINT, F, 60), tokenBal(5, addr(8), F, 10)],
  });

  it("computes token deltas per owner, treating a missing pre balance as 0", () => {
    expect(tokenDeltas(tx, MINT)).toEqual(new Map([[W, -60n], [F, 60n]]));
  });

  it("computes lamport deltas", () => {
    expect(lamportDelta(tx, W)).toBe(-600n);
    expect(lamportDelta(tx, F)).toBe(600n);
    expect(lamportDelta(tx, addr(9))).toBe(0n);
  });

  it("detects an owner gaining a different token", () => {
    expect(ownerGainedOtherToken(tx, F, MINT)).toBe(true);
    expect(ownerGainedOtherToken(tx, W, MINT)).toBe(false);
  });
});

describe("pumpEvents", () => {
  it("extracts create and trade events from inner instructions", () => {
    const tx = makeTx({
      signature: "c",
      inner: [
        pumpEventIx(encodeCreateEvent({ name: "A", symbol: "A", uri: "u", mint: MINT, bondingCurve: addr(4), user: W, creator: W, timestamp: 5 })),
        systemTransfer(W, F, 1),
        pumpEventIx(encodeTradeEvent({ mint: MINT, solAmount: 1n, tokenAmount: 10n, isBuy: true, user: W, timestamp: 5 })),
      ],
    });
    expect(pumpEvents(tx).map((e) => e.kind)).toEqual(["create", "trade"]);
  });
});
