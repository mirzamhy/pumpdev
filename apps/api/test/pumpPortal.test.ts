import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PumpPortalClient, parsePortalMessage, type PortalEvent, type WsLike } from "../src/feed/pumpPortal";

const MINT = "7PD1VtVeoNm7iP7Fxd6hJ9MjTEwyBfeLiyWFUpEYpump";
const DEV = "4zyHbJZ1Yi5UYNSnSZ6iyCxDJrKbjX2U6qgBDVd7jaWN";
const CURVE = "HVLvAqfJ6GXyVPBUBH8DGczHUqfr6qr1xjGUMBEJjEJb";

const create = {
  signature: "sig1",
  mint: MINT,
  traderPublicKey: DEV,
  txType: "create",
  initialBuy: 178833333.33,
  solAmount: 6,
  bondingCurveKey: CURVE,
  vTokensInBondingCurve: 894166666.67,
  vSolInBondingCurve: 36,
  marketCapSol: 40.26,
  name: " DIGITAL SUPERINTELLIGENCE ",
  symbol: "DSI",
  uri: "https://example.com/m.json",
  is_mayhem_mode: false,
  pool: "pump",
};

describe("parsePortalMessage", () => {
  it("parses pump.fun creations", () => {
    expect(parsePortalMessage(JSON.stringify(create))).toEqual({
      type: "create",
      data: {
        signature: "sig1",
        mint: MINT,
        creator: DEV,
        name: "DIGITAL SUPERINTELLIGENCE",
        symbol: "DSI",
        uri: "https://example.com/m.json",
        bondingCurve: CURVE,
        initialBuySol: 6,
        marketCapSol: 40.26,
        vTokens: 894166666.67,
        isMayhemMode: false,
      },
    });
  });

  it("keeps missing optional fields as null", () => {
    const parsed = parsePortalMessage(JSON.stringify({ ...create, bondingCurveKey: null, name: "", solAmount: undefined, is_mayhem_mode: true }));
    expect(parsed).toMatchObject({ type: "create", data: { bondingCurve: null, name: null, initialBuySol: null, isMayhemMode: true } });
  });

  it("ignores other launchpads, confirmations and garbage", () => {
    expect(parsePortalMessage(JSON.stringify({ ...create, pool: "bonk" }))).toBeNull();
    expect(parsePortalMessage(JSON.stringify({ message: "Successfully subscribed to token creation events." }))).toBeNull();
    expect(parsePortalMessage(JSON.stringify({ ...create, mint: "not a mint" }))).toBeNull();
    expect(parsePortalMessage("{oops")).toBeNull();
  });

  it("parses migrations", () => {
    expect(parsePortalMessage(JSON.stringify({ signature: "s2", mint: MINT, txType: "migrate", pool: "pump-amm" }))).toEqual({
      type: "migrate",
      data: { signature: "s2", mint: MINT },
    });
  });
});

class FakeSocket implements WsLike {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

describe("PumpPortalClient", () => {
  let sockets: FakeSocket[];
  let events: PortalEvent[];
  let client: PumpPortalClient;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    events = [];
    client = new PumpPortalClient({
      url: "wss://x",
      onEvent: (e) => events.push(e),
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      idleMs: 60_000,
      maxBackoffMs: 30_000,
    });
  });

  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  it("subscribes on open and forwards events", () => {
    client.start();
    sockets[0]!.onopen?.();
    expect(client.connected).toBe(true);
    expect(sockets[0]!.sent.map((m) => JSON.parse(m).method)).toEqual(["subscribeNewToken", "subscribeMigration"]);
    sockets[0]!.onmessage?.({ data: JSON.stringify(create) });
    sockets[0]!.onmessage?.({ data: JSON.stringify({ message: "ok" }) });
    expect(events.map((e) => e.type)).toEqual(["create"]);
  });

  it("reconnects with growing backoff", () => {
    client.start();
    sockets[0]!.close();
    expect(client.connected).toBe(false);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1]!.close();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it("resets the backoff after a stable connection", () => {
    client.start();
    sockets[0]!.close();
    vi.advanceTimersByTime(1000);
    sockets[1]!.onopen?.();
    for (let i = 0; i < 7; i++) {
      vi.advanceTimersByTime(10_000);
      sockets[1]!.onmessage?.({ data: "{}" });
    }
    sockets[1]!.close();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(3);
  });

  it("reconnects when the stream goes quiet", () => {
    client.start();
    sockets[0]!.onopen?.();
    vi.advanceTimersByTime(60_000);
    expect(sockets[0]!.closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
  });

  it("stops for good", () => {
    client.start();
    sockets[0]!.onopen?.();
    client.stop();
    expect(sockets[0]!.closed).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    expect(client.connected).toBe(false);
  });
});
