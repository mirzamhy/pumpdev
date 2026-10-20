import { createHash } from "node:crypto";
import { Reader } from "./borsh";

const disc = (s: string): Uint8Array => new Uint8Array(createHash("sha256").update(s).digest()).subarray(0, 8);

/**
 * Prefix of every Anchor event emitted through self-CPI (`emit_cpi!`).
 * Anchor reads sha256("anchor:event")[..8] as a big-endian u64 and writes it little-endian,
 * so the on-chain bytes are the hash prefix reversed: e445a52e51cb9a1d.
 */
export const EVENT_IX_TAG = disc("anchor:event").slice().reverse();
export const CREATE_EVENT_DISC = disc("event:CreateEvent");
export const TRADE_EVENT_DISC = disc("event:TradeEvent");

export interface CreateEvent {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bondingCurve: string;
  user: string;
  creator: string | null;
  timestamp: number | null;
  tokenProgram: string | null;
  isMayhemMode: boolean;
}

export interface TradeEvent {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: number;
}

export type PumpEvent = { kind: "create"; event: CreateEvent } | { kind: "trade"; event: TradeEvent };

function startsWith(data: Uint8Array, prefix: Uint8Array, at: number): boolean {
  if (data.length < at + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[at + i] !== prefix[i]) return false;
  return true;
}

function decodeCreate(body: Uint8Array): CreateEvent {
  const r = new Reader(body);
  const name = r.string();
  const symbol = r.string();
  const uri = r.string();
  const mint = r.pubkey();
  const bondingCurve = r.pubkey();
  const user = r.pubkey();
  let creator: string | null = null;
  let timestamp: number | null = null;
  let tokenProgram: string | null = null;
  let isMayhemMode = false;
  if (r.remaining >= 32) creator = r.pubkey();
  if (r.remaining >= 8) timestamp = Number(r.i64());
  // virtual_token_reserves, virtual_sol_reserves, real_token_reserves, token_total_supply
  if (r.remaining >= 32 + 32) {
    r.skip(32);
    tokenProgram = r.pubkey();
  }
  if (r.remaining >= 1) isMayhemMode = r.bool();
  return { name, symbol, uri, mint, bondingCurve, user, creator, timestamp, tokenProgram, isMayhemMode };
}

function decodeTrade(body: Uint8Array): TradeEvent {
  const r = new Reader(body);
  const mint = r.pubkey();
  const solAmount = r.u64();
  const tokenAmount = r.u64();
  const isBuy = r.bool();
  const user = r.pubkey();
  const timestamp = Number(r.i64());
  return { mint, solAmount, tokenAmount, isBuy, user, timestamp };
}

/** Decodes the data of a self-CPI event instruction. Returns null for anything else. */
export function decodePumpEventData(data: Uint8Array): PumpEvent | null {
  if (!startsWith(data, EVENT_IX_TAG, 0)) return null;
  const body = data.subarray(16);
  try {
    if (startsWith(data, CREATE_EVENT_DISC, 8)) return { kind: "create", event: decodeCreate(body) };
    if (startsWith(data, TRADE_EVENT_DISC, 8)) return { kind: "trade", event: decodeTrade(body) };
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
  return null;
}
