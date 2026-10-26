import { Link } from "@tanstack/react-router";
import { shortAddress, type DevToken, type TraceResult } from "@pumpfun/shared";
import { levelTone, toneText } from "../../lib/risk";
import { useExample } from "../../lib/useExample";
import { CopyButton } from "../ui";

const status: Record<DevToken["status"], { dot: string; text: string; label: string }> = {
  dead_dev_exited: { dot: "bg-danger", text: "text-danger", label: "Dead, dev exited" },
  alive: { dot: "bg-muted", text: "text-muted", label: "Still trading" },
  migrated: { dot: "bg-safe", text: "text-safe", label: "Migrated" },
};

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" });

/** Small radial picture of one trace: funders on the left, linked wallets around, launches on the right. */
function ClusterGraph({ r }: { r: TraceResult }) {
  const W = 520, H = 300, cx = 260, cy = 150;
  const funders = r.nodes.filter((n) => n.role === "funder").sort((a, b) => a.depth - b.depth).slice(0, 4);
  const linked = [...new Set(r.crosslinks.map((c) => c.wallet))].filter((w) => w !== r.token.deployer).slice(0, 5);
  const launches = r.devHistory.slice(0, 6);
  const fPos = funders.map((_, i) => ({ x: cx - 70 - i * 52, y: cy - 30 + (i % 2 ? 40 : -10) - i * 6 }));
  const lPos = linked.map((_, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) / Math.max(1, linked.length)) * Math.PI * 0.9 - Math.PI * 0.45;
    return { x: cx + Math.cos(a) * 95, y: cy + Math.sin(a) * 95 - 10 };
  });
  const tPos = launches.map((_, i) => {
    const a = -Math.PI / 3 + (i / Math.max(1, launches.length - 1)) * ((Math.PI * 2) / 3);
    return { x: cx + 150 + Math.cos(a) * 60, y: cy + Math.sin(a) * 110 };
  });
  const tone = (s: DevToken["status"]) => (s === "dead_dev_exited" ? "var(--color-danger)" : s === "migrated" ? "var(--color-safe)" : "var(--color-muted)");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={`Wallet graph: ${funders.length} funders, ${linked.length} linked wallets, ${launches.length} earlier launches`}>
      <defs>
        <radialGradient id="cp-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="45%" stopColor="var(--color-accent-soft)" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" />
        </radialGradient>
        <radialGradient id="cp-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-accent-strong)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={110} fill="url(#cp-halo)" />
      {fPos.map((p, i) => {
        const next = i === 0 ? { x: cx, y: cy } : fPos[i - 1]!;
        return <line key={`f${i}`} x1={p.x} y1={p.y} x2={next.x} y2={next.y} stroke="var(--color-accent)" strokeOpacity="0.7" strokeWidth="2" />;
      })}
      {lPos.map((p, i) => (
        <line key={`l${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--color-accent)" strokeOpacity="0.3" strokeWidth="1.5" />
      ))}
      {tPos.map((p, i) => (
        <line key={`t${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={tone(launches[i]!.status)} strokeOpacity="0.45" strokeWidth="1.5" />
      ))}
      {fPos.map((p, i) => (
        <circle key={`fn${i}`} cx={p.x} cy={p.y} r={9 - i} fill="var(--color-surface-2)" stroke="var(--color-accent)" strokeWidth="2.5" />
      ))}
      {lPos.map((p, i) => (
        <circle key={`ln${i}`} cx={p.x} cy={p.y} r={7} fill="var(--color-surface-2)" stroke="#6f63a8" strokeWidth="2" />
      ))}
      {tPos.map((p, i) => (
        <circle key={`tn${i}`} cx={p.x} cy={p.y} r={8} fill={tone(launches[i]!.status)} fillOpacity="0.85" />
      ))}
      <circle cx={cx} cy={cy} r={20} fill="url(#cp-core)" />
      <text x={cx} y={cy + 42} textAnchor="middle" className="fill-text font-mono text-[13px]">
        {shortAddress(r.token.deployer)}
      </text>
    </svg>
  );
}

export function ClusterPreview() {
  const example = useExample();
  if (!example) return null;
  const { result: r } = example;
  const linked = new Set(r.crosslinks.map((c) => c.wallet).filter((w) => w !== r.token.deployer)).size;
  const funders = r.nodes.filter((n) => n.role === "funder").length;
  const tokens = [
    { mint: r.token.mint, symbol: r.token.symbol, createdAt: r.token.createdAt, status: null as DevToken["status"] | null },
    ...r.devHistory.slice(0, 4).map((t) => ({ mint: t.mint, symbol: t.symbol, createdAt: t.createdAt, status: t.status })),
  ];

  return (
    <section aria-labelledby="preview-title" className="relative">
      <div aria-hidden className="absolute -inset-x-10 -top-10 bottom-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_30%,rgba(106,72,245,0.18),transparent)]" />
      <div className="rounded-3xl border border-line bg-surface/80 p-3 shadow-[0_30px_120px_-40px_rgba(106,72,245,0.55)] sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-2 pb-3 sm:px-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Live from a real trace</span>
            <h2 id="preview-title" className="text-lg font-semibold">
              Developer cluster
            </h2>
            <span className="font-mono text-sm text-muted">{shortAddress(r.token.deployer)}</span>
            <CopyButton value={r.token.deployer} />
          </div>
          <Link to="/token/$mint" params={{ mint: r.token.mint }} className="text-sm text-accent hover:underline">
            Open full trace
          </Link>
        </div>

        <div className="grid gap-3 p-2 pt-4 sm:p-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-line bg-bg/70 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Wallet graph</h3>
              <ul className="flex gap-3 text-xs text-muted">
                <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" />Funder</li>
                <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#6f63a8]" />Linked</li>
                <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-danger" />Dead launch</li>
              </ul>
            </div>
            <div className="mt-2 aspect-[52/30]">
              <ClusterGraph r={r} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-bg/70">
              {[
                { n: r.devHistory.length, label: "Earlier launches" },
                { n: linked, label: "Linked wallets" },
                { n: funders, label: "Known funders" },
              ].map((s) => (
                <div key={s.label} className="p-4">
                  <div className="text-3xl font-semibold tabular-nums">{s.n}</div>
                  <div className="mt-1 text-xs text-muted">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-line bg-bg/70">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold">Deployment history</h3>
                <span className={`text-sm font-semibold tabular-nums ${toneText[levelTone[r.score.level]]}`}>Risk {r.score.score}/100</span>
              </div>
              <ul className="divide-y divide-line text-sm">
                {tokens.map((t) => (
                  <li key={t.mint}>
                    <Link to="/token/$mint" params={{ mint: t.mint }} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{t.symbol ? `$${t.symbol}` : shortAddress(t.mint)}</span>
                        <span className="ml-2 font-mono text-xs text-muted">{shortAddress(t.mint)}</span>
                      </span>
                      <span className="hidden text-xs text-muted sm:block">{t.createdAt ? dateFmt.format(t.createdAt * 1000) : "–"}</span>
                      {t.status ? (
                        <span className={`flex items-center gap-1.5 text-xs ${status[t.status].text}`}>
                          <span className={`h-2 w-2 rounded-full ${status[t.status].dot}`} />
                          {status[t.status].label}
                        </span>
                      ) : (
                        <span className="text-xs text-accent">This token</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {r.score.factors.length > 0 && (
              <ul className="space-y-1.5 rounded-2xl border border-line bg-bg/70 p-4 text-sm">
                {r.score.factors.slice(0, 3).map((f) => (
                  <li key={f.id} className="flex gap-2">
                    <span className="shrink-0 rounded bg-danger/15 px-1.5 text-xs font-semibold tabular-nums text-danger">+{f.points}</span>
                    <span className="text-muted">{f.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
