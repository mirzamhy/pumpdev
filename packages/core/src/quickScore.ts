import { formatPct, shortAddress, type QuickScore, type RiskFactor } from "@pumpfun/shared";
import { riskLevel } from "./score";

/** Calibrate here. Signals available the moment a token appears, with no extra RPC calls. */
export const QUICK_WEIGHTS = {
  knownDeadDev: 30,
  dumpingLauncher: 25,
  serialLauncher: 15,
  taintedFunder: 20,
  fastSeller: 15,
  dumped: 25,
  recycledSocials: 15,
  bigDevBuy: 10,
  copycat: 5,
} as const;

/** What the database already knows about a token and its creator. */
export interface QuickInput {
  copycatCount: number;
  recycledSocials: boolean;
  dumped: boolean;
  peakProgressPct: number;
  progressPct: number;
  /** Share of total supply the creator bought in the create transaction, 0..100. */
  devBuyPct: number | null;
  /** Earlier launches of this creator that died with the dev exiting (from traces). */
  creatorDeadLaunches: number;
  /** Other launches by this creator seen in the live feed in the last 24 hours. */
  creatorLaunches24h: number;
  /** Of those, how many already dumped their curve. */
  creatorDumped24h: number;
  /** The creator's funder, when a trace cached it, and how many dead launches it is linked to. */
  taintedFunder: { wallet: string; deadCount: number } | null;
  /** From the newest trace where this creator deployed: launches sold within 10 minutes. */
  fastSells: number;
  soldObserved: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A first look for tokens nobody has traced yet. Weaker than the full score: it cannot see bundles,
 * holder clusters or a brand-new creator's funding, so a clean result only means no known red flag.
 */
export function computeQuickScore(input: QuickInput): QuickScore {
  const factors: RiskFactor[] = [];
  const add = (id: keyof typeof QUICK_WEIGHTS, reason: string) => factors.push({ id, points: QUICK_WEIGHTS[id], reason });

  if (input.creatorDeadLaunches >= 2) add("knownDeadDev", `Dev already has ${input.creatorDeadLaunches} dead launches where they exited.`);
  if (input.creatorDumped24h >= 1) {
    add("dumpingLauncher", `${input.creatorDumped24h === 1 ? "Another launch" : `${input.creatorDumped24h} other launches`} by this dev in the last 24 hours already dumped.`);
  } else if (input.creatorLaunches24h >= 2) {
    add("serialLauncher", `Dev launched ${plural(input.creatorLaunches24h, "other token")} in the last 24 hours.`);
  }
  if (input.taintedFunder) {
    add("taintedFunder", `Dev was funded by ${shortAddress(input.taintedFunder.wallet)}, linked to ${plural(input.taintedFunder.deadCount, "dead token")}.`);
  }
  if (input.fastSells >= 2) add("fastSeller", `Dev sold ${input.fastSells} of ${input.soldObserved} earlier launches within 10 minutes.`);
  if (input.dumped) {
    add("dumped", `Curve fell from ${Math.round(input.peakProgressPct)}% to ${Math.round(input.progressPct)}%: holders sold into it.`);
  }
  if (input.recycledSocials) add("recycledSocials", "Reuses the X account, website or image of a token launched at least an hour earlier.");
  if (input.devBuyPct !== null && input.devBuyPct >= 10) add("bigDevBuy", `Dev bought ${formatPct(input.devBuyPct)} of supply at launch and can sell it into buyers.`);
  if (input.copycatCount >= 3) add("copycat", `${input.copycatCount} other tokens used this ticker in the last 24 hours.`);

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  return { score, level: riskLevel(score), factors };
}
