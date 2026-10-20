import { Fragment } from "react";
import { formatTokenAmount, type DevStatus } from "@pumpfun/shared";
import { Address, Card, Skeleton } from "./ui";

export function DevStatusCard({ status, loading }: { status: DevStatus | null; loading: boolean }) {
  if (!status) {
    return <Card title="Dev position">{loading ? <Skeleton className="h-24" /> : <p className="text-sm text-muted">Could not load dev activity.</p>}</Card>;
  }
  const rows: [string, string | null][] = [
    ["Initial buy", status.initialBuy],
    ["Bought later", status.bought],
    ["Sold", status.sold],
    ["Moved to other wallets", status.transferredOut],
    ["Holding now", status.balance],
  ];
  const pct = status.releasedPct;
  return (
    <Card title="Dev position">
      {pct !== null && (
        <div className="mb-4">
          <div className="flex justify-between text-sm">
            <span>Released (sold + moved)</span>
            <span className="tabular-nums">{pct.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Share of dev tokens released">
            <div className={`h-2 rounded-full ${pct >= 50 ? "bg-danger" : pct >= 20 ? "bg-warn" : "bg-safe"}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="text-right tabular-nums">{value === null ? "unknown" : formatTokenAmount(value)}</dd>
          </Fragment>
        ))}
      </dl>
      {status.transfers.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs uppercase tracking-wide text-muted">Moved to</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {status.transfers.map((t) => (
              <li key={`${t.signature}-${t.to}`} className="flex items-center justify-between gap-2">
                <Address value={t.to} />
                <span className="tabular-nums">{formatTokenAmount(t.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {status.partial && <p className="mt-3 text-xs text-warn">The dev has many transactions; only the most recent were checked.</p>}
    </Card>
  );
}
