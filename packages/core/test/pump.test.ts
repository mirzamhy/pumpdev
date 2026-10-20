import { describe, expect, it } from "vitest";
import { curveMetrics, decodeBondingCurve } from "../src/pump/bondingCurve";
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

  it("trims padded names and symbols (seen on real tokens)", () => {
    const data = encodeCreateEvent({ name: "Fartcoin ", symbol: "Fartcoin ", uri: " u ", mint: addr(1), bondingCurve: addr(2), user: addr(3) });
    const ev = decodePumpEventData(data);
    expect(ev?.kind === "create" && [ev.event.name, ev.event.symbol, ev.event.uri]).toEqual(["Fartcoin", "Fartcoin", "u"]);
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

const ZERO_RESERVES = { virtualTokenReserves: 0n, virtualQuoteReserves: 0n, realTokenReserves: 0n, realQuoteReserves: 0n, tokenTotalSupply: 0n };

describe("decodeBondingCurve", () => {
  it("decodes reserves and supply", () => {
    const state = decodeBondingCurve(
      encodeBondingCurve({ complete: false, virtualTokenReserves: 1n, virtualQuoteReserves: 2n, realTokenReserves: 3n, realQuoteReserves: 4n, tokenTotalSupply: 5n }),
    );
    expect(state).toMatchObject({ virtualTokenReserves: 1n, virtualQuoteReserves: 2n, realTokenReserves: 3n, realQuoteReserves: 4n, tokenTotalSupply: 5n });
  });

  it("decodes a current account", () => {
    const state = decodeBondingCurve(
      encodeBondingCurve({ complete: true, realQuoteReserves: 85n, creator: addr(7), isMayhemMode: true, quoteMint: addr(8) }),
    );
    expect(state).toEqual({ ...ZERO_RESERVES, complete: true, creator: addr(7), isMayhemMode: true, quoteMint: addr(8), realQuoteReserves: 85n });
  });

  it("decodes a legacy 49-byte account", () => {
    const state = decodeBondingCurve(encodeBondingCurve({ complete: false }));
    expect(state).toEqual({ ...ZERO_RESERVES, complete: false, creator: null, isMayhemMode: false, quoteMint: null });
  });

  it("treats an all-zero creator as missing", () => {
    const data = new Uint8Array(150);
    expect(decodeBondingCurve(data).creator).toBeNull();
  });
});

describe("curveMetrics", () => {
  const SUPPLY = 1_000_000_000_000_000n;
  const curve = (over: Partial<Parameters<typeof encodeBondingCurve>[0]>) =>
    decodeBondingCurve(encodeBondingCurve({ complete: false, tokenTotalSupply: SUPPLY, creator: addr(7), ...over }));

  it("prices a fresh curve at about 28 SOL with no progress", () => {
    const m = curveMetrics(curve({ virtualTokenReserves: 1_073_000_000_000_000n, virtualQuoteReserves: 30_000_000_000n, realTokenReserves: 793_100_000_000_000n }));
    expect(m.marketCapSol).toBeCloseTo(27.96, 2);
    expect(m).toMatchObject({ progressPct: 0, realSol: 0, complete: false });
  });

  it("measures progress by tokens sold", () => {
    const m = curveMetrics(
      curve({
        virtualTokenReserves: 676_450_000_000_000n,
        virtualQuoteReserves: 47_587_000_000n,
        realTokenReserves: 396_550_000_000_000n,
        realQuoteReserves: 17_587_000_000n,
      }),
    );
    expect(m.progressPct).toBeCloseTo(50, 5);
    expect(m.realSol).toBeCloseTo(17.587, 5);
    expect(m.marketCapSol).toBeCloseTo(70.35, 1);
  });

  it("reports a finished curve as full with no price", () => {
    expect(curveMetrics(curve({ complete: true }))).toEqual({ marketCapSol: null, progressPct: 100, realSol: 0, complete: true });
  });

  it("has no price when reserves are empty", () => {
    expect(curveMetrics(curve({})).marketCapSol).toBeNull();
  });
});
