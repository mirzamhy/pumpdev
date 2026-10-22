import type { DevProfile } from "@pumpfun/shared";
import { Card, Skeleton } from "./ui";

const oneDecimal = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));
const duration = (minutes: number) => (minutes < 1 ? `${Math.max(1, Math.round(minutes * 60))} sec` : `${oneDecimal(minutes)} min`);

export function DevHabitsCard({ profile, loading = false }: { profile: DevProfile | null; loading?: boolean }) {
  if (!profile) {
    return <Card title="Dev habits">{loading ? <Skeleton className="h-24" /> : <p className="text-sm text-muted">Could not load dev activity.</p>}</Card>;
  }
  const rows: [string, string, boolean][] = [];
  if (profile.launches > 0) {
    rows.push(["Earlier launches", `${profile.launches} (${profile.dead} dead, ${profile.migrated} migrated)`, profile.dead >= 2]);
    if (profile.launchesPerDay !== null) rows.push(["Launch rate", `${oneDecimal(profile.launchesPerDay)} per day`, profile.launchesPerDay >= 3]);
    if (profile.medianMinutesToSell !== null) {
      rows.push(["Typical time to first sell", duration(profile.medianMinutesToSell), profile.medianMinutesToSell <= 10]);
      rows.push(["Sold within 10 minutes", `${profile.fastSells} of ${profile.soldObserved}`, profile.fastSells >= 2]);
    }
  }
  rows.push(["Creator fee claims", profile.feeClaims > 0 ? `${profile.feeClaims} (${oneDecimal(profile.feeClaimedSol)} SOL)` : "None seen", false]);

  return (
    <Card title="Dev habits">
      {profile.launches === 0 && <p className="mb-3 text-sm text-muted">No earlier launches in the dev's recent transactions.</p>}
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value, bad]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className={`text-right tabular-nums ${bad ? "text-danger" : ""}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">
        {profile.partial ? "From the dev's 60 most recent transactions; older activity is not counted." : "From all of the dev's transactions."}
      </p>
    </Card>
  );
}
