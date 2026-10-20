import { Reader } from "./borsh";
import { SYSTEM_PROGRAM_ID } from "./constants";

export interface BondingCurveState {
  complete: boolean;
  creator: string | null;
  isMayhemMode: boolean;
  quoteMint: string | null;
  realQuoteReserves: bigint;
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
  r.skip(8 * 3);
  const realQuoteReserves = r.u64();
  r.skip(8);
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
  return { complete, creator: unset(creator), isMayhemMode, quoteMint: unset(quoteMint), realQuoteReserves };
}
