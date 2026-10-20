import type { AccountData, ChainSource, ParsedTx, SignatureInfo, TokenHolding } from "../chain";

export interface HistoryEntry {
  signature: string;
  blockTime?: number;
  err?: unknown;
  tx?: ParsedTx;
}

export class FakeChain implements ChainSource {
  /** Newest first, like the RPC. */
  readonly sigs = new Map<string, SignatureInfo[]>();
  readonly txs = new Map<string, ParsedTx>();
  readonly accounts = new Map<string, AccountData>();
  readonly holdings = new Map<string, TokenHolding[]>();
  readonly failTx = new Set<string>();
  readonly calls: string[] = [];

  /** `entries` are oldest first. */
  setHistory(address: string, entries: HistoryEntry[]): void {
    const sigs = entries.map((e) => ({
      signature: e.signature,
      slot: 1,
      blockTime: e.blockTime ?? e.tx?.blockTime ?? null,
      err: e.err ?? null,
    }));
    this.sigs.set(address, sigs.reverse());
    for (const e of entries) if (e.tx) this.txs.set(e.signature, e.tx);
  }

  async getSignatures(address: string, opts: { before?: string; limit: number }): Promise<SignatureInfo[]> {
    this.calls.push(`sigs:${address}`);
    const list = this.sigs.get(address) ?? [];
    let start = 0;
    if (opts.before) {
      const idx = list.findIndex((s) => s.signature === opts.before);
      if (idx < 0) return [];
      start = idx + 1;
    }
    return list.slice(start, start + opts.limit);
  }

  async getTransaction(signature: string): Promise<ParsedTx | null> {
    this.calls.push(`tx:${signature}`);
    if (this.failTx.has(signature)) throw new Error("rpc down");
    return this.txs.get(signature) ?? null;
  }

  async getAccount(address: string): Promise<AccountData | null> {
    this.calls.push(`account:${address}`);
    return this.accounts.get(address) ?? null;
  }

  async getAccounts(addresses: string[]): Promise<(AccountData | null)[]> {
    this.calls.push(`accounts:${addresses.length}`);
    return addresses.map((a) => this.accounts.get(a) ?? null);
  }

  async getTokenHoldings(owner: string): Promise<TokenHolding[]> {
    this.calls.push(`holdings:${owner}`);
    return this.holdings.get(owner) ?? [];
  }
}
