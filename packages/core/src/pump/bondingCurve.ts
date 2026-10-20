import { Reader } from "./borsh";
import { SYSTEM_PROGRAM_ID } from "./constants";

/** `initial_real_token_reserves` of the pump Global account (793.1M tokens, 6 decimals). */
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;

export interface BondingCurveState {
  complete: boolean;
  creator: string | null;
  isMayhemMode: boolean;
  quoteMint: string | null;
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  tokenTotalSupply: bigint;
}

export interface CurveMetrics {
  /** null when the curve holds no reserves (finished, or not readable). */
  marketCapSol: number | null;
  progressPct: number;
  realSol: number;
  complete: boolean;
}

/** All-zero pubkey decodes to the System Program id; treat it as "unset". */
const unset = (a: string | null) => (a === null || a === SYSTEM_PROGRAM_ID ? null : a);

/**
 * Layout (IDL pump.json): discriminator(8) virtual_token_reserves u64, virtual_quote_reserves u64,
 * real_token_reserves u64, real_quote_reserves u64, token_total_supply u64, complete bool,
 * creator pubkey (offset 49), is_mayhem_mode bool, is_cashback_coin bool, quote_mint pubkey, ...
 * Older accounts stop after `complete`, so trailing fields are optional.
 */
export function decodeBondingCurve(data: Uint8Array): BondingCurveState {
  const r = new Reader(data);
  r.skip(8);
  const virtualTokenReserves = r.u64();
  const virtualQuoteReserves = r.u64();
  const realTokenReserves = r.u64();
  const realQuoteReserves = r.u64();
  const tokenTotalSupply = r.u64();
  const complete = r.bool();
  let creator: string | null = null;
  let isMayhemMode = false;
  let quoteMint: string | null = null;
  if (r.remaining >= 32) creator = r.pubkey();
  if (r.remaining >= 2) {
    isMayhemMode = r.bool();
    r.bool();
  }
  if (r.remaining >= 32) quoteMint = r.pubkey();
  return {
    complete,
    creator: unset(creator),
    isMayhemMode,
    quoteMint: unset(quoteMint),
    virtualTokenReserves,
    virtualQuoteReserves,
    realTokenReserves,
    realQuoteReserves,
    tokenTotalSupply,
  };
}

/**
 * Progress counts tokens sold rather than SOL raised: mayhem curves keep SOL reserves off the normal
 * curve, while `virtual - real` token reserves stay constant for every curve type.
 */
export function curveMetrics(s: BondingCurveState): CurveMetrics {
  const realSol = Number(s.realQuoteReserves) / 1e9;
  if (s.complete) return { marketCapSol: null, progressPct: 100, realSol, complete: true };
  const sold = 1 - Number(s.realTokenReserves) / Number(INITIAL_REAL_TOKEN_RESERVES);
  const progressPct = Math.min(100, Math.max(0, sold * 100));
  const marketCapSol =
    s.virtualTokenReserves === 0n ? null : (Number(s.virtualQuoteReserves) / Number(s.virtualTokenReserves)) * (Number(s.tokenTotalSupply) / 1e9);
  return { marketCapSol, progressPct, realSol, complete: false };
}
