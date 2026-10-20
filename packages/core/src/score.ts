import {
  formatTokenAmount,
  shortAddress,
  type ChainNode,
  type DevStatus,
  type DevToken,
  type RiskFactor,
  type RiskLevel,
  type RiskScore,
  type TokenInfo,
} from "@pumpfun/shared";
import type { TaintedFunder } from "./store";

/** Calibrate here. Spec section 6.6. */
export const RISK_WEIGHTS = {
  serialDeadDev: 30,
  devReleased: 25,
  devTransferOut: 15,
  freshFunding: 10,
  taintedFunder: 20,
} as const;

export interface ScoreInput {
  token: TokenInfo;
  nodes: ChainNode[];
  devHistory: DevToken[];
  devStatus: DevStatus | null;
  taintedFunders: TaintedFunder[];
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

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  return { score, level: riskLevel(score), factors, incomplete: input.incomplete };
}
