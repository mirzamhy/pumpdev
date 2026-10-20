import { useMemo } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { formatPct, shortAddress, type Holder, type HolderCluster } from "@pumpfun/shared";

/** Distinguishable on the dark surface; cluster n uses CLUSTER_COLORS[(n - 1) % length]. */
export const CLUSTER_COLORS = ["#7cf5b4", "#7cb8f5", "#f5a97c", "#c99cf5", "#f5e27c", "#7cf0f5", "#f58cc8", "#b4f57c"];
const UNCLUSTERED = "#3d5146";
const FLAGGED = new Set(["dev", "insider", "bundle"]);

interface BubbleNode extends SimulationNodeDatum {
  id: string;
  holder: Holder;
  r: number;
}

const radius = (pct: number) => 10 + Math.sqrt(pct) * 14;

export function clusterColor(cluster: number | null): string {
  return cluster === null ? UNCLUSTERED : CLUSTER_COLORS[(cluster - 1) % CLUSTER_COLORS.length]!;
}

function layout(holders: Holder[], clusters: HolderCluster[]) {
  const nodes: BubbleNode[] = holders.map((h) => ({ id: h.address, holder: h, r: radius(h.pct) }));
  // Star-link each cluster to its largest member so members settle next to each other.
  const links: SimulationLinkDatum<BubbleNode>[] = clusters.flatMap((c) => c.members.slice(1).map((m) => ({ source: c.members[0]!, target: m })));
  const sim = forceSimulation(nodes)
    .force("charge", forceManyBody().strength(-6))
    .force("collide", forceCollide<BubbleNode>((d) => d.r + 3).iterations(2))
    // Pull everything toward the middle so unclustered bubbles pack instead of drifting apart.
    .force("x", forceX(0).strength(0.12))
    .force("y", forceY(0).strength(0.12))
    .force(
      "link",
      forceLink<BubbleNode, SimulationLinkDatum<BubbleNode>>(links)
        .id((d) => d.id)
        .distance((l) => (l.source as BubbleNode).r + (l.target as BubbleNode).r + 10)
        .strength(0.7),
    )
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();

  const pad = 8;
  const minX = Math.min(...nodes.map((n) => n.x! - n.r)) - pad;
  const maxX = Math.max(...nodes.map((n) => n.x! + n.r)) + pad;
  const minY = Math.min(...nodes.map((n) => n.y! - n.r)) - pad;
  const maxY = Math.max(...nodes.map((n) => n.y! + n.r)) + pad;
  return { nodes, links: links as { source: BubbleNode; target: BubbleNode }[], viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` };
}

export function BubbleMap({ holders, clusters, onSelect }: { holders: Holder[]; clusters: HolderCluster[]; onSelect: (address: string) => void }) {
  const { nodes, links, viewBox } = useMemo(() => layout(holders, clusters), [holders, clusters]);
  if (holders.length === 0) return null;
  const summary = `Bubble map of the top ${holders.length} holders; ${clusters.length} cluster${clusters.length === 1 ? "" : "s"} of wallets that look like one owner.`;

  return (
    <svg viewBox={viewBox} className="mx-auto block max-h-[420px] w-full" role="img" aria-label={summary}>
      {links.map((l) => (
        <line key={`${l.source.id}-${l.target.id}`} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} stroke={clusterColor(l.target.holder.cluster)} strokeOpacity={0.5} strokeWidth={1.5} />
      ))}
      {nodes.map((n) => {
        const h = n.holder;
        const flagged = h.tags.some((t) => FLAGGED.has(t));
        const label = `#${h.rank} ${shortAddress(h.address)} · ${formatPct(h.pct)}${h.tags.length ? ` · ${h.tags.join(", ")}` : ""}${h.cluster ? ` · cluster ${h.cluster}` : ""}`;
        return (
          <g
            key={n.id}
            transform={`translate(${n.x} ${n.y})`}
            className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-accent [&:hover>circle]:opacity-90"
            role="button"
            tabIndex={0}
            aria-label={label}
            onClick={() => onSelect(h.address)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(h.address);
              }
            }}
          >
            <title>{label}</title>
            <circle r={n.r} fill={clusterColor(h.cluster)} fillOpacity={h.cluster === null ? 1 : 0.85} stroke={flagged ? "#ff6b6b" : "#0a0d0c"} strokeWidth={flagged ? 3 : 1.5} />
            {n.r >= 22 && (
              <text textAnchor="middle" dy="0.35em" className="pointer-events-none select-none font-mono" fontSize={Math.min(14, n.r / 2.2)} fill={h.cluster === null ? "#e6ede8" : "#0a0d0c"}>
                {formatPct(h.pct)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
