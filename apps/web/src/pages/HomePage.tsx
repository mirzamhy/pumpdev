import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { shortAddress } from "@pumpfun/shared";
import { fetchRecent } from "../lib/api";
import { ScorePill } from "../components/RiskCard";
import { SearchBox } from "../components/SearchBox";
import { Skeleton } from "../components/ui";

export function HomePage() {
  const recent = useQuery({ queryKey: ["recent"], queryFn: fetchRecent });
  return (
    <div className="mx-auto max-w-3xl py-10 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Who funded the dev?</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Paste a pump.fun token. We follow the dev wallet's first SOL back through up to five wallets, check the dev's past launches, and flag patterns
        common in rugs.
      </p>
      <div className="mt-8">
        <SearchBox autoFocus />
      </div>
      <p className="mt-4 text-sm text-muted">
        Or watch new launches on the{" "}
        <Link to="/screener" className="text-accent hover:underline">
          live screener
        </Link>
        .
      </p>
      <section className="mt-12">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Recently traced</h2>
        <div className="mt-3">
          {recent.isPending ? (
            <Skeleton className="h-32" />
          ) : recent.data && recent.data.length > 0 ? (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {recent.data.map((r) => (
                <li key={r.mint}>
                  <Link to="/token/$mint" params={{ mint: r.mint }} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-2">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{r.symbol ? `$${r.symbol}` : shortAddress(r.mint)}</span>
                      <span className="ml-2 text-sm text-muted">{r.name}</span>
                    </span>
                    <ScorePill score={r.score} level={r.level} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing traced yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
