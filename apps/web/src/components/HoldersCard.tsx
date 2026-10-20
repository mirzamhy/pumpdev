import { useNavigate } from "@tanstack/react-router";
import { formatPct, formatTokenAmount, type HolderAnalysis, type HolderTag } from "@pumpfun/shared";
import type { Tone } from "../lib/risk";
import { BubbleMap, clusterColor } from "./BubbleMap";
import { Address, Badge, Card, Skeleton } from "./ui";

const tagStyle: Record<HolderTag, { label: string; tone: Tone; title: string }> = {
  dev: { label: "dev", tone: "danger", title: "The wallet that launched this token, or its creator." },
  insider: { label: "insider", tone: "danger", title: "Received tokens directly from the dev." },
  bundle: { label: "bundle", tone: "warn", title: "Bought in the same block the token was created." },
  sniper: { label: "sniper", tone: "warn", title: "Bought within two blocks of creation." },
  fresh: { label: "fresh wallet", tone: "neutral", title: "This wallet's first activity was less than a day ago." },
  repeatSniper: { label: "repeat sniper", tone: "danger", title: "Bought this early in 3+ other tokens we traced." },
};

const slotLabel = (offset: number) => (offset === 0 ? "launch block" : `+${offset} block${offset === 1 ? "" : "s"}`);

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`font-mono text-lg tabular-nums ${warn ? "text-warn" : ""}`}>{value}</div>
    </div>
  );
}

export function HoldersCard({ holders, loading }: { holders: HolderAnalysis | null; loading: boolean }) {
  const navigate = useNavigate();
  if (!holders) {
    return <Card title="Holders">{loading ? <Skeleton className="h-48" /> : <p className="text-sm text-muted">Holder analysis did not finish (RPC error or time limit). Try the trace again in a minute.</p>}</Card>;
  }
  if (!holders.available) {
    return (
      <Card title="Holders">
        <p className="text-sm text-muted">
          {holders.reason === "migrated"
            ? "Skipped: this token has migrated to PumpSwap, and listing every holder of a migrated token is too heavy for free RPC."
            : "Holder analysis is not available for this token."}
        </p>
      </Card>
    );
  }

  const open = (address: string) => void navigate({ to: "/wallet/$address", params: { address } });
  const pct = (n: number | null) => (n === null ? "unknown" : formatPct(n));

  return (
    <Card title="Holders">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Holders" value={holders.holderCount.toLocaleString("en-US")} />
        <Stat label="Insider share" value={pct(holders.insiderPct)} warn={(holders.insiderPct ?? 0) >= 20} />
        <Stat label="Launch-block buyers" value={pct(holders.bundlePct)} warn={(holders.bundlePct ?? 0) >= 10} />
        <Stat label="Top 10" value={pct(holders.top10Pct)} />
      </div>

      <div className="mt-4">
        <BubbleMap holders={holders.top} clusters={holders.clusters} onSelect={open} />
        <p className="mt-2 text-xs text-muted">
          Bubble size is share of supply (bonding curve excluded). Same color = wallets that look like one owner (shared funder, funded by each other or by the dev).
          Red ring = dev, insider or launch-block buyer.
        </p>
      </div>

      {holders.clusters.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {holders.clusters.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <span aria-hidden className="inline-block size-3 rounded-full" style={{ background: clusterColor(c.id) }} />
              <span>
                Cluster {c.id}: {c.members.length} wallets hold {formatPct(c.pct)}
                {c.linkedToDev && <span className="text-danger"> · linked to dev</span>}
              </span>
              {c.sharedFunder && (
                <span className="text-muted">
                  funded by <Address value={c.sharedFunder} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Wallet</th>
              <th className="py-2 pr-3 text-right font-medium">Supply</th>
              <th className="py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {holders.top.map((h) => (
              <tr key={h.address}>
                <td className="py-1.5 pr-3 tabular-nums text-muted">{h.rank}</td>
                <td className="whitespace-nowrap py-1.5 pr-3">
                  <span className="inline-flex items-center gap-2">
                    {h.cluster !== null && <span aria-label={`cluster ${h.cluster}`} className="inline-block size-2.5 rounded-full" style={{ background: clusterColor(h.cluster) }} />}
                    <Address value={h.address} />
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatPct(h.pct)}</td>
                <td className="py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {h.tags.map((t) => (
                      <Badge key={t} tone={tagStyle[t].tone} title={tagStyle[t].title}>
                        {tagStyle[t].label}
                      </Badge>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <h3 className="text-xs uppercase tracking-wide text-muted">Early buyers</h3>
        {holders.earlyBuyers === null ? (
          <p className="mt-2 text-sm text-muted">Unknown: the creation transaction could not be found.</p>
        ) : holders.earlyBuyers.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nobody else bought in the launch block or the two after it.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {holders.earlyBuyers.map((b) => (
              <li key={b.wallet} className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <Address value={b.wallet} />
                  <span className="text-muted">{slotLabel(b.slotOffset)}</span>
                </span>
                <span className="tabular-nums text-muted">
                  bought {formatTokenAmount(b.bought)} · holds <span className={b.holding === "0" ? "" : "text-warn"}>{formatTokenAmount(b.holding)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
