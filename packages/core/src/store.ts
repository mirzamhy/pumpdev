import type { Crosslink } from "@pumpfun/shared";
import type { ParsedTx } from "./chain";

export interface WalletRecord {
  address: string;
  funderResolved: boolean;
  funder: string | null;
  fundingSignature: string | null;
  fundingAmountLamports: string | null;
  fundedAt: number | null;
  terminal: "high_activity" | "unknown_origin" | null;
  /** blockTime of the wallet's oldest signature; null when its history was too long to reach. */
  firstSeenAt: number | null;
  fetchedAt: number;
}

export interface RepeatSniper {
  wallet: string;
  /** Other traced mints where this wallet bought within two slots of creation. */
  count: number;
}

export interface TaintedFunder {
  wallet: string;
  deadCount: number;
}

export interface Store {
  getWallet(address: string): WalletRecord | null;
  putWallet(record: WalletRecord): void;
  getTx(signature: string): ParsedTx | null;
  putTx(signature: string, tx: ParsedTx): void;
  /** Creation tx found by an earlier trace of this mint, so busy tokens skip the history walk. */
  findCreateSignature(mint: string): string | null;
  /** Other traced tokens in which any of `wallets` appeared. */
  findCrosslinks(wallets: string[], excludeMint: string): Crosslink[];
  /** For each wallet: how many "dead, dev exited" tokens it is linked to (as funder of their dev, or as their dev). */
  findTaintedFunders(wallets: string[], excludeMint: string): TaintedFunder[];
  /** Wallets that were early buyers in at least 3 other traced mints. */
  findRepeatSnipers(wallets: string[], excludeMint: string): RepeatSniper[];
}
