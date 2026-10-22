import type { Crosslink, SocialReuse } from "@pumpfun/shared";
import type { ParsedTx } from "../chain";
import type { RepeatSniper, SocialKeys, Store, TaintedFunder, TokenMetaRecord, WalletRecord } from "../store";

export class MemoryStore implements Store {
  readonly wallets = new Map<string, WalletRecord>();
  readonly txs = new Map<string, ParsedTx>();
  readonly createSignatures = new Map<string, string>();
  crosslinks: Crosslink[] = [];
  tainted: TaintedFunder[] = [];
  repeatSnipers: RepeatSniper[] = [];
  readonly metas = new Map<string, TokenMetaRecord>();

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
  findRepeatSnipers(wallets: string[]): RepeatSniper[] {
    return this.repeatSnipers.filter((r) => wallets.includes(r.wallet));
  }
  findTaintedFunders(wallets: string[]): TaintedFunder[] {
    return this.tainted.filter((t) => wallets.includes(t.wallet));
  }
  getTokenMeta(mint: string): TokenMetaRecord | null {
    return this.metas.get(mint) ?? null;
  }
  putTokenMeta(record: TokenMetaRecord): void {
    this.metas.set(record.mint, record);
  }
  findSocialReuse(mint: string, createdAt: number, keys: SocialKeys): { reuse: SocialReuse[]; sameTweetCount: number } {
    const others = [...this.metas.values()].filter((m) => m.mint !== mint && m.ok);
    const older = others.filter((m) => m.createdAt <= createdAt - 3600);
    const reuse: SocialReuse[] = [];
    const add = (kind: SocialReuse["kind"], value: string | null, match: (m: TokenMetaRecord) => boolean) => {
      if (!value) return;
      const tokens = older.filter(match).map((m) => ({ mint: m.mint, symbol: null, createdAt: m.createdAt }));
      if (tokens.length) reuse.push({ kind, value, tokens });
    };
    add("twitter", keys.twitterHandle, (m) => m.twitter?.kind === "account" && m.twitter.handle === keys.twitterHandle);
    add("website", keys.websiteKey, (m) => m.websiteKey === keys.websiteKey);
    add("image", keys.imageKey, (m) => m.imageKey === keys.imageKey);
    const sameTweetCount = keys.tweetId ? others.filter((m) => m.twitter?.tweetId === keys.tweetId).length : 0;
    return { reuse, sameTweetCount };
  }
}
