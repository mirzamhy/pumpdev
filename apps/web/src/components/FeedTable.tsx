import { Link, useNavigate } from "@tanstack/react-router";
import { curveDumped, shortAddress, type FeedItem } from "@pumpfun/shared";
import { formatMcap, shortAge } from "../lib/format";
import { useMediaQuery } from "../lib/useMediaQuery";
import { ScorePill } from "./RiskCard";
import { Badge } from "./ui";

function TokenName({ item }: { item: FeedItem }) {
  return (
    <Link to="/token/$mint" params={{ mint: item.mint }} onClick={(e) => e.stopPropagation()} className="min-w-0 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
      <span className="font-medium">{item.symbol ? `$${item.symbol}` : shortAddress(item.mint)}</span>
      {item.name && <span className="ml-2 truncate text-sm text-muted">{item.name}</span>}
    </Link>
  );
}

function Flags({ item }: { item: FeedItem }) {
  return (
    <span className="flex flex-wrap gap-1">
      {curveDumped(item) && (
        <Badge tone="danger" title={`Curve fell from ${Math.round(item.peakProgressPct)}% to ${Math.round(item.progressPct)}%: holders sold into it`}>
          dumped
        </Badge>
      )}
      {item.copycatCount > 0 && (
        <Badge tone="warn" title={`${item.copycatCount} other token(s) used this ticker in the last 24 hours`}>
          copycat ×{item.copycatCount}
        </Badge>
      )}
      {item.recycledSocials && (
        <Badge tone="warn" title="Its X account, website or image was already used by a token launched at least an hour earlier">
          recycled
        </Badge>
      )}
      {item.isMayhemMode && <Badge title="Mayhem mode coin (Token-2022, traded by pump.fun's agent)">mayhem</Badge>}
      {item.migratedAt !== null || item.complete ? <Badge tone="safe">migrated</Badge> : null}
      {item.autoTraced && <Badge title="Traced automatically because the curve passed the traction threshold">auto</Badge>}
    </span>
  );
}

function Progress({ item }: { item: FeedItem }) {
  const pct = Math.round(item.progressPct);
  return (
    <span className="flex items-center gap-2" title={`${item.realSol.toFixed(2)} SOL in the curve`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className={`block h-full ${item.complete ? "bg-safe" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-9 text-right font-mono text-xs tabular-nums text-muted">{pct}%</span>
    </span>
  );
}

function Risk({ item }: { item: FeedItem }) {
  const { state, score, level } = item.trace;
  if (state === "running") return <span className="text-xs text-accent">tracing…</span>;
  if (state === "queued") return <span className="text-xs text-muted">queued</span>;
  if (score !== null && level !== null) return <ScorePill score={score} level={level} />;
  return (
    <span className="text-xs text-muted" title="Not traced yet. Open the token to trace it.">
      –
    </span>
  );
}

export function FeedTable({ items, now }: { items: FeedItem[]; now: number }) {
  const navigate = useNavigate();
  const wide = useMediaQuery("(min-width: 768px)");
  const open = (mint: string) => void navigate({ to: "/token/$mint", params: { mint } });

  if (!wide) {
    return (
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-label="New tokens">
        {items.map((item) => (
          <li key={item.mint} className="space-y-2 px-4 py-3" onClick={() => open(item.mint)}>
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 truncate">
                <TokenName item={item} />
              </span>
              <Risk item={item} />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">
                {shortAge(item.createdAt, now)} · {formatMcap(item.marketCapSol)}
              </span>
              <Progress item={item} />
            </div>
            <Flags item={item} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Token</th>
            <th className="px-2 py-2 font-medium">Age</th>
            <th className="px-2 py-2 font-medium">Market cap</th>
            <th className="px-2 py-2 font-medium">Curve</th>
            <th className="px-2 py-2 font-medium">Dev</th>
            <th className="px-2 py-2 font-medium">Flags</th>
            <th className="px-4 py-2 text-right font-medium">Risk</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item) => (
            <tr key={item.mint} className="cursor-pointer hover:bg-surface-2" onClick={() => open(item.mint)}>
              <td className="max-w-64 truncate px-4 py-2.5">
                <TokenName item={item} />
              </td>
              <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-muted">{shortAge(item.createdAt, now)}</td>
              <td className="px-2 py-2.5 font-mono text-xs tabular-nums">{formatMcap(item.marketCapSol)}</td>
              <td className="px-2 py-2.5">
                <Progress item={item} />
              </td>
              <td className="px-2 py-2.5 font-mono text-xs text-muted">{shortAddress(item.creator)}</td>
              <td className="px-2 py-2.5">
                <Flags item={item} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Risk item={item} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
