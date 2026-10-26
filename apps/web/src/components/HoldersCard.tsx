import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { formatPct, formatTokenAmount, type Holder, type HolderAnalysis, type HolderTag } from "@pumpfun/shared";
import { relTime } from "../lib/format";
import type { Tone } from "../lib/risk";
import { BubbleMap, CLUSTER_COLORS, FILTERS, clusterColor, type BubbleFilter } from "./BubbleMap";
import { BundleSummary, EarlyBuyerList } from "./BundleSection";
import { Address, Badge, Card, CopyButton, Skeleton } from "./ui";

const tagStyle: Record<HolderTag, { label: string; tone: Tone; title: string }> = {
  dev: { label: "dev", tone: "danger", title: "The wallet that launched this token, or its creator." },
  insider: { label: "insider", tone: "danger", title: "Received tokens directly from the dev." },
  bundle: { label: "bundle", tone: "warn", title: "Bought in the same block the token was created." },
  sniper: { label: "sniper", tone: "warn", title: "Bought within two blocks of creation." },
  fresh: { label: "fresh wallet", tone: "neutral", title: "This wallet's first activity was less than a day ago." },
  repeatSniper: { label: "repeat sniper", tone: "danger", title: "Bought this early in 3+ other tokens we traced." },
};

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`font-mono text-lg tabular-nums ${warn ? "text-warn" : ""}`}>{value}</div>
    </div>
  );
}

function HolderDetail({ holder, onOpen, onClose }: { holder: Holder; onOpen: () => void; onClose: () => void }) {
  return (
    <div className="rounded-2xl border border-line bg-bg/60 p-4 text-sm" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">Holder #{holder.rank}</p>
          <p className="mt-0.5 break-all font-mono">
            {holder.address} <CopyButton value={holder.address} />
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close holder details">
          ×
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <dt className="text-muted">Share</dt>
        <dd className="text-right font-mono">{formatPct(holder.pct)}</dd>
        <dt className="text-muted">Holds</dt>
        <dd className="text-right font-mono">{formatTokenAmount(holder.amount)}</dd>
        <dt className="text-muted">Funded by</dt>
        <dd className="text-right">{holder.fundedBy ? <Address value={holder.fundedBy} /> : <span className="text-muted">unknown</span>}</dd>
        <dt className="text-muted">First activity</dt>
        <dd className="text-right">{holder.firstSeenAt ? relTime(holder.firstSeenAt) : "–"}</dd>
        <dt className="text-muted">Cluster</dt>
        <dd className="text-right">
          {holder.cluster === null ? (
            "–"
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: clusterColor(holder.cluster) }} />
              {holder.cluster}
            </span>
          )}
        </dd>
      </dl>
      {holder.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {holder.tags.map((t) => (
            <Badge key={t} tone={tagStyle[t].tone} title={tagStyle[t].title}>
              {tagStyle[t].label}
            </Badge>
          ))}
        </div>
      )}
      <button type="button" onClick={onOpen} className="mt-4 w-full rounded-lg bg-accent-strong px-3 py-2 text-sm font-semibold text-white hover:brightness-110">
        Open wallet
      </button>
    </div>
  );
}

export function HoldersCard({ holders, loading, devSide = new Set() }: { holders: HolderAnalysis | null; loading: boolean; devSide?: Set<string> }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<BubbleFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
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
  const selectedHolder = holders.top.find((h) => h.address === selected) ?? null;
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
        <div role="group" aria-label="Highlight holders" className="mb-2 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const count = f.id === "all" ? holders.top.length : holders.top.filter(f.match).length;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full border px-3 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent ${
                  filter === f.id ? "border-accent bg-accent/15 text-text" : "border-line text-muted hover:text-text"
                }`}
              >
                {f.label} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className={selectedHolder ? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]" : ""}>
          <BubbleMap holders={holders.top} clusters={holders.clusters} filter={filter} selected={selected} onSelect={(a) => setSelected(a === selected ? null : a)} />
          {selectedHolder && <HolderDetail holder={selectedHolder} onOpen={() => open(selectedHolder.address)} onClose={() => setSelected(null)} />}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-flex">
              {CLUSTER_COLORS.slice(0, 3).map((c) => (
                <span key={c} className="-mr-1 inline-block size-2.5 rounded-full ring-1 ring-bg" style={{ background: c }} />
              ))}
            </span>
            <span className="ml-1">Same colour: looks like one owner</span>
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rotate-45 border-2 border-accent" />
            Shared funder
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-full border-2 border-danger" />
            Dev, insider or launch-block buyer
          </li>
          <li>Size: share of supply (curve excluded). Click a bubble for details; Ctrl + scroll or pinch to zoom.</li>
        </ul>
      </div>

      {holders.bundle && holders.bundle.wallets > 0 && (
        <div className="mt-4">
          <BundleSummary bundle={holders.bundle} devFunders={devSide} />
        </div>
      )}

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
          <EarlyBuyerList buyers={holders.earlyBuyers} devFunders={devSide} />
        )}
      </div>
    </Card>
  );
}
