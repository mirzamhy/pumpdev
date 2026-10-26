import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { curveDumped, shortAddress, type FeedItem } from "@pumpfun/shared";
import { formatMcap, shortAge } from "../lib/format";
import { useMediaQuery } from "../lib/useMediaQuery";
import { levelTone, toneText } from "../lib/risk";
import { ScorePill } from "./RiskCard";
import { Badge, TokenAvatar } from "./ui";

function TokenName({ item }: { item: FeedItem }) {
  return (
    <Link
      to="/token/$mint"
      params={{ mint: item.mint }}
      onClick={(e) => e.stopPropagation()}
      className="group flex min-w-0 items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <TokenAvatar seed={item.mint} label={item.symbol ?? item.name} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium group-hover:text-accent">{item.symbol ? `$${item.symbol}` : shortAddress(item.mint)}</span>
        {item.name && <span className="block truncate text-xs text-muted">{item.name}</span>}
      </span>
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
  const peak = Math.round(item.peakProgressPct);
  const dumped = curveDumped(item);
  const fill = item.complete ? "bg-safe" : dumped ? "bg-danger" : "bg-gradient-to-r from-accent-strong to-accent-soft";
  return (
    <span className="flex items-center gap-2" title={`${item.realSol.toFixed(2)} SOL in the curve${peak > pct ? `, peaked at ${peak}%` : ""}`}>
      <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {peak > pct + 2 && <span className="absolute inset-y-0 left-0 rounded-full bg-muted/25" style={{ width: `${peak}%` }} />}
        <span className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-9 text-right font-mono text-xs tabular-nums text-muted">{pct}%</span>
    </span>
  );
}

function Risk({ item }: { item: FeedItem }) {
  const { state, score, level } = item.trace;
  if (state === "running")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-accent">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
        tracing
      </span>
    );
  if (state === "queued") return <span className="text-xs text-muted">queued</span>;
  if (score !== null && level !== null) return <ScorePill score={score} level={level} />;
  return <QuickPill item={item} />;
}

/** Instant score for untraced tokens, marked with ~ so it never reads as a full trace. */
function QuickPill({ item }: { item: FeedItem }) {
  const { score, level, factors } = item.quick;
  const title =
    factors.length > 0
      ? `Quick check, not a full trace:${factors.map((f) => `\n+${f.points} ${f.reason}`).join("")}`
      : "Quick check found no known red flag. That is not a full trace; open the token to run one.";
  // A clean quick check stays grey: it has not looked at holders or bundles, so it must not look "safe".
  const tone = level === "low" ? "text-muted" : toneText[levelTone[level]];
  return (
    <span className={`inline-flex min-w-9 justify-center rounded-md border border-dashed border-line px-1.5 py-0.5 font-mono text-sm tabular-nums ${tone}`} title={title} aria-label={`Quick score ${score}`}>
      ~{score}
    </span>
  );
}

/** Full trace level when there is one, else the quick check's. */
const riskLevel = (item: FeedItem) => item.trace.level ?? item.quick.level;

export function FeedTable({ items, now }: { items: FeedItem[]; now: number }) {
  const navigate = useNavigate();
  const wide = useMediaQuery("(min-width: 768px)");
  const open = (mint: string) => void navigate({ to: "/token/$mint", params: { mint } });
  // Rows that arrive after the first render get a short highlight so new launches catch the eye.
  const seen = useRef<Set<string> | null>(null);
  // Computed per data refresh, not per clock tick, so the highlight is not cut short.
  const fresh = useMemo(() => new Set(seen.current ? items.filter((i) => !seen.current!.has(i.mint)).map((i) => i.mint) : []), [items]);
  useEffect(() => {
    seen.current = new Set([...(seen.current ?? []), ...items.map((i) => i.mint)]);
  }, [items]);
  const flash = (mint: string) => (fresh.has(mint) ? "row-in" : "");

  if (!wide) {
    return (
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-label="New tokens">
        {items.map((item) => (
          <li key={item.mint} className={`space-y-2 px-4 py-3 ${flash(item.mint)}`} onClick={() => open(item.mint)}>
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
            <tr
              key={item.mint}
              className={`cursor-pointer hover:bg-surface-2 ${flash(item.mint)} ${riskLevel(item) === "high" ? "shadow-[inset_3px_0_0_var(--color-danger)]" : ""}`}
              onClick={() => open(item.mint)}
            >
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
