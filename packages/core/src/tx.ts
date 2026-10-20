import { getBase58Encoder } from "@solana/kit";
import type { ParsedInstruction, ParsedTx, TokenBalance } from "./chain";
import { PUMP_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "./pump/constants";
import { decodePumpEventData, type PumpEvent } from "./pump/events";

const b58 = getBase58Encoder();

export function allInstructions(tx: ParsedTx): ParsedInstruction[] {
  const inner = tx.meta?.innerInstructions.flatMap((g) => g.instructions) ?? [];
  return [...tx.transaction.message.instructions, ...inner];
}

export function accountKeys(tx: ParsedTx): string[] {
  return tx.transaction.message.accountKeys.map((k) => k.pubkey);
}

export function txSignature(tx: ParsedTx): string {
  return tx.transaction.signatures[0] ?? "";
}

export interface SolFunding {
  from: string;
  lamports: bigint;
  signature: string;
  blockTime: number | null;
}

/** First System Program transfer (incl. createAccount) that sends SOL from another wallet into `wallet`. */
export function findSolFunding(tx: ParsedTx, wallet: string): SolFunding | null {
  if (!tx.meta || tx.meta.err) return null;
  for (const ix of allInstructions(tx)) {
    if (ix.programId !== SYSTEM_PROGRAM_ID || !ix.parsed) continue;
    const { type, info } = ix.parsed;
    let to: string | undefined;
    if (type === "transfer" || type === "transferWithSeed") to = info.destination;
    else if (type === "createAccount" || type === "createAccountWithSeed") to = info.newAccount;
    else continue;
    const from: string | undefined = info.source;
    const lamports = BigInt(info.lamports ?? 0);
    if (to === wallet && from && from !== wallet && lamports > 0n) {
      return { from, lamports, signature: txSignature(tx), blockTime: tx.blockTime };
    }
  }
  return null;
}

/** Net change of `mint` per owner within this transaction. */
export function tokenDeltas(tx: ParsedTx, mint: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  if (!tx.meta) return out;
  const add = (b: TokenBalance, sign: bigint) => {
    if (b.mint !== mint || !b.owner) return;
    out.set(b.owner, (out.get(b.owner) ?? 0n) + sign * BigInt(b.uiTokenAmount.amount));
  };
  for (const b of tx.meta.preTokenBalances) add(b, -1n);
  for (const b of tx.meta.postTokenBalances) add(b, 1n);
  return out;
}

export function lamportDelta(tx: ParsedTx, address: string): bigint {
  if (!tx.meta) return 0n;
  const i = accountKeys(tx).indexOf(address);
  if (i < 0) return 0n;
  return BigInt(tx.meta.postBalances[i] ?? 0) - BigInt(tx.meta.preBalances[i] ?? 0);
}

/** True when `owner` received any token other than `excludeMint` (e.g. WSOL or USDC from a swap). */
export function ownerGainedOtherToken(tx: ParsedTx, owner: string, excludeMint: string): boolean {
  if (!tx.meta) return false;
  const mints = new Set(
    [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances].map((b) => b.mint).filter((m) => m !== excludeMint),
  );
  for (const m of mints) if ((tokenDeltas(tx, m).get(owner) ?? 0n) > 0n) return true;
  return false;
}

export function pumpEvents(tx: ParsedTx): PumpEvent[] {
  const out: PumpEvent[] = [];
  for (const ix of allInstructions(tx)) {
    if (ix.programId !== PUMP_PROGRAM_ID || !ix.data) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(b58.encode(ix.data));
    } catch {
      continue;
    }
    const ev = decodePumpEventData(bytes);
    if (ev) out.push(ev);
  }
  return out;
}
