import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { FeedStats, FeedTab } from "@pumpfun/shared";
import { fetchFeed } from "../lib/api";
import { FeedTable } from "../components/FeedTable";
import { Skeleton } from "../components/ui";

const TABS: { id: FeedTab; label: string; hint: string }[] = [
  { id: "new", label: "New", hint: "Newest launches first" },
  { id: "hot", label: "Hot", hint: "Furthest along the bonding curve, last 6 hours" },
  { id: "traced", label: "Traced", hint: "Tokens with a risk score, newest score first" },
];

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Tile({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</p>
      {children}
    </div>
  );
}

function StatTiles({ stats }: { stats: FeedStats }) {
  const share = stats.highRiskShare === null ? null : Math.round(stats.highRiskShare * 100);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Feed stats">
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <p className="text-xs text-muted">Feed</p>
        <p className="mt-1 inline-flex items-center gap-2 text-xl font-semibold">
          <span aria-hidden className="relative flex size-2.5">
            {stats.connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-safe opacity-60 motion-reduce:hidden" />}
            <span className={`relative inline-flex size-2.5 rounded-full ${stats.connected ? "bg-safe" : "bg-warn"}`} />
          </span>
          {stats.connected ? "Live" : "Reconnecting"}
        </p>
      </div>
      <Tile label="New tokens, last hour" value={String(stats.seenLastHour)} />
      <Tile label="Traced, last hour" value={String(stats.tracedLastHour)} hint="Traced automatically or opened by someone" />
      <Tile label="Traced that scored high" value={share === null ? "–" : `${share}%`}>
        {share !== null && (
          <span aria-hidden className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-danger" style={{ width: `${share}%` }} />
          </span>
        )}
      </Tile>
    </div>
  );
}

function emptyMessage(tab: FeedTab, hideHigh: boolean, connected: boolean): string {
  if (hideHigh && tab !== "new") return "Nothing left after hiding high-risk tokens. Turn the filter off to see them.";
  if (tab === "traced") return "Nothing traced yet. Tokens are traced automatically once 40% of their curve sells, or as soon as you open one.";
  if (tab === "hot") return "No token on the curve has picked up traction in the last 6 hours yet.";
  return connected ? "Waiting for the next launch. New tokens appear here within seconds." : "Not connected to the token feed yet. It retries on its own.";
}

export function ScreenerPage() {
  const [tab, setTab] = useState<FeedTab>("new");
  const [hideHigh, setHideHigh] = useState(false);
  const now = useNow(1000);
  const feed = useQuery({
    queryKey: ["feed", tab, hideHigh],
    queryFn: () => fetchFeed(tab, hideHigh),
    refetchInterval: 4000,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live screener</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Every new pump.fun launch, as it happens. Tokens that sell 40% of their curve in the first 15 minutes are traced automatically; open any
          other token to trace it. Untraced tokens show a quick score (~) from what we already know about the dev, the socials and the curve.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Sort" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              title={t.hint}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent ${
                tab === t.id ? "bg-surface-2 text-text" : "text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={hideHigh} onChange={(e) => setHideHigh(e.target.checked)} className="accent-[var(--color-accent)]" />
          Hide high risk
        </label>
      </div>

      {feed.data ? <StatTiles stats={feed.data.stats} /> : <Skeleton className="h-20" />}

      {feed.isPending ? (
        <Skeleton className="h-96" />
      ) : feed.isError && !feed.data ? (
        <p role="alert" className="rounded-xl border border-line bg-surface p-4 text-sm text-danger">
          Could not load the feed ({feed.error.message}). Retrying every few seconds.
        </p>
      ) : feed.data && feed.data.items.length > 0 ? (
        <FeedTable items={feed.data.items} now={now} />
      ) : (
        <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">{emptyMessage(tab, hideHigh, feed.data?.stats.connected ?? false)}</p>
      )}
    </div>
  );
}
