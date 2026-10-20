import { describe, expect, it } from "vitest";
import { decodeBondingCurve } from "../src/pump/bondingCurve";
import { EVENT_IX_TAG, decodePumpEventData } from "../src/pump/events";
import { TOKEN_2022_PROGRAM_ID } from "../src/pump/constants";
import { addr, encodeBondingCurve, encodeCreateEvent, encodeTradeEvent } from "../src/testing";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("event discriminators", () => {
  it("matches Anchor's EVENT_IX_TAG", () => {
    expect(hex(EVENT_IX_TAG)).toBe("e445a52e51cb9a1d");
  });
});

describe("decodePumpEventData", () => {
  it("decodes a current CreateEvent", () => {
    const data = encodeCreateEvent({
      name: "Test Coin",
      symbol: "TEST",
      uri: "https://x/meta.json",
      mint: addr(1),
      bondingCurve: addr(2),
      user: addr(3),
      creator: addr(4),
      timestamp: 1_700_000_000,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      isMayhemMode: true,
    });
    expect(decodePumpEventData(data)).toEqual({
      kind: "create",
      event: {
        name: "Test Coin",
        symbol: "TEST",
        uri: "https://x/meta.json",
        mint: addr(1),
        bondingCurve: addr(2),
        user: addr(3),
        creator: addr(4),
        timestamp: 1_700_000_000,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        isMayhemMode: true,
      },
    });
  });

  it("decodes a legacy CreateEvent without creator/timestamp", () => {
    const data = encodeCreateEvent({ name: "Old", symbol: "OLD", uri: "u", mint: addr(1), bondingCurve: addr(2), user: addr(3) });
    const ev = decodePumpEventData(data);
    expect(ev?.kind).toBe("create");
    if (ev?.kind !== "create") throw new Error("unreachable");
    expect(ev.event.user).toBe(addr(3));
    expect(ev.event.creator).toBeNull();
    expect(ev.event.timestamp).toBeNull();
    expect(ev.event.tokenProgram).toBeNull();
  });

  it("decodes a TradeEvent and ignores trailing fields", () => {
    const data = encodeTradeEvent({ mint: addr(1), solAmount: 5n, tokenAmount: 1000n, isBuy: false, user: addr(9), timestamp: 42 });
    expect(decodePumpEventData(data)).toEqual({
      kind: "trade",
      event: { mint: addr(1), solAmount: 5n, tokenAmount: 1000n, isBuy: false, user: addr(9), timestamp: 42 },
    });
  });

  it("returns null for non-event data", () => {
    expect(decodePumpEventData(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodePumpEventData(new Uint8Array(40))).toBeNull();
  });

  it("returns null for a truncated event", () => {
    const data = encodeTradeEvent({ mint: addr(1), solAmount: 1n, tokenAmount: 1n, isBuy: true, user: addr(2), timestamp: 1 });
    expect(decodePumpEventData(data.subarray(0, 30))).toBeNull();
  });
});

describe("decodeBondingCurve", () => {
  it("decodes a current account", () => {
    const state = decodeBondingCurve(
      encodeBondingCurve({ complete: true, realQuoteReserves: 85n, creator: addr(7), isMayhemMode: true, quoteMint: addr(8) }),
    );
    expect(state).toEqual({ complete: true, creator: addr(7), isMayhemMode: true, quoteMint: addr(8), realQuoteReserves: 85n });
  });

  it("decodes a legacy 49-byte account", () => {
    const state = decodeBondingCurve(encodeBondingCurve({ complete: false }));
    expect(state).toEqual({ complete: false, creator: null, isMayhemMode: false, quoteMint: null, realQuoteReserves: 0n });
  });

  it("treats an all-zero creator as missing", () => {
    const data = new Uint8Array(150);
    expect(decodeBondingCurve(data).creator).toBeNull();
  });
});
