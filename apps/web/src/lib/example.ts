import type { DevToken, RecentTrace, TraceResult } from "@pumpfun/shared";

/** A real traced token laid out as the home page's four steps. */
export interface ExampleSteps {
  mint: string;
  symbol: string | null;
  score: number;
  funder: string | null;
  deployer: string;
  linked: string[];
  launches: { mint: string; symbol: string | null; status: DevToken["status"] }[];
}

/** Up to `max` high-score candidates, newest first. */
export function exampleCandidates(recent: RecentTrace[], max = 5): string[] {
  return recent.filter((r) => r.score >= 60).slice(0, max).map((r) => r.mint);
}

/** How much of the story a trace can show: earlier launches, funders, wallets seen elsewhere. */
const richness = (r: TraceResult) =>
  Number(r.devHistory.length > 0) + Number(r.nodes.some((n) => n.role === "funder")) + Number(r.crosslinks.length > 0);

/** The candidate that shows the most; ties go to the newest. */
export function chooseExample(results: (TraceResult | undefined)[]): TraceResult | null {
  let best: TraceResult | null = null;
  for (const r of results) if (r && (!best || richness(r) > richness(best))) best = r;
  return best;
}

export function exampleSteps(r: TraceResult): ExampleSteps {
  const deployer = r.token.deployer;
  const funders = r.nodes.filter((n) => n.role === "funder").sort((a, b) => a.depth - b.depth);
  // Wallets seen in other traces say the most; deeper funders fill the rest.
  const candidates = [...r.crosslinks.map((c) => c.wallet), ...funders.slice(1).map((n) => n.address)];
  const linked = [...new Set(candidates.filter((w) => w !== deployer))].slice(0, 3);
  return {
    mint: r.token.mint,
    symbol: r.token.symbol,
    score: r.score.score,
    funder: funders[0]?.address ?? null,
    deployer,
    linked,
    launches: r.devHistory.slice(0, 3).map((t) => ({ mint: t.mint, symbol: t.symbol, status: t.status })),
  };
}
