import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { curveDumped, shortAddress, type ClusterWallet, type DevArchetypeKind, type DevToken, type QuickScore, type RiskLevel, type WalletView } from "@pumpfun/shared";
import { DevHabitsCard } from "../components/DevHabitsCard";
import { FunderTimeline } from "../components/FunderTimeline";
import { ScorePill } from "../components/RiskCard";
import { Address, Badge, Card, CopyButton, Skeleton } from "../components/ui";
import { GRAPH_LEGEND, WalletGraph, type GraphLaunch } from "../components/WalletGraph";
import { fetchWallet } from "../lib/api";
import { relTime } from "../lib/format";
import { levelTone, toneText } from "../lib/risk";

interface LaunchRow {
  mint: string;
  symbol: string | null;
  name: string | null;
  createdAt: number | null;
  status: DevToken["status"] | null;
  progressPct: number | null;
  dumped: boolean;
  migrated: boolean;
  recycled: boolean;
  score: number | null;
  level: RiskLevel | null;
  quick: QuickScore | null;
}

/** Traced launches and live-feed launches, one row per mint, newest first. */
export function mergeLaunches(view: WalletView): LaunchRow[] {
  const rows = new Map<string, LaunchRow>();
  for (const d of view.deployed) {
    rows.set(d.mint, {
      mint: d.mint,
      symbol: d.symbol,
      name: d.name,
      createdAt: d.createdAt,
      status: d.status,
      progressPct: null,
      dumped: false,
      migrated: d.status === "migrated",
      recycled: false,
      score: null,
      level: null,
      quick: null,
    });
  }
  for (const f of view.feedLaunches) {
    const prev = rows.get(f.mint);
    rows.set(f.mint, {
      mint: f.mint,
      symbol: prev?.symbol ?? f.symbol,
      name: prev?.name ?? f.name,
      createdAt: prev?.createdAt ?? f.createdAt,
      status: prev?.status ?? null,
      progressPct: f.progressPct,
      dumped: curveDumped(f),
      migrated: (prev?.migrated ?? false) || f.complete || f.migratedAt !== null,
      recycled: f.recycledSocials,
      score: f.score,
      level: f.level,
      quick: f.quick,
    });
  }
  return [...rows.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

const graphStatus = (r: LaunchRow): GraphLaunch["status"] =>
  r.status === "dead_dev_exited" ? r.status : r.dumped ? "dumped" : r.migrated ? "migrated" : r.status ?? "live";

const ARCHETYPE: Record<DevArchetypeKind, { label: string; tone: string; ring: string; blurb: string }> = {
  rugger: { label: "Rugger pattern", tone: "text-danger", ring: "border-danger/50 bg-danger/10", blurb: "Launches fast, exits faster." },
  recycler: { label: "Recycler pattern", tone: "text-warn", ring: "border-warn/50 bg-warn/10", blurb: "Reuses money, wallets or branding across launches." },
  runner: { label: "Runner pattern", tone: "text-accent", ring: "border-accent/50 bg-accent/10", blurb: "Longer activity, cleaner history." },
  unclear: { label: "Not enough data", tone: "text-muted", ring: "border-line bg-surface-2", blurb: "Trace one of its launches to learn more." },
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "graph", label: "Wallet graph" },
  { id: "launches", label: "Launches" },
  { id: "funding", label: "Funding" },
  { id: "behaviour", label: "Behaviour" },
];

function Stat({ value, label, tone = "" }: { value: string | number; label: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/80 px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}

function WalletList({ items, empty, describe }: { items: ClusterWallet[]; empty: string; describe: (w: ClusterWallet) => string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2 text-sm">
      {items.map((w) => (
        <li key={w.wallet} className="flex flex-wrap items-center justify-between gap-2">
          <Address value={w.wallet} />
          <span className="text-muted">{describe(w)}</span>
        </li>
      ))}
    </ul>
  );
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function LaunchTable({ rows }: { rows: LaunchRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No launches known yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">Token</th>
            <th className="py-2 pr-3 font-medium">Launched</th>
            <th className="py-2 pr-3 font-medium">Curve</th>
            <th className="py-2 pr-3 font-medium">Outcome</th>
            <th className="py-2 text-right font-medium">Risk</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.mint}>
              <td className="max-w-56 truncate py-2 pr-3">
                <Link to="/token/$mint" params={{ mint: r.mint }} className="hover:text-accent">
                  <span className="font-medium">{r.symbol ? `$${r.symbol}` : shortAddress(r.mint)}</span>
                  {r.name && <span className="ml-2 text-muted">{r.name}</span>}
                </Link>
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-muted">{r.createdAt ? relTime(r.createdAt) : "–"}</td>
              <td className="py-2 pr-3 font-mono text-xs tabular-nums text-muted">{r.progressPct === null ? "–" : `${Math.round(r.progressPct)}%`}</td>
              <td className="py-2 pr-3">
                <span className="flex flex-wrap gap-1">
                  {r.status === "dead_dev_exited" && <Badge tone="danger">dead, dev exited</Badge>}
                  {r.dumped && <Badge tone="danger">dumped</Badge>}
                  {r.migrated && <Badge tone="safe">migrated</Badge>}
                  {r.recycled && <Badge tone="warn">recycled socials</Badge>}
                  {!r.status && !r.dumped && !r.migrated && <span className="text-xs text-muted">trading</span>}
                </span>
              </td>
              <td className="py-2 text-right">
                {r.score !== null && r.level !== null ? (
                  <ScorePill score={r.score} level={r.level} />
                ) : r.quick ? (
                  <span className={`font-mono text-sm tabular-nums ${r.quick.level === "low" ? "text-muted" : toneText[levelTone[r.quick.level]]}`} title="Quick check, not a full trace">
                    ~{r.quick.score}
                  </span>
                ) : (
                  <span className="text-xs text-muted">–</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClusterView({ view }: { view: WalletView }) {
  const navigate = useNavigate();
  const launches = mergeLaunches(view);
  const dead = launches.filter((l) => l.status === "dead_dev_exited").length;
  const migrated = launches.filter((l) => l.migrated).length;
  const linked = new Set([...view.cluster.siblings, ...view.cluster.funded, ...view.cluster.repeatBuyers, ...view.cluster.insiders].map((w) => w.wallet)).size;
  const funders = view.chain.filter((n) => n.depth > 0).length;
  const a = ARCHETYPE[view.archetype.kind];
  const newest = launches[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
      <nav aria-label="Sections" className="hidden lg:block">
        <ul className="sticky top-24 space-y-1 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="block rounded-lg px-3 py-2 text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-6">
        <section id="overview" className="scroll-mt-24 space-y-4">
          <div className={`rounded-2xl border p-4 ${a.ring}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className={`text-lg font-semibold ${a.tone}`}>{a.label}</h2>
              <span className="text-xs text-muted">Patterns are signals, not verdicts.</span>
            </div>
            <p className="mt-1 text-sm text-muted">{a.blurb}</p>
            {view.archetype.evidence.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {view.archetype.evidence.map((e) => (
                  <li key={e} className="flex gap-2">
                    <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${a.tone.replace("text-", "bg-")}`} />
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat value={launches.length} label="Launches known" />
            <Stat value={dead} label="Dead, dev exited" tone={dead > 0 ? "text-danger" : ""} />
            <Stat value={migrated} label="Migrated" tone={migrated > 0 ? "text-safe" : ""} />
            <Stat value={linked} label="Linked wallets" />
            <Stat value={funders} label="Known funders" />
            <Stat value={view.firstSeenAt ? relTime(view.firstSeenAt) : "–"} label="First activity" />
          </div>
        </section>

        <section id="graph" className="scroll-mt-24">
          <Card
            title="Wallet graph"
            action={
              newest && (
                <button
                  type="button"
                  onClick={() => void navigate({ to: "/token/$mint", params: { mint: newest.mint } })}
                  className="rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                >
                  Trace newest launch
                </button>
              )
            }
          >
            <WalletGraph view={view} launches={launches.map((l) => ({ mint: l.mint, symbol: l.symbol, status: graphStatus(l) }))} />
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {GRAPH_LEGEND.map((l) => (
                <li key={l.label} className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                  {l.label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Click a wallet or token to open it. Built from traces on this site and the live feed.</p>
          </Card>
        </section>

        <section id="launches" className="scroll-mt-24">
          <Card title={`Launches (${launches.length})`}>
            <LaunchTable rows={launches} />
          </Card>
        </section>

        <section id="funding" className="scroll-mt-24 grid gap-6 xl:grid-cols-2">
          <Card title="Funding chain">
            {view.chain.length > 0 ? (
              <FunderTimeline nodes={view.chain} selected={view.address} onSelect={(addr) => void navigate({ to: "/wallet/$address", params: { address: addr } })} />
            ) : (
              <p className="text-sm text-muted">Funding not traced yet. Trace one of its launches to follow the money.</p>
            )}
          </Card>
          <div className="space-y-6">
            <Card title="Same funder">
              {view.cluster.funder && (
                <p className="mb-3 text-sm text-muted">
                  Wallets also first funded by <Address value={view.cluster.funder} />
                </p>
              )}
              <WalletList
                items={view.cluster.siblings}
                empty={view.cluster.funder ? "No other wallets from this funder yet." : "Funder unknown or an exchange."}
                describe={(w) => `${plural(w.count, "launch", "launches")}${w.dead ? `, ${w.dead} dead` : ""}`}
              />
            </Card>
            <Card title="Funded by this wallet">
              <WalletList items={view.cluster.funded} empty="None seen." describe={(w) => plural(w.count, "launch", "launches")} />
            </Card>
          </div>
        </section>

        <section id="behaviour" className="scroll-mt-24 grid gap-6 xl:grid-cols-2">
          {view.profile ? <DevHabitsCard profile={view.profile} /> : <Card title="Dev habits"><p className="text-sm text-muted">Shown after one of its launches is traced.</p></Card>}
          <div className="space-y-6">
            <Card title="Repeat early buyers">
              <WalletList items={view.cluster.repeatBuyers} empty="No wallet bought early in two or more of its traced launches." describe={(w) => `early in ${w.count} launches`} />
            </Card>
            <Card title="Insiders">
              <WalletList items={view.cluster.insiders} empty="The dev sent tokens to no one in traced launches." describe={(w) => `received tokens in ${plural(w.count, "launch", "launches")}`} />
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}

export function WalletPage() {
  const { address } = useParams({ from: "/wallet/$address" });
  const wallet = useQuery({ queryKey: ["wallet", address], queryFn: () => fetchWallet(address) });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Developer cluster</p>
          <h1 className="mt-1 break-all font-mono text-lg sm:text-xl">
            {address} <CopyButton value={address} />
          </h1>
        </div>
        <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-text">
          Solscan ↗
        </a>
      </header>
      {wallet.isPending ? (
        <Skeleton className="h-96" />
      ) : wallet.isError ? (
        <p role="alert" className="text-danger">
          {wallet.error.message}
        </p>
      ) : !wallet.data.known ? (
        <Card>
          <p className="text-sm text-muted">This wallet hasn't appeared in any trace or in the live feed yet. Trace a token it launched or funded to fill this in.</p>
        </Card>
      ) : (
        <ClusterView view={wallet.data} />
      )}
    </div>
  );
}
