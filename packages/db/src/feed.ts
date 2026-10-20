import type { FeedItem, RiskLevel } from "@pumpfun/shared";

export interface FeedTokenInput {
  mint: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  creator: string;
  bondingCurve: string;
  createSignature: string | null;
  createdAt: number;
  initialBuySol: number | null;
  isMayhemMode: boolean;
  marketCapSol: number | null;
  progressPct: number;
  realSol: number;
}

export interface FeedCurveUpdate {
  mint: string;
  marketCapSol: number | null;
  progressPct: number;
  realSol: number;
  complete: boolean;
}

export type FeedRow = Omit<FeedItem, "trace"> & { score: number | null; level: RiskLevel | null; tracedAt: number | null };

export interface FeedRowRaw {
  mint: string;
  name: string | null;
  symbol: string | null;
  creator: string;
  created_at: number;
  market_cap_sol: number | null;
  progress_pct: number;
  real_sol: number;
  initial_buy_sol: number | null;
  complete: number;
  migrated_at: number | null;
  mayhem: number;
  copycat_count: number;
  auto_traced_at: number | null;
  score: number | null;
  level: RiskLevel | null;
  traced_at: number | null;
}

export const rawToFeedRow = (r: FeedRowRaw): FeedRow => ({
  mint: r.mint,
  name: r.name,
  symbol: r.symbol,
  creator: r.creator,
  createdAt: r.created_at,
  marketCapSol: r.market_cap_sol,
  progressPct: r.progress_pct,
  realSol: r.real_sol,
  initialBuySol: r.initial_buy_sol,
  complete: r.complete === 1,
  migratedAt: r.migrated_at,
  isMayhemMode: r.mayhem === 1,
  copycatCount: r.copycat_count,
  autoTraced: r.auto_traced_at !== null,
  score: r.score,
  level: r.level,
  tracedAt: r.traced_at,
});

/** Tickers are compared trimmed and case-insensitively; blank tickers never match. */
export const symbolKey = (symbol: string | null): string | null => {
  const key = symbol?.trim().toLowerCase();
  return key ? key : null;
};
