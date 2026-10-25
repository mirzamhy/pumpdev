import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { CrosslinksList } from "../components/CrosslinksList";
import { DevHabitsCard } from "../components/DevHabitsCard";
import { DevHistoryTable } from "../components/DevHistoryTable";
import { DevStatusCard } from "../components/DevStatusCard";
import { FunderGraph } from "../components/FunderGraph";
import { FunderTimeline } from "../components/FunderTimeline";
import { HoldersCard } from "../components/HoldersCard";
import { NodeDetail } from "../components/NodeDetail";
import { PriceChart } from "../components/PriceChart";
import { RiskCard } from "../components/RiskCard";
import { SocialsCard } from "../components/SocialsCard";
import { StepProgress } from "../components/StepProgress";
import { TokenHeader } from "../components/TokenHeader";
import { Card, Skeleton } from "../components/ui";
import { fetchQuick } from "../lib/api";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useTrace } from "../lib/useTrace";

export function TokenPage() {
  const { mint } = useParams({ from: "/token/$mint" });
  const { view, retry } = useTrace(mint);
  const [selected, setSelected] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 768px)");
  const selectedNode = view.nodes.find((n) => n.address === selected) ?? null;
  const loading = !view.done;
  // Only worth asking while the full score is still on its way.
  const quick = useQuery({ queryKey: ["quick", mint], queryFn: () => fetchQuick(mint), enabled: !view.score && !view.done, staleTime: 30_000, retry: false });

  if (view.error && !view.token) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-xl font-semibold">Couldn't trace this token</h1>
        <p className="mt-2 text-muted">{view.error}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={retry} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-accent">
            Try again
          </button>
          <Link to="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg">
            New search
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TokenHeader token={view.token} mint={mint} image={view.socials?.image ?? null} />
      <StepProgress steps={view.steps} done={view.done} />
      {view.error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          <span>{view.error}</span>
          <button type="button" onClick={retry} className="rounded-lg border border-line px-3 py-1 text-text hover:border-accent">
            Try again
          </button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <PriceChart mint={mint} />
          <Card title="Funding chain">
            {view.nodes.length === 0 ? (
              <Skeleton className="h-40" />
            ) : wide ? (
              <FunderGraph nodes={view.nodes} selected={selected} onSelect={setSelected} />
            ) : (
              <FunderTimeline nodes={view.nodes} selected={selected} onSelect={setSelected} />
            )}
            <p className="mt-3 text-xs text-muted">Each link is the first SOL transfer the funded wallet ever received.</p>
          </Card>
          <NodeDetail node={selectedNode} onClose={() => setSelected(null)} />
          <HoldersCard holders={view.holders} loading={loading} />
          <DevHistoryTable tokens={view.devHistory} partial={view.devHistoryPartial} loading={loading} />
        </div>
        <div className="space-y-6">
          <RiskCard score={view.score} done={view.done} quick={quick.data ?? null} />
          <SocialsCard socials={view.socials} loading={loading} />
          <DevStatusCard status={view.devStatus} loading={loading} />
          <DevHabitsCard profile={view.devProfile} loading={loading} />
          <CrosslinksList links={view.crosslinks} loading={loading} />
        </div>
      </div>
    </div>
  );
}
