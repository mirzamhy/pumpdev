import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { formatPct, shortAddress, type Holder, type HolderCluster, type HolderTag } from "@pumpfun/shared";

/** Distinguishable on the dark surface; cluster n uses CLUSTER_COLORS[(n - 1) % length]. */
export const CLUSTER_COLORS = ["#8f74ff", "#5cc8ff", "#ff9b6b", "#f5c542", "#3ddc84", "#ff7ac8", "#b9a4ff", "#7cf0f5"];
const UNCLUSTERED = "#2a2450";
const FLAGGED = new Set<HolderTag>(["dev", "insider", "bundle"]);

export function clusterColor(cluster: number | null): string {
  return cluster === null ? UNCLUSTERED : CLUSTER_COLORS[(cluster - 1) % CLUSTER_COLORS.length]!;
}

export type BubbleFilter = "all" | "early" | "clusters" | "fresh" | "dev";

export const FILTERS: { id: BubbleFilter; label: string; match: (h: Holder) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "early", label: "Bundle & snipers", match: (h) => h.tags.some((t) => t === "bundle" || t === "sniper" || t === "repeatSniper") },
  { id: "clusters", label: "Clusters", match: (h) => h.cluster !== null },
  { id: "fresh", label: "Fresh wallets", match: (h) => h.tags.includes("fresh") },
  { id: "dev", label: "Dev & insiders", match: (h) => h.tags.includes("dev") || h.tags.includes("insider") },
];

interface Bubble extends SimulationNodeDatum {
  id: string;
  r: number;
  holder: Holder | null;
  /** Hub for a funder that is not itself a top holder. */
  funder: string | null;
  color: string;
}

const radius = (pct: number) => 10 + Math.sqrt(pct) * 14;
const HUB_R = 6;

/** Funders behind 2+ top holders become visible hubs, so the reason for a cluster is on the map. */
function layout(holders: Holder[]) {
  const byAddress = new Map(holders.map((h) => [h.address, h]));
  const nodes: Bubble[] = holders.map((h) => ({ id: h.address, r: radius(h.pct), holder: h, funder: null, color: clusterColor(h.cluster) }));
  const links: { source: string; target: string; color: string }[] = [];

  const fundedBy = new Map<string, Holder[]>();
  for (const h of holders) if (h.fundedBy) fundedBy.set(h.fundedBy, [...(fundedBy.get(h.fundedBy) ?? []), h]);
  for (const [funder, kids] of fundedBy) {
    const holderFunder = byAddress.get(funder);
    if (holderFunder) {
      for (const k of kids) links.push({ source: funder, target: k.address, color: clusterColor(k.cluster) });
    } else if (kids.length >= 2 && kids.some((k) => k.cluster !== null)) {
      const color = clusterColor(kids.find((k) => k.cluster !== null)!.cluster);
      nodes.push({ id: `hub:${funder}`, r: HUB_R, holder: null, funder, color });
      for (const k of kids) links.push({ source: `hub:${funder}`, target: k.address, color });
    }
  }

  const sim = forceSimulation(nodes)
    .force("charge", forceManyBody<Bubble>().strength((d) => (d.holder ? -8 : -2)))
    .force("collide", forceCollide<Bubble>((d) => d.r + 3).iterations(2))
    .force("x", forceX(0).strength(0.1))
    .force("y", forceY(0).strength(0.1))
    .force(
      "link",
      forceLink<Bubble, SimulationLinkDatum<Bubble>>(links.map((l) => ({ ...l })))
        .id((d) => d.id)
        .distance((l) => (l.source as Bubble).r + (l.target as Bubble).r + 12)
        .strength(0.8),
    )
    .stop();
  for (let i = 0; i < 320; i++) sim.tick();

  const pad = 12;
  const minX = Math.min(...nodes.map((n) => n.x! - n.r)) - pad;
  const maxX = Math.max(...nodes.map((n) => n.x! + n.r)) + pad;
  const minY = Math.min(...nodes.map((n) => n.y! - n.r)) - pad;
  const maxY = Math.max(...nodes.map((n) => n.y! + n.r)) + pad;
  const at = new Map(nodes.map((n) => [n.id, n]));
  return {
    nodes,
    links: links.map((l) => ({ a: at.get(l.source)!, b: at.get(l.target)!, color: l.color })),
    box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

interface View {
  k: number;
  x: number;
  y: number;
}

/** Wheel / pinch zoom and drag pan on an SVG, kept in viewBox units. */
function useZoom(box: { x: number; y: number; w: number; h: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; vx: number; vy: number; id: number } | null>(null);

  useEffect(() => setView({ k: 1, x: 0, y: 0 }), [box]);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      // Plain scrolling keeps scrolling the page; Ctrl/Cmd + wheel (and trackpad pinch, which sets ctrlKey) zooms.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      setView((v) => {
        const k = Math.min(6, Math.max(1, v.k * Math.exp(-e.deltaY * 0.0015)));
        const w0 = box.w / v.k, h0 = box.h / v.k, w1 = box.w / k, h1 = box.h / k;
        return { k, x: v.x + (w0 - w1) * fx, y: v.y + (h0 - h1) * fy };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [box]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      if (view.k === 1) return;
      drag.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y, id: e.pointerId };
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      const svg = ref.current;
      if (!d || !svg || d.id !== e.pointerId) return;
      if (!svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);
      const rect = svg.getBoundingClientRect();
      const scale = box.w / view.k / rect.width;
      setView((v) => ({ ...v, x: d.vx - (e.clientX - d.px) * scale, y: d.vy - (e.clientY - d.py) * scale }));
    },
    onPointerUp: () => {
      drag.current = null;
    },
  };

  const zoomBy = (f: number) =>
    setView((v) => {
      const k = Math.min(6, Math.max(1, v.k * f));
      const w0 = box.w / v.k, h0 = box.h / v.k, w1 = box.w / k, h1 = box.h / k;
      return { k, x: v.x + (w0 - w1) / 2, y: v.y + (h0 - h1) / 2 };
    });
  const viewBox = `${box.x + view.x} ${box.y + view.y} ${box.w / view.k} ${box.h / view.k}`;
  return { ref, viewBox, handlers, zoomBy, reset: () => setView({ k: 1, x: 0, y: 0 }), zoomed: view.k > 1 };
}

export function BubbleMap({
  holders,
  clusters,
  filter,
  selected,
  onSelect,
}: {
  holders: Holder[];
  clusters: HolderCluster[];
  filter: BubbleFilter;
  selected: string | null;
  onSelect: (address: string) => void;
}) {
  const { nodes, links, box } = useMemo(() => layout(holders), [holders]);
  const { ref, viewBox, handlers, zoomBy, reset, zoomed } = useZoom(box);
  if (holders.length === 0) return null;
  const match = FILTERS.find((f) => f.id === filter)!.match;
  const summary = `Bubble map of the top ${holders.length} holders; ${clusters.length} cluster${clusters.length === 1 ? "" : "s"} of wallets that look like one owner.`;
  const btn = "grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface/90 text-sm text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <div className="relative rounded-2xl border border-line bg-bg/60">
      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
        <button type="button" className={btn} onClick={() => zoomBy(1.4)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className={btn} onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
          −
        </button>
        {zoomed && (
          <button type="button" className={btn} onClick={reset} aria-label="Reset zoom">
            ⤢
          </button>
        )}
      </div>
      <svg
        ref={ref}
        viewBox={viewBox}
        className={`mx-auto block h-[420px] w-full touch-none ${zoomed ? "cursor-grab active:cursor-grabbing" : ""}`}
        role="group"
        aria-label={summary}
        {...handlers}
      >
        <defs>
          <filter id="bm-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {links.map((l) => {
          const lit = (!l.a.holder || match(l.a.holder)) && (!l.b.holder || match(l.b.holder));
          return (
            <line
              key={`${l.a.id}-${l.b.id}`}
              x1={l.a.x}
              y1={l.a.y}
              x2={l.b.x}
              y2={l.b.y}
              stroke={l.color}
              strokeOpacity={lit ? 0.6 : 0.08}
              strokeWidth={1.5}
            />
          );
        })}
        {nodes.map((n) => {
          if (!n.holder) {
            const lit = filter === "all" || filter === "clusters";
            return (
              <g key={n.id} transform={`translate(${n.x} ${n.y}) rotate(45)`} opacity={lit ? 1 : 0.15}>
                <title>{`Shared funder ${shortAddress(n.funder!)}`}</title>
                <rect x={-HUB_R} y={-HUB_R} width={HUB_R * 2} height={HUB_R * 2} fill="var(--color-bg)" stroke={n.color} strokeWidth={2} />
              </g>
            );
          }
          const h = n.holder;
          const flagged = h.tags.some((t) => FLAGGED.has(t));
          const lit = match(h);
          const isSel = selected === h.address;
          const label = `#${h.rank} ${shortAddress(h.address)} · ${formatPct(h.pct)}${h.tags.length ? ` · ${h.tags.join(", ")}` : ""}${h.cluster ? ` · cluster ${h.cluster}` : ""}`;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x} ${n.y})`}
              opacity={lit ? 1 : 0.15}
              className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-white [&:hover>circle]:stroke-white"
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={isSel}
              onClick={() => onSelect(h.address)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(h.address);
                }
              }}
            >
              <title>{label}</title>
              <circle
                r={n.r}
                fill={n.color}
                fillOpacity={h.cluster === null ? 1 : 0.85}
                stroke={isSel ? "#ffffff" : flagged ? "var(--color-danger)" : "var(--color-line)"}
                strokeWidth={isSel || flagged ? 3 : 1.5}
                filter={isSel ? "url(#bm-glow)" : undefined}
              />
              {n.r >= 22 && (
                <text textAnchor="middle" dy="0.35em" className="pointer-events-none select-none font-mono" fontSize={Math.min(14, n.r / 2.2)} fill={h.cluster === null ? "var(--color-text)" : "#07060f"}>
                  {formatPct(h.pct)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
