import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { shortAddress, type FeedItem } from "@pumpfun/shared";
import { fetchFeed, fetchRecent } from "../../lib/api";
import { shortAge } from "../../lib/format";
import { levelTone, toneText } from "../../lib/risk";
import { ScorePill } from "../RiskCard";
import { Skeleton } from "../ui";

function FeedScore({ item }: { item: FeedItem }) {
  const { score, level } = item.trace;
  if (score !== null && level !== null) return <ScorePill score={score} level={level} />;
  const q = item.quick;
  const tone = q.level === "low" ? "text-muted" : toneText[levelTone[q.level]];
  return (
    <span className={`font-mono text-sm tabular-nums ${tone}`} title="Quick check, not a full trace">
      ~{q.score}
    </span>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/80">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const row = "flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent";

export function LiveNow() {
  const feed = useQuery({ queryKey: ["feed-home"], queryFn: () => fetchFeed("new", false, 5), refetchInterval: 10_000 });
  const recent = useQuery({ queryKey: ["recent"], queryFn: fetchRecent });
  const now = Date.now() / 1000;

  return (
    <section aria-labelledby="live-title">
      <h2 id="live-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Live now
      </h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Panel
          title="Newest launches"
          action={
            <Link to="/screener" className="text-sm text-accent hover:underline">
              Open screener
            </Link>
          }
        >
          {feed.isPending ? (
            <Skeleton className="m-4 h-40" />
          ) : feed.data && feed.data.items.length > 0 ? (
            <ul className="divide-y divide-line">
              {feed.data.items.map((item) => (
                <li key={item.mint}>
                  <Link to="/token/$mint" params={{ mint: item.mint }} className={row}>
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{item.symbol ? `$${item.symbol}` : shortAddress(item.mint)}</span>
                      <span className="ml-2 text-xs text-muted">{shortAge(item.createdAt, now)}</span>
                    </span>
                    <FeedScore item={item} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted">No launches yet. The feed fills within seconds once connected.</p>
          )}
        </Panel>
        <Panel title="Recently traced">
          {recent.isPending ? (
            <Skeleton className="m-4 h-40" />
          ) : recent.data && recent.data.length > 0 ? (
            <ul className="divide-y divide-line">
              {recent.data.slice(0, 5).map((r) => (
                <li key={r.mint}>
                  <Link to="/token/$mint" params={{ mint: r.mint }} className={row}>
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{r.symbol ? `$${r.symbol}` : shortAddress(r.mint)}</span>
                      {r.name && <span className="ml-2 text-xs text-muted">{r.name}</span>}
                    </span>
                    <ScorePill score={r.score} level={r.level} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted">Nothing traced yet.</p>
          )}
        </Panel>
      </div>
    </section>
  );
}
