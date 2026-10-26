import type { DevArchetype, DevArchetypeKind } from "@pumpfun/shared";

/** Everything known about one dev wallet, counted across traced and live-feed launches. */
export interface DevArchetypeInput {
  launches: number;
  dead: number;
  migrated: number;
  dumped: number;
  fastSells: number;
  soldObserved: number;
  launches24h: number;
  siblings: number;
  repeatBuyers: number;
  recycled: number;
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * Labels a dev by its strongest pattern. Points per kind; ties go rugger, recycler, runner.
 * A signal, not a verdict: the page shows the evidence lines next to the label.
 */
export function classifyDev(i: DevArchetypeInput): DevArchetype {
  const points: Record<Exclude<DevArchetypeKind, "unclear">, number> = { rugger: 0, recycler: 0, runner: 0 };
  const evidence: Record<Exclude<DevArchetypeKind, "unclear">, string[]> = { rugger: [], recycler: [], runner: [] };
  const hit = (kind: keyof typeof points, n: number, why: string) => {
    points[kind] += n;
    evidence[kind].push(why);
  };

  if (i.dead >= 2 && i.dead * 2 >= i.launches) hit("rugger", 2, `${i.dead} of ${plural(i.launches, "launch", "launches")} died with the dev exiting.`);
  if (i.fastSells >= 2) hit("rugger", 1, `Sold ${i.fastSells} of ${i.soldObserved} earlier launches within 10 minutes.`);
  if (i.dumped >= 2) hit("rugger", 1, `${i.dumped} launches seen live dumped their curve.`);
  if (i.repeatBuyers >= 2) hit("rugger", 1, `${i.repeatBuyers} wallets bought early in several of this dev's launches.`);

  if (i.launches24h >= 3) hit("recycler", 1, `${plural(i.launches24h, "launch", "launches")} in the last 24 hours.`);
  if (i.siblings >= 2) hit("recycler", 1, `Shares a funder with ${plural(i.siblings, "other dev wallet")}.`);
  if (i.recycled >= 1) hit("recycler", 1, `${plural(i.recycled, "launch", "launches")} reused socials or images of older tokens.`);

  if (i.migrated >= 1 && i.migrated * 10 >= i.launches * 3) hit("runner", 1, `${i.migrated} of ${plural(i.launches, "launch", "launches")} migrated.`);
  if (i.launches >= 2 && i.dead === 0) hit("runner", 1, `None of ${plural(i.launches, "launch", "launches")} died with the dev exiting.`);
  if (i.soldObserved >= 2 && i.fastSells === 0) hit("runner", 1, `Held each launch longer than 10 minutes before selling.`);

  const order = ["rugger", "recycler", "runner"] as const;
  const best = order.reduce((a, b) => (points[b] > points[a] ? b : a));
  if (points[best] === 0) return { kind: "unclear", evidence: [] };
  return { kind: best, evidence: evidence[best] };
}
