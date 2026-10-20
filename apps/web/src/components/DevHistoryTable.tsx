import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { shortAddress, type DevToken } from "@pumpfun/shared";
import { relTime } from "../lib/format";
import { Badge, Card, Skeleton } from "./ui";

const statusBadge: Record<DevToken["status"], ReactNode> = {
  alive: <Badge>Active</Badge>,
  migrated: <Badge tone="safe">Migrated</Badge>,
  dead_dev_exited: <Badge tone="danger">Dead, dev exited</Badge>,
};

export function DevHistoryTable({ tokens, partial, loading }: { tokens: DevToken[] | null; partial: boolean; loading: boolean }) {
  return (
    <Card title="Dev's other launches">
      {tokens === null ? (
        loading ? <Skeleton className="h-24" /> : <p className="text-sm text-muted">Could not load.</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted">No other pump.fun launches found from this dev wallet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Token</th>
                <th className="py-2 pr-4 font-medium">Launched</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tokens.map((t) => (
                <tr key={t.mint}>
                  <td className="py-2 pr-4">
                    <Link to="/token/$mint" params={{ mint: t.mint }} className="hover:text-accent">
                      {t.symbol ? `$${t.symbol}` : shortAddress(t.mint)}
                    </Link>{" "}
                    <span className="text-muted">{t.name}</span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-muted">{t.createdAt ? relTime(t.createdAt) : "unknown"}</td>
                  <td className="py-2">{statusBadge[t.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {partial && <p className="mt-3 text-xs text-warn">Only the dev's most recent transactions were scanned; older launches may be missing.</p>}
    </Card>
  );
}
