import { getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { CREATE_EVENT_DISC, EVENT_IX_TAG, TRADE_EVENT_DISC } from "../pump/events";
import { TOKEN_PROGRAM_ID } from "../pump/constants";

const b58enc = getBase58Encoder();
const b58dec = getBase58Decoder();

/** Deterministic valid address: 32 bytes all equal to n (n must be 1..255). */
export function addr(n: number): string {
  return b58dec.decode(new Uint8Array(32).fill(n));
}

export function toBase58(bytes: Uint8Array): string {
  return b58dec.decode(bytes);
}

export class Writer {
  private readonly out: number[] = [];

  u8(v: number): this {
    this.out.push(v & 0xff);
    return this;
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  u32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return this.bytes(b);
  }
  u64(v: bigint): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    return this.bytes(b);
  }
  i64(v: bigint): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, v, true);
    return this.bytes(b);
  }
  bytes(b: Uint8Array): this {
    for (const x of b) this.out.push(x);
    return this;
  }
  pubkey(a: string): this {
    return this.bytes(new Uint8Array(b58enc.encode(a)));
  }
  string(s: string): this {
    const b = new TextEncoder().encode(s);
    return this.u32(b.length).bytes(b);
  }
  build(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

export interface CreateEventInput {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bondingCurve: string;
  user: string;
  /** Omit to produce a legacy (pre-2025) event that ends after `user`. */
  creator?: string;
  timestamp?: number;
  tokenProgram?: string;
  isMayhemMode?: boolean;
}

export function encodeCreateEvent(e: CreateEventInput): Uint8Array {
  const w = new Writer()
    .bytes(EVENT_IX_TAG)
    .bytes(CREATE_EVENT_DISC)
    .string(e.name)
    .string(e.symbol)
    .string(e.uri)
    .pubkey(e.mint)
    .pubkey(e.bondingCurve)
    .pubkey(e.user);
  if (e.creator !== undefined) {
    w.pubkey(e.creator)
      .i64(BigInt(e.timestamp ?? 0))
      .u64(0n)
      .u64(0n)
      .u64(0n)
      .u64(0n)
      .pubkey(e.tokenProgram ?? TOKEN_PROGRAM_ID)
      .bool(e.isMayhemMode ?? false);
  }
  return w.build();
}

export interface TradeEventInput {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: number;
}

export function encodeTradeEvent(e: TradeEventInput): Uint8Array {
  return new Writer()
    .bytes(EVENT_IX_TAG)
    .bytes(TRADE_EVENT_DISC)
    .pubkey(e.mint)
    .u64(e.solAmount)
    .u64(e.tokenAmount)
    .bool(e.isBuy)
    .pubkey(e.user)
    .i64(BigInt(e.timestamp))
    .u64(0n) // trailing fields real events carry; the decoder must ignore them
    .u64(0n)
    .build();
}

export interface MetadataInput {
  name: string;
  symbol: string;
  uri: string;
}

/** Token-2022 mint with MetadataPointer (18) and TokenMetadata (19) extensions, as create_v2 makes. */
export function encodeToken2022Mint(m: MetadataInput, mint: string, supply = 0n): Uint8Array {
  const value = new Writer().bytes(new Uint8Array(32)).pubkey(mint).string(m.name).string(m.symbol).string(m.uri).u32(0).build();
  return new Writer()
    .bytes(encodeSplMint(supply))
    .bytes(new Uint8Array(165 - 82)) // base mint is zero-padded to the account-type offset
    .u8(1) // AccountType::Mint
    .bytes(Uint8Array.of(18, 0, 64, 0))
    .bytes(new Uint8Array(64))
    .bytes(Uint8Array.of(19, 0, value.length & 0xff, value.length >> 8))
    .bytes(value)
    .build();
}

/** 82-byte SPL mint: mint_authority COption(36) | supply u64 | decimals | initialized | freeze_authority COption(36). */
export function encodeSplMint(supply: bigint, decimals = 6): Uint8Array {
  return new Writer().bytes(new Uint8Array(36)).u64(supply).u8(decimals).u8(1).bytes(new Uint8Array(36)).build();
}

const padded = (s: string, len: number) => s + "\0".repeat(Math.max(0, len - new TextEncoder().encode(s).length));

/** Metaplex metadata account; name/symbol/uri are null-padded to 32/10/200 like real accounts. */
export function encodeMetaplexMetadata(m: MetadataInput, mint: string): Uint8Array {
  return new Writer()
    .u8(4) // Key::MetadataV1
    .bytes(new Uint8Array(32))
    .pubkey(mint)
    .string(padded(m.name, 32))
    .string(padded(m.symbol, 10))
    .string(padded(m.uri, 200))
    .bytes(new Uint8Array(40)) // seller fee, creators, ... (ignored)
    .build();
}

export interface BondingCurveInput {
  complete: boolean;
  realQuoteReserves?: bigint;
  /** Omit to produce a legacy 49-byte account without creator. */
  creator?: string;
  isMayhemMode?: boolean;
  quoteMint?: string;
}

export function encodeBondingCurve(c: BondingCurveInput): Uint8Array {
  const w = new Writer()
    .bytes(new Uint8Array(8))
    .u64(0n)
    .u64(0n)
    .u64(0n)
    .u64(c.realQuoteReserves ?? 0n)
    .u64(0n)
    .bool(c.complete);
  if (c.creator !== undefined) {
    w.pubkey(c.creator)
      .bool(c.isMayhemMode ?? false)
      .bool(false)
      .bytes(c.quoteMint ? new Uint8Array(b58enc.encode(c.quoteMint)) : new Uint8Array(32));
  }
  return w.build();
}
