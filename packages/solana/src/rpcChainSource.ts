import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type AccountData,
  type ChainSource,
  type ParsedTx,
  type SignatureInfo,
  type TokenHolding,
} from "@pumpfun/core";
import type { RpcPool } from "./rpcPool";

interface RawAccount {
  data: [string, string];
  owner: string;
}

interface RawTokenAccount {
  account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string } } } } };
}

function toAccount(address: string, raw: RawAccount | null): AccountData | null {
  if (!raw) return null;
  return { address, owner: raw.owner, data: new Uint8Array(Buffer.from(raw.data[0], "base64")) };
}

export class RpcChainSource implements ChainSource {
  constructor(private readonly pool: RpcPool) {}

  async getSignatures(address: string, opts: { before?: string; limit: number }): Promise<SignatureInfo[]> {
    const rows = await this.pool.call<{ signature: string; slot: number; blockTime: number | null; err: unknown }[]>(
      "getSignaturesForAddress",
      [address, { limit: opts.limit, before: opts.before, commitment: "finalized" }],
    );
    return rows.map((r) => ({ signature: r.signature, slot: r.slot, blockTime: r.blockTime ?? null, err: r.err ?? null }));
  }

  getTransaction(signature: string): Promise<ParsedTx | null> {
    return this.pool.call<ParsedTx | null>("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "finalized" },
    ]);
  }

  async getAccount(address: string): Promise<AccountData | null> {
    const r = await this.pool.call<{ value: RawAccount | null }>("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]);
    return toAccount(address, r.value);
  }

  async getAccounts(addresses: string[]): Promise<(AccountData | null)[]> {
    if (addresses.length === 0) return [];
    const r = await this.pool.call<{ value: (RawAccount | null)[] }>("getMultipleAccounts", [
      addresses,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    return r.value.map((v, i) => toAccount(addresses[i]!, v));
  }

  async getTokenHoldings(owner: string): Promise<TokenHolding[]> {
    const totals = new Map<string, bigint>();
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const r = await this.pool.call<{ value: RawTokenAccount[] }>("getTokenAccountsByOwner", [
        owner,
        { programId },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]);
      for (const row of r.value) {
        const { mint, tokenAmount } = row.account.data.parsed.info;
        totals.set(mint, (totals.get(mint) ?? 0n) + BigInt(tokenAmount.amount));
      }
    }
    return [...totals].map(([mint, amount]) => ({ mint, amount: amount.toString() }));
  }
}
