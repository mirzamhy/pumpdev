import { getBase58Decoder } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type AccountData,
  type BlockTokenTx,
  type ChainSource,
  type MintHolderAccount,
  type ParsedTx,
  type SignatureInfo,
  type TokenHolding,
} from "@pumpfun/core";
import { RpcError, type RpcPool } from "./rpcPool";

const b58 = getBase58Decoder();
/** -32007 slot skipped, -32009 slot missing in long-term storage: no block to read. */
const NO_BLOCK_CODES = new Set([-32007, -32009]);

interface RawAccount {
  data: [string, string];
  owner: string;
}

interface RawBlock {
  transactions: {
    transaction: { signatures: string[] };
    meta: { err: unknown; preTokenBalances?: BlockTokenTx["preTokenBalances"]; postTokenBalances?: BlockTokenTx["postTokenBalances"] } | null;
  }[];
}

interface RawTokenAccount {
  account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string } } } } };
}

function toAccount(address: string, raw: RawAccount | null): AccountData | null {
  if (!raw) return null;
  return { address, owner: raw.owner, data: new Uint8Array(Buffer.from(raw.data[0], "base64")) };
}

/**
 * Everything reads at `confirmed`: the screener traces tokens seconds after launch, when `finalized`
 * history does not have the creation transaction yet.
 */
export class RpcChainSource implements ChainSource {
  constructor(private readonly pool: RpcPool) {}

  async getSignatures(address: string, opts: { before?: string; limit: number }): Promise<SignatureInfo[]> {
    const rows = await this.pool.call<{ signature: string; slot: number; blockTime: number | null; err: unknown }[]>(
      "getSignaturesForAddress",
      [address, { limit: opts.limit, before: opts.before, commitment: "confirmed" }],
    );
    return rows.map((r) => ({ signature: r.signature, slot: r.slot, blockTime: r.blockTime ?? null, err: r.err ?? null }));
  }

  getTransaction(signature: string): Promise<ParsedTx | null> {
    return this.pool.call<ParsedTx | null>("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" },
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

  /** Fetches only owner + amount (bytes 32..72 of each token account) to keep the response small. */
  async getMintHolders(mint: string, tokenProgram: string): Promise<MintHolderAccount[]> {
    const rows = await this.pool.call<{ pubkey: string; account: RawAccount }[]>("getProgramAccounts", [
      tokenProgram,
      { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: mint } }] },
    ]);
    return rows.map((row) => {
      const bytes = new Uint8Array(Buffer.from(row.account.data[0], "base64"));
      const amount = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getBigUint64(32, true);
      return { owner: b58.decode(bytes.subarray(0, 32)), amount: amount.toString() };
    });
  }

  async getBlockTokenChanges(slot: number): Promise<BlockTokenTx[]> {
    let block: RawBlock | null;
    try {
      block = await this.pool.call<RawBlock | null>("getBlock", [
        slot,
        { encoding: "jsonParsed", transactionDetails: "accounts", maxSupportedTransactionVersion: 1, rewards: false, commitment: "confirmed" },
      ]);
    } catch (err) {
      if (err instanceof RpcError && err.code !== undefined && NO_BLOCK_CODES.has(err.code)) return [];
      throw err;
    }
    if (!block) return [];
    return block.transactions
      .filter((t) => t.meta && !t.meta.err)
      .map((t) => ({
        signature: t.transaction.signatures[0] ?? "",
        preTokenBalances: t.meta!.preTokenBalances ?? [],
        postTokenBalances: t.meta!.postTokenBalances ?? [],
      }));
  }
}
