import { z } from "zod";

export const base58Address = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Not a Solana address");

export const TraceRequest = z.object({ mint: base58Address });
export type TraceRequest = z.infer<typeof TraceRequest>;

export const TOKEN_DECIMALS = 6;

export type TerminalReason = "high_activity" | "unknown_origin" | "max_depth" | "loop" | "incomplete";
export type StepName = "token" | "funders" | "devActivity" | "holders" | "crosslinks" | "score";
export type StepState = "running" | "done" | "incomplete";
export type NodeRole = "deployer" | "creator" | "funder";
export type RiskLevel = "low" | "medium" | "high";
export type JobState = "running" | "done" | "error" | "interrupted";

export interface TokenInfo {
  mint: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  tokenProgram: string | null;
  quoteMint: string | null;
  deployer: string;
  creatorCurrent: string | null;
  creatorOriginal: string | null;
  createdAt: number | null;
  createSignature: string | null;
  createSlot: number | null;
  complete: boolean;
  isMayhemMode: boolean;
  devInitialBuy: string | null;
  createTxFound: boolean;
}

export interface ChainNode {
  address: string;
  depth: number;
  role: NodeRole;
  chainRoot: string;
  fundedBy: string | null;
  fundingAmountLamports: string | null;
  fundedAt: number | null;
  fundingSignature: string | null;
  terminal: TerminalReason | null;
}

export interface DevToken {
  mint: string;
  name: string | null;
  symbol: string | null;
  createdAt: number | null;
  complete: boolean;
  devBalance: string;
  initialBuy: string | null;
  status: "alive" | "migrated" | "dead_dev_exited";
}

export interface DevTransfer {
  to: string;
  amount: string;
  signature: string;
}

export interface DevStatus {
  initialBuy: string | null;
  bought: string;
  sold: string;
  transferredOut: string;
  balance: string;
  releasedPct: number | null;
  transfers: DevTransfer[];
  partial: boolean;
}

export interface Crosslink {
  wallet: string;
  role: NodeRole | "insider";
  otherMint: string;
  otherSymbol: string | null;
}

export interface RiskFactor {
  id: string;
  points: number;
  reason: string;
}

export interface RiskScore {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  incomplete: boolean;
}

export type HolderTag = "dev" | "insider" | "bundle" | "sniper" | "fresh" | "repeatSniper";

export interface Holder {
  address: string;
  amount: string;
  pct: number;
  rank: number;
  tags: HolderTag[];
  cluster: number | null;
  fundedBy: string | null;
  firstSeenAt: number | null;
}

export interface HolderCluster {
  id: number;
  members: string[];
  pct: number;
  linkedToDev: boolean;
  sharedFunder: string | null;
}

export interface EarlyBuyer {
  wallet: string;
  /** 0 = same slot as the create tx (bundle), 1–2 = the next slots (sniper). */
  slotOffset: number;
  bought: string;
  holding: string;
}

export interface HolderAnalysis {
  available: boolean;
  reason: string | null;
  holderCount: number;
  totalSupply: string;
  top: Holder[];
  clusters: HolderCluster[];
  /** null when the creation slot is unknown. */
  earlyBuyers: EarlyBuyer[] | null;
  bundlePct: number | null;
  insiderPct: number | null;
  top10Pct: number | null;
  freshCount: number;
  repeatSnipers: { wallet: string; count: number }[];
}

export type TraceEvent =
  | { type: "step"; data: { step: StepName; state: StepState } }
  | { type: "token"; data: TokenInfo }
  | { type: "node"; data: ChainNode }
  | { type: "devHistory"; data: { tokens: DevToken[]; partial: boolean } }
  | { type: "devStatus"; data: DevStatus }
  | { type: "holders"; data: HolderAnalysis }
  | { type: "crosslinks"; data: Crosslink[] }
  | { type: "score"; data: RiskScore }
  | { type: "done"; data: { partial: boolean } }
  | { type: "error"; data: { message: string } };

export interface TraceResult {
  token: TokenInfo;
  nodes: ChainNode[];
  devHistory: DevToken[];
  devHistoryPartial: boolean;
  devStatus: DevStatus | null;
  holders: HolderAnalysis | null;
  crosslinks: Crosslink[];
  score: RiskScore;
  partial: boolean;
  finishedAt: number;
}

export interface RecentTrace {
  mint: string;
  name: string | null;
  symbol: string | null;
  score: number;
  level: RiskLevel;
  finishedAt: number;
}

export interface WalletView {
  address: string;
  known: boolean;
  chain: ChainNode[];
  deployed: {
    mint: string;
    name: string | null;
    symbol: string | null;
    createdAt: number | null;
    status: DevToken["status"] | null;
  }[];
  appearances: { mint: string; symbol: string | null; role: Crosslink["role"] }[];
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const solFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export function formatTokenAmount(raw: string | bigint): string {
  return compact.format(Number(BigInt(raw)) / 10 ** TOKEN_DECIMALS);
}

export function formatSol(lamports: string | bigint): string {
  return `${solFmt.format(Number(BigInt(lamports)) / 1e9)} SOL`;
}

export function formatPct(n: number): string {
  if (n === 0) return "0%";
  if (n < 0.1) return "<0.1%";
  return `${n.toFixed(1)}%`;
}

export function shortAddress(a: string): string {
  return a.length <= 10 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;
}
