import { useNavigate } from "@tanstack/react-router";
import { shortAddress, type DevToken, type WalletView } from "@pumpfun/shared";

export interface GraphLaunch {
  mint: string;
  symbol: string | null;
  status: DevToken["status"] | "dumped" | "live" | null;
}

type Kind = "self" | "funder" | "sibling" | "funded" | "buyer" | "insider" | "launch";

interface GNode {
  id: string;
  kind: Kind;
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  title: string;
  to: { wallet: string } | { mint: string };
}

const W = 960;
const H = 560;
const CX = 430;
const CY = 280;

const launchColor = (s: GraphLaunch["status"]) =>
  s === "dead_dev_exited" || s === "dumped" ? "var(--color-danger)" : s === "migrated" ? "var(--color-safe)" : "var(--color-muted)";

/** Points spread along an arc around (cx, cy), from angle a0 to a1 (radians). */
function arc(n: number, cx: number, cy: number, radius: number, a0: number, a1: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = n === 1 ? (a0 + a1) / 2 : a0 + ((a1 - a0) * i) / (n - 1);
    return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
  });
}

function buildGraph(view: WalletView, launches: GraphLaunch[]) {
  const nodes: GNode[] = [];
  const edges: { from: string; to: string; color: string; dashed?: boolean; width?: number }[] = [];
  const self: GNode = { id: view.address, kind: "self", x: CX, y: CY, r: 26, color: "url(#wg-core)", label: shortAddress(view.address), title: "This wallet", to: { wallet: view.address } };
  nodes.push(self);

  // Funding chain runs to the left, hop by hop.
  let prev = self;
  view.chain
    .filter((n) => n.depth > 0)
    .slice(0, 4)
    .forEach((n, i) => {
      const node: GNode = {
        id: n.address,
        kind: "funder",
        x: CX - 150 - i * 105,
        y: CY + (i % 2 ? 36 : -36),
        r: 14 - i,
        color: "var(--color-accent)",
        label: shortAddress(n.address),
        title: `Funder, hop ${n.depth}${n.terminal === "high_activity" ? " (likely an exchange)" : ""}`,
        to: { wallet: n.address },
      };
      nodes.push(node);
      edges.push({ from: node.id, to: prev.id, color: "var(--color-accent)", width: 2.2 });
      prev = node;
    });

  // Same funder: siblings fan out above the first funder.
  const funderNode = nodes.find((n) => n.kind === "funder");
  const siblings = view.cluster.siblings.slice(0, 7);
  arc(siblings.length, funderNode?.x ?? CX - 150, funderNode?.y ?? CY, 150, -Math.PI * 0.85, -Math.PI * 0.2).forEach((p, i) => {
    const s = siblings[i]!;
    const node: GNode = {
      id: `sib-${s.wallet}`,
      kind: "sibling",
      ...p,
      r: 8 + Math.min(6, s.count),
      color: (s.dead ?? 0) > 0 ? "var(--color-danger)" : "#6f63a8",
      label: shortAddress(s.wallet),
      title: `Same funder · ${s.count} launch${s.count === 1 ? "" : "es"}${s.dead ? `, ${s.dead} dead` : ""}`,
      to: { wallet: s.wallet },
    };
    nodes.push(node);
    edges.push({ from: funderNode?.id ?? self.id, to: node.id, color: "#6f63a8", dashed: true });
  });

  // Wallets this address funded hang below it.
  const funded = view.cluster.funded.slice(0, 6);
  arc(funded.length, CX - 40, CY, 170, Math.PI * 0.45, Math.PI * 0.85).forEach((p, i) => {
    const f = funded[i]!;
    const node: GNode = { id: `fund-${f.wallet}`, kind: "funded", ...p, r: 9, color: "var(--color-accent-soft)", label: shortAddress(f.wallet), title: `Funded by this wallet · ${f.count} launches`, to: { wallet: f.wallet } };
    nodes.push(node);
    edges.push({ from: self.id, to: node.id, color: "var(--color-accent-soft)" });
  });

  // Launches on the right, coloured by how they ended.
  const shown = launches.slice(0, 8);
  arc(shown.length, CX, CY, 260, -Math.PI * 0.32, Math.PI * 0.32).forEach((p, i) => {
    const l = shown[i]!;
    const node: GNode = {
      id: `mint-${l.mint}`,
      kind: "launch",
      ...p,
      r: 12,
      color: launchColor(l.status),
      label: l.symbol ? `$${l.symbol}` : shortAddress(l.mint),
      title: `Launch · ${l.status === "dead_dev_exited" ? "dead, dev exited" : l.status ?? "unknown"}`,
      to: { mint: l.mint },
    };
    nodes.push(node);
    edges.push({ from: self.id, to: node.id, color: launchColor(l.status), width: 1.6 });
  });

  // Repeat early buyers and insiders orbit between the dev and its launches.
  const around = [
    ...view.cluster.repeatBuyers.slice(0, 5).map((b) => ({ ...b, kind: "buyer" as const })),
    ...view.cluster.insiders.slice(0, 4).map((b) => ({ ...b, kind: "insider" as const })),
  ];
  arc(around.length, CX + 40, CY, 150, Math.PI * 0.12, Math.PI * 0.55).forEach((p, i) => {
    const a = around[i]!;
    const node: GNode = {
      id: `${a.kind}-${a.wallet}`,
      kind: a.kind,
      ...p,
      r: 8,
      color: a.kind === "buyer" ? "var(--color-warn)" : "#ff9b6b",
      label: shortAddress(a.wallet),
      title: a.kind === "buyer" ? `Bought early in ${a.count} of this dev's launches` : `Received tokens from the dev in ${a.count} launch${a.count === 1 ? "" : "es"}`,
      to: { wallet: a.wallet },
    };
    nodes.push(node);
    edges.push({ from: self.id, to: node.id, color: node.color, dashed: true });
  });

  return { nodes, edges };
}

export const GRAPH_LEGEND = [
  { color: "var(--color-accent)", label: "Funder" },
  { color: "#6f63a8", label: "Same funder" },
  { color: "var(--color-warn)", label: "Repeat early buyer" },
  { color: "#ff9b6b", label: "Insider" },
  { color: "var(--color-danger)", label: "Dead or dumped" },
  { color: "var(--color-safe)", label: "Migrated" },
];

export function WalletGraph({ view, launches }: { view: WalletView; launches: GraphLaunch[] }) {
  const navigate = useNavigate();
  const { nodes, edges } = buildGraph(view, launches);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const open = (n: GNode) => {
    if ("mint" in n.to) void navigate({ to: "/token/$mint", params: { mint: n.to.mint } });
    else if (n.kind !== "self") void navigate({ to: "/wallet/$address", params: { address: n.to.wallet } });
  };
  const summary = `Wallet graph: ${nodes.filter((n) => n.kind === "funder").length} funders, ${view.cluster.siblings.length} wallets with the same funder, ${
    view.cluster.repeatBuyers.length
  } repeat early buyers, ${launches.length} launches.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label={summary}>
      <defs>
        <radialGradient id="wg-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="45%" stopColor="var(--color-accent-soft)" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" />
        </radialGradient>
        <radialGradient id="wg-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-accent-strong)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={CX} cy={CY} r={220} fill="url(#wg-halo)" />
      {edges.map((e) => {
        const a = byId.get(e.from)!;
        const b = byId.get(e.to)!;
        return (
          <line
            key={`${e.from}>${e.to}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={e.color}
            strokeOpacity={0.55}
            strokeWidth={e.width ?? 1.4}
            strokeDasharray={e.dashed ? "5 6" : undefined}
          />
        );
      })}
      {nodes.map((n) => (
        <g
          key={n.id}
          transform={`translate(${n.x} ${n.y})`}
          role={n.kind === "self" ? undefined : "link"}
          tabIndex={n.kind === "self" ? undefined : 0}
          aria-label={`${n.label}: ${n.title}`}
          onClick={() => open(n)}
          onKeyDown={(e) => {
            if (e.key === "Enter") open(n);
          }}
          className={n.kind === "self" ? "" : "cursor-pointer outline-none [&:focus-visible>circle]:stroke-white [&:hover>circle]:stroke-white"}
        >
          <title>{`${n.label} · ${n.title}`}</title>
          <circle r={n.r} fill={n.color} fillOpacity={n.kind === "self" ? 1 : 0.85} stroke="var(--color-bg)" strokeWidth={2} />
          <text
            y={n.kind === "self" ? n.r + 20 : n.r + 15}
            textAnchor="middle"
            className={`pointer-events-none select-none ${n.kind === "launch" ? "font-sans" : "font-mono"}`}
            fontSize={n.kind === "self" ? 15 : 12}
            fill={n.kind === "self" ? "var(--color-text)" : "var(--color-muted)"}
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
