import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { shortAddress } from "@pumpfun/shared";
import { DevHabitsCard } from "../components/DevHabitsCard";
import { FunderTimeline } from "../components/FunderTimeline";
import { Badge, Card, CopyButton, Skeleton } from "../components/ui";
import { fetchWallet } from "../lib/api";
import { relTime } from "../lib/format";

export function WalletPage() {
  const { address } = useParams({ from: "/wallet/$address" });
  const navigate = useNavigate();
  const wallet = useQuery({ queryKey: ["wallet", address], queryFn: () => fetchWallet(address) });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted">Wallet</p>
        <h1 className="mt-1 break-all font-mono text-lg">
          {address} <CopyButton value={address} />
        </h1>
        <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-text">
          Solscan ↗
        </a>
      </div>
      {wallet.isPending ? (
        <Skeleton className="h-40" />
      ) : wallet.isError ? (
        <p role="alert" className="text-danger">
          {wallet.error.message}
        </p>
      ) : !wallet.data.known ? (
        <Card>
          <p className="text-sm text-muted">This wallet hasn't appeared in any trace yet. Trace a token it launched or funded to fill this in.</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Funding chain">
            {wallet.data.chain.length > 0 ? (
              <FunderTimeline nodes={wallet.data.chain} selected={address} onSelect={(a) => void navigate({ to: "/wallet/$address", params: { address: a } })} />
            ) : (
              <p className="text-sm text-muted">Funding not traced yet.</p>
            )}
          </Card>
          <div className="space-y-6">
            {wallet.data.profile && <DevHabitsCard profile={wallet.data.profile} />}
            <Card title="Tokens launched">
              {wallet.data.deployed.length === 0 ? (
                <p className="text-sm text-muted">None known.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {wallet.data.deployed.map((t) => (
                    <li key={t.mint} className="flex items-center justify-between gap-2">
                      <Link to="/token/$mint" params={{ mint: t.mint }} className="hover:text-accent">
                        {t.symbol ? `$${t.symbol}` : shortAddress(t.mint)} <span className="text-muted">{t.createdAt ? relTime(t.createdAt) : ""}</span>
                      </Link>
                      {t.status === "dead_dev_exited" && <Badge tone="danger">Dead, dev exited</Badge>}
                      {t.status === "migrated" && <Badge tone="safe">Migrated</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Appears in traces">
              {wallet.data.appearances.length === 0 ? (
                <p className="text-sm text-muted">None.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {wallet.data.appearances.map((a) => (
                    <li key={`${a.mint}-${a.role}`}>
                      <Link to="/token/$mint" params={{ mint: a.mint }} className="text-accent hover:underline">
                        {a.symbol ? `$${a.symbol}` : shortAddress(a.mint)}
                      </Link>{" "}
                      <span className="text-muted">as {a.role}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
