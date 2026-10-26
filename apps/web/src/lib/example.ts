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

/** Newest trace scored high; recent traces arrive newest first. */
export function pickExampleMint(recent: RecentTrace[]): string | null {
  return recent.find((r) => r.score >= 60)?.mint ?? null;
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
