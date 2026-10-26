import {
  formatPct,
  formatTokenAmount,
  shortAddress,
  type ChainNode,
  type DevProfile,
  type DevStatus,
  type DevToken,
  type HolderAnalysis,
  type RiskFactor,
  type RiskLevel,
  type RiskScore,
  type TokenInfo,
  type TokenSocials,
} from "@pumpfun/shared";
import type { TaintedFunder } from "./store";

/** Calibrate here. Spec section 6.6 (sub-project 1) and section 5 (holders, sub-project 2). */
export const RISK_WEIGHTS = {
  serialDeadDev: 30,
  devReleased: 25,
  devTransferOut: 15,
  freshFunding: 10,
  taintedFunder: 20,
  bundleHeld: 20,
  insiderSupply: 20,
  holderCluster: 15,
  freshHolders: 10,
  repeatSniper: 10,
  recycledSocials: 15,
  fastSeller: 15,
  devBundle: 20,
} as const;

export interface ScoreInput {
  token: TokenInfo;
  nodes: ChainNode[];
  devHistory: DevToken[];
  devStatus: DevStatus | null;
  taintedFunders: TaintedFunder[];
  holders: HolderAnalysis | null;
  socials?: TokenSocials | null;
  devProfile?: DevProfile | null;
  incomplete: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function riskLevel(score: number): RiskLevel {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function computeScore(input: ScoreInput): RiskScore {
  const { token, nodes, devHistory, devStatus, taintedFunders } = input;
  const factors: RiskFactor[] = [];

  const dead = devHistory.filter((t) => t.status === "dead_dev_exited").length;
  if (devHistory.length >= 3 && dead / devHistory.length >= 0.5) {
    factors.push({
      id: "serialDeadDev",
      points: RISK_WEIGHTS.serialDeadDev,
      reason: `Dev launched ${plural(devHistory.length, "other token")}; ${dead} died with the dev exiting.`,
    });
  }

  if (devStatus?.releasedPct != null && devStatus.releasedPct >= 50) {
    factors.push({
      id: "devReleased",
      points: RISK_WEIGHTS.devReleased,
      reason: `Dev has sold or moved ${Math.round(devStatus.releasedPct)}% of their tokens.`,
    });
  }

  if (devStatus && BigInt(devStatus.transferredOut) > 0n) {
    const receivers = new Set(devStatus.transfers.map((t) => t.to)).size;
    factors.push({
      id: "devTransferOut",
      points: RISK_WEIGHTS.devTransferOut,
      reason: `Dev moved ${formatTokenAmount(devStatus.transferredOut)} tokens to ${plural(receivers, "other wallet")}.`,
    });
  }

  const deployer = nodes.find((n) => n.role === "deployer");
  if (deployer?.fundedAt != null && token.createdAt != null) {
    const gap = token.createdAt - deployer.fundedAt;
    if (gap >= 0 && gap < 3600) {
      factors.push({
        id: "freshFunding",
        points: RISK_WEIGHTS.freshFunding,
        reason: `Dev wallet was funded ${plural(Math.max(1, Math.round(gap / 60)), "minute")} before launch.`,
      });
    }
  }

  if (taintedFunders.length > 0) {
    const worst = [...taintedFunders].sort((a, b) => b.deadCount - a.deadCount)[0]!;
    const extra = taintedFunders.length - 1;
    const more = extra > 0 ? ` (+${extra} more flagged funder${extra === 1 ? "" : "s"})` : "";
    factors.push({
      id: "taintedFunder",
      points: RISK_WEIGHTS.taintedFunder,
      reason: `Funder ${shortAddress(worst.wallet)} is linked to ${plural(worst.deadCount, "dead token")}${more}.`,
    });
  }

  factors.push(...holderFactors(input.holders));

  const reuse = input.socials?.reuse ?? [];
  if (reuse.length > 0) {
    const what = reuse.map((r) => (r.kind === "twitter" ? `X account @${r.value}` : r.kind === "website" ? `website ${r.value}` : "image")).join(", ");
    const older = new Set(reuse.flatMap((r) => r.tokens.map((t) => t.mint))).size;
    factors.push({
      id: "recycledSocials",
      points: RISK_WEIGHTS.recycledSocials,
      reason: `Reuses the ${what} of ${plural(older, "older token")}.`,
    });
  }

  const profile = input.devProfile;
  if (profile && profile.fastSells >= 2) {
    factors.push({
      id: "fastSeller",
      points: RISK_WEIGHTS.fastSeller,
      reason: `Dev sold ${profile.fastSells} of ${profile.soldObserved} earlier launches within 10 minutes of launching.`,
    });
  }

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  return { score, level: riskLevel(score), factors, incomplete: input.incomplete };
}

function holderFactors(h: HolderAnalysis | null): RiskFactor[] {
  if (!h?.available) return [];
  const factors: RiskFactor[] = [];
  if (h.bundlePct !== null && h.bundlePct >= 10) {
    factors.push({
      id: "bundleHeld",
      points: RISK_WEIGHTS.bundleHeld,
      reason: `Wallets that bought in the launch block still hold ${formatPct(h.bundlePct)} of supply.`,
    });
  }
  if (h.insiderPct !== null && h.insiderPct >= 20) {
    factors.push({
      id: "insiderSupply",
      points: RISK_WEIGHTS.insiderSupply,
      reason: `Dev-linked and launch-block wallets hold ${formatPct(h.insiderPct)} of supply.`,
    });
  }
  const b = h.bundle;
  if (b && (b.fundedByDev >= 2 || b.sameTxAsCreate >= 1)) {
    const parts = [
      b.fundedByDev >= 2 ? `${b.fundedByDev} early buyers were funded by the dev side` : null,
      b.sameTxAsCreate >= 1 ? `${plural(b.sameTxAsCreate, "wallet")} bought inside the dev's create transaction` : null,
    ].filter(Boolean);
    factors.push({ id: "devBundle", points: RISK_WEIGHTS.devBundle, reason: `${parts.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()) });
  }
  const cluster = h.clusters.find((c) => c.members.length >= 3 && c.pct >= 10);
  if (cluster) {
    factors.push({
      id: "holderCluster",
      points: RISK_WEIGHTS.holderCluster,
      reason: `${cluster.members.length} top holders that look like one owner hold ${formatPct(cluster.pct)} of supply.`,
    });
  }
  if (h.freshCount >= 5) {
    factors.push({
      id: "freshHolders",
      points: RISK_WEIGHTS.freshHolders,
      reason: `${h.freshCount} of the top 20 holders are wallets less than a day old.`,
    });
  }
  if (h.repeatSnipers.length > 0) {
    const n = h.repeatSnipers.length;
    factors.push({
      id: "repeatSniper",
      points: RISK_WEIGHTS.repeatSniper,
      reason: `${plural(n, "launch-block buyer")} also bought early in 3+ other tokens we traced.`,
    });
  }
  return factors;
}
