import type { Crosslink } from "@pumpfun/shared";
import type { ParsedTx } from "../chain";
import type { Store, TaintedFunder, WalletRecord } from "../store";

export class MemoryStore implements Store {
  readonly wallets = new Map<string, WalletRecord>();
  readonly txs = new Map<string, ParsedTx>();
  readonly createSignatures = new Map<string, string>();
  crosslinks: Crosslink[] = [];
  tainted: TaintedFunder[] = [];

  findCreateSignature(mint: string): string | null {
    return this.createSignatures.get(mint) ?? null;
  }

  getWallet(address: string): WalletRecord | null {
    return this.wallets.get(address) ?? null;
  }
  putWallet(record: WalletRecord): void {
    this.wallets.set(record.address, record);
  }
  getTx(signature: string): ParsedTx | null {
    return this.txs.get(signature) ?? null;
  }
  putTx(signature: string, tx: ParsedTx): void {
    this.txs.set(signature, tx);
  }
  findCrosslinks(wallets: string[], excludeMint: string): Crosslink[] {
    return this.crosslinks.filter((c) => wallets.includes(c.wallet) && c.otherMint !== excludeMint);
  }
  findTaintedFunders(wallets: string[]): TaintedFunder[] {
    return this.tainted.filter((t) => wallets.includes(t.wallet));
  }
}
