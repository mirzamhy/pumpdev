import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { shortAddress } from "@pumpfun/shared";
import { fetchRisky } from "../lib/api";
import { relTime } from "../lib/format";
import { Card, Skeleton } from "../components/ui";

interface Row {
  wallet: string;
  fact: string;
  when: number | null;
}

function WalletList({ title, hint, rows, empty }: { title: string; hint: string; rows: Row[]; empty: string }) {
  return (
    <Card title={title}>
      <p className="-mt-1 mb-3 text-xs text-muted">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {rows.map((r, i) => (
            <li key={r.wallet} className="flex items-baseline gap-3">
              <span className="w-5 shrink-0 text-right font-mono text-xs text-muted tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <Link to="/wallet/$address" params={{ address: r.wallet }} className="font-mono hover:text-accent">
                  {shortAddress(r.wallet)}
                </Link>
                <span className="block text-xs text-muted">{r.fact}</span>
              </span>
              {r.when !== null && <span className="shrink-0 text-xs text-muted">{relTime(r.when)}</span>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function RiskyPage() {
  const risky = useQuery({ queryKey: ["risky"], queryFn: fetchRisky, refetchInterval: 60_000 });

  let body: ReactNode;
  if (risky.isPending) body = <Skeleton className="h-96" />;
  else if (risky.isError)
    body = (
      <p role="alert" className="text-sm text-danger">
        Could not load the lists ({risky.error.message}). Try again in a moment.
      </p>
    );
  else {
    const d = risky.data;
    body = (
      <div className="grid gap-6 lg:grid-cols-2">
        <WalletList
          title="Devs with the most dead launches"
          hint="Earlier launches that died while the dev sold out, from dev histories of traced tokens."
          empty="No dev has two dead launches in our traces yet."
          rows={d.serialDevs.map((r) => ({ wallet: r.wallet, fact: `${plural(r.dead, "launch", "launches")} died with the dev exiting, out of ${r.total} seen`, when: r.lastAt }))}
        />
        <WalletList
          title="Funders behind dead launches"
          hint="Wallets that funded devs whose launches died, counted through traced funding chains."
          empty="No funder links to two dead launches yet."
          rows={d.funders.map((r) => ({ wallet: r.wallet, fact: `Funded ${plural(r.devs, "dev")} with ${plural(r.deadLaunches, "dead launch", "dead launches")}`, when: null }))}
        />
        <WalletList
          title="Early buyers in many launches"
          hint="Bought in the launch block or the next two slots of traced tokens."
          empty="No wallet bought early in three traced launches yet."
          rows={d.snipers.map((r) => ({ wallet: r.wallet, fact: `Bought early in ${plural(r.launches, "traced launch", "traced launches")}`, when: null }))}
        />
        <WalletList
          title="Most launches in the last 24 hours"
          hint="Wallets that signed the most pump.fun creates seen by the live screener. Launchpad tools sign for their users and can appear here."
          empty="No wallet launched three tokens in the last day."
          rows={d.launchers.map((r) => ({ wallet: r.wallet, fact: `Launched ${plural(r.launches, "token")}`, when: r.lastAt }))}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Risky wallets</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Patterns found in tokens this site has traced and launches seen on the live screener. These are heuristics from public on-chain data, not
          accusations: a wallet can land here for innocent reasons, and wallets we have not traced are not listed.
        </p>
      </div>
      {body}
    </div>
  );
}
