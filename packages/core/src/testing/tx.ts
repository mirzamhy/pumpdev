import type { ParsedInstruction, ParsedTx, TokenBalance } from "../chain";
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../pump/constants";
import { toBase58 } from "./encode";

export interface MakeTxInput {
  signature: string;
  blockTime?: number | null;
  err?: unknown;
  accountKeys?: string[];
  instructions?: ParsedInstruction[];
  inner?: ParsedInstruction[];
  preBalances?: number[];
  postBalances?: number[];
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
}

export function makeTx(i: MakeTxInput): ParsedTx {
  return {
    slot: 1,
    blockTime: i.blockTime === undefined ? 1_700_000_000 : i.blockTime,
    meta: {
      err: i.err ?? null,
      preBalances: i.preBalances ?? [],
      postBalances: i.postBalances ?? [],
      preTokenBalances: i.preTokenBalances ?? [],
      postTokenBalances: i.postTokenBalances ?? [],
      innerInstructions: i.inner?.length ? [{ index: 0, instructions: i.inner }] : [],
    },
    transaction: {
      signatures: [i.signature],
      message: {
        accountKeys: (i.accountKeys ?? []).map((pubkey, idx) => ({ pubkey, signer: idx === 0, writable: true })),
        instructions: i.instructions ?? [],
      },
    },
  };
}

export function systemTransfer(from: string, to: string, lamports: number): ParsedInstruction {
  return {
    programId: SYSTEM_PROGRAM_ID,
    program: "system",
    parsed: { type: "transfer", info: { source: from, destination: to, lamports } },
  };
}

export function pumpEventIx(data: Uint8Array): ParsedInstruction {
  return { programId: PUMP_PROGRAM_ID, accounts: [], data: toBase58(data) };
}

export function ammEventIx(data: Uint8Array): ParsedInstruction {
  return { programId: PUMP_AMM_PROGRAM_ID, accounts: [], data: toBase58(data) };
}

export function tokenBal(accountIndex: number, mint: string, owner: string, amount: bigint | number): TokenBalance {
  return { accountIndex, mint, owner, uiTokenAmount: { amount: String(amount), decimals: 6 } };
}
