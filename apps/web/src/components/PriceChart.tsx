import { useQuery } from "@tanstack/react-query";
import { base58Address } from "@pumpfun/shared";
import { useMediaQuery } from "../lib/useMediaQuery";
import { Card, Skeleton } from "./ui";

interface GeckoPool {
  attributes: { address: string; reserve_in_usd: string | null };
}

/** The most liquid pool: the bonding curve before migration, usually the PumpSwap pool after. */
async function fetchPool(mint: string): Promise<string | null> {
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(mint)}/pools`, {
    headers: { accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  const body = (await res.json()) as { data?: GeckoPool[] };
  const pools = (body.data ?? []).filter((p) => base58Address.safeParse(p.attributes.address).success);
  pools.sort((a, b) => Number(b.attributes.reserve_in_usd ?? 0) - Number(a.attributes.reserve_in_usd ?? 0));
  return pools[0]?.attributes.address ?? null;
}

function ExternalLinks({ mint }: { mint: string }) {
  return (
    <span className="flex gap-3 text-xs text-muted">
      <a href={`https://www.geckoterminal.com/solana/tokens/${mint}`} target="_blank" rel="noopener noreferrer" className="hover:text-text">
        GeckoTerminal ↗
      </a>
      <a href={`https://dexscreener.com/solana/${mint}`} target="_blank" rel="noopener noreferrer" className="hover:text-text">
        DexScreener ↗
      </a>
    </span>
  );
}

/**
 * GeckoTerminal's embed: DexScreener's embed sits behind a Cloudflare bot check that cannot complete
 * inside an iframe when third-party cookies are blocked, so it hung on "Loading pair…".
 */
export function PriceChart({ mint }: { mint: string }) {
  const wide = useMediaQuery("(min-width: 768px)");
  const pool = useQuery({ queryKey: ["gecko-pool", mint], queryFn: () => fetchPool(mint), staleTime: 10 * 60_000, retry: 1 });
  const height = wide ? 420 : 320;

  let body;
  if (pool.isPending)
    body = (
      <div style={{ height }}>
        <Skeleton className="h-full w-full" />
      </div>
    );
  else if (pool.isError) body = <p className="text-sm text-muted">The chart could not be loaded right now. Use the links above to open it elsewhere.</p>;
  else if (!pool.data) body = <p className="text-sm text-muted">GeckoTerminal has not listed this token yet. New launches usually appear within a few minutes.</p>;
  else
    body = (
      <iframe
        title="Market cap chart"
        src={`https://www.geckoterminal.com/solana/pools/${pool.data}?embed=1&info=0&swaps=0&light_chart=0&chart_type=market_cap&resolution=15m`}
        className="w-full rounded-lg border-0"
        style={{ height }}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    );

  return (
    <Card title="Chart" action={<ExternalLinks mint={mint} />}>
      {body}
      <p className="mt-2 text-xs text-muted">Market cap in USD, from GeckoTerminal.</p>
    </Card>
  );
}
