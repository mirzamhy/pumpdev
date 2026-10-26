import { formatPct, formatTokenAmount, shortAddress, type BundleAnalysis, type EarlyBuyer } from "@pumpfun/shared";
import { Address, Badge } from "./ui";

const slotLabel = (offset: number) => (offset === 0 ? "launch block" : `+${offset} block${offset === 1 ? "" : "s"}`);

function Flag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex gap-2 ${on ? "text-text" : "text-muted"}`}>
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${on ? "bg-danger" : "bg-line"}`} />
      <span>{children}</span>
    </li>
  );
}

/** Launch-block buyers acting together: who funded them, how they bought, what they still hold. */
export function BundleSummary({ bundle, devFunders }: { bundle: BundleAnalysis; devFunders: Set<string> }) {
  const sold = Math.max(0, bundle.boughtPct - bundle.heldPct);
  const heldShare = bundle.boughtPct > 0 ? Math.min(100, (bundle.heldPct / bundle.boughtPct) * 100) : 0;
  return (
    <div className="rounded-2xl border border-line bg-bg/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Launch bundle</h3>
        <span className="text-xs text-muted">{bundle.wallets} wallet{bundle.wallets === 1 ? "" : "s"} bought in the launch block</span>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-muted">
          <span>
            Bought <span className="font-mono text-text">{formatPct(bundle.boughtPct)}</span> of supply
          </span>
          <span>
            still hold <span className={`font-mono ${bundle.heldPct >= 10 ? "text-warn" : "text-text"}`}>{formatPct(bundle.heldPct)}</span> · sold{" "}
            <span className="font-mono text-text">{formatPct(sold)}</span>
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`Bundle still holds ${Math.round(heldShare)}% of what it bought`}>
          <div className="h-full rounded-full bg-warn" style={{ width: `${heldShare}%` }} />
        </div>
      </div>
      <ul className="mt-4 grid gap-1.5 text-sm sm:grid-cols-2">
        <Flag on={bundle.sameTxAsCreate > 0}>
          {bundle.sameTxAsCreate > 0 ? `${bundle.sameTxAsCreate} bought inside the dev's create transaction` : "Nobody bought inside the create transaction"}
        </Flag>
        <Flag on={bundle.fundedByDev > 0}>
          {bundle.fundedByDev > 0 ? `${bundle.fundedByDev} early buyer${bundle.fundedByDev === 1 ? "" : "s"} funded by the dev side` : "No early buyer funded by the dev side"}
        </Flag>
        <Flag on={bundle.multiBuyerTxs > 0}>
          {bundle.multiBuyerTxs > 0 ? `${bundle.multiBuyerTxs} transaction${bundle.multiBuyerTxs === 1 ? "" : "s"} bought for several wallets at once` : "Each launch-block buy was its own transaction"}
        </Flag>
        <Flag on={bundle.uniformBuys}>{bundle.uniformBuys ? "Buy sizes are nearly identical (scripted)" : "Buy sizes vary"}</Flag>
        <Flag on={bundle.sharedFunders.length > 0}>
          {bundle.sharedFunders.length > 0
            ? `${bundle.sharedFunders.reduce((n, f) => n + f.wallets.length, 0)} early buyers share ${bundle.sharedFunders.length} funder${bundle.sharedFunders.length === 1 ? "" : "s"}`
            : "No funder shared by early buyers"}
        </Flag>
        <Flag on={bundle.fresh > 0}>{bundle.fresh > 0 ? `${bundle.fresh} early buyer${bundle.fresh === 1 ? " is a wallet" : "s are wallets"} under a day old` : "No brand-new wallets among early buyers"}</Flag>
      </ul>
      {bundle.sharedFunders.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {bundle.sharedFunders.map((f) => (
            <li key={f.funder} className="flex flex-wrap items-center gap-2 text-muted">
              <Address value={f.funder} />
              {devFunders.has(f.funder) && <Badge tone="danger">dev side</Badge>}
              <span>funded {f.wallets.length} early buyers</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Early buyers grouped by the transaction they bought in; several wallets in one transaction is a bundle by construction. */
export function EarlyBuyerList({ buyers, devFunders }: { buyers: EarlyBuyer[]; devFunders: Set<string> }) {
  const groups = new Map<string, EarlyBuyer[]>();
  for (const b of buyers) {
    const key = b.signature && (b.txBuyers ?? 1) > 1 ? b.signature : `solo:${b.wallet}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return (
    <ul className="mt-2 space-y-2 text-sm">
      {[...groups.entries()].map(([key, group]) => {
        const multi = group.length > 1;
        return (
          <li key={key} className={multi ? "rounded-xl border border-warn/40 bg-warn/5 p-2" : ""}>
            {multi && (
              <p className="mb-1 text-xs text-warn">
                One transaction bought for {group.length} wallets{group[0]!.sameTxAsCreate ? " (the dev's create transaction)" : ""} ·{" "}
                <a href={`https://solscan.io/tx/${group[0]!.signature}`} target="_blank" rel="noreferrer" className="underline">
                  {shortAddress(group[0]!.signature!)}
                </a>
              </p>
            )}
            <ul className="space-y-1">
              {group.map((b) => (
                <li key={b.wallet} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Address value={b.wallet} />
                    <span className="text-muted">{slotLabel(b.slotOffset)}</span>
                    {b.sameTxAsCreate && !multi && <Badge tone="danger">in create tx</Badge>}
                    {b.fundedBy && devFunders.has(b.fundedBy) && <Badge tone="danger">dev-funded</Badge>}
                    {b.fresh && <Badge>fresh</Badge>}
                  </span>
                  <span className="tabular-nums text-muted">
                    bought {formatTokenAmount(b.bought)} · holds <span className={b.holding === "0" ? "" : "text-warn"}>{formatTokenAmount(b.holding)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
