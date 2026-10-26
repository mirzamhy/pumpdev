import { useQuery } from "@tanstack/react-query";
import { Archetypes } from "../components/home/Archetypes";
import { ClusterPreview } from "../components/home/ClusterPreview";
import { HowItWorks } from "../components/home/HowItWorks";
import { LiveNow } from "../components/home/LiveNow";
import { Patterns } from "../components/home/Patterns";
import { LoopVideo } from "../components/LoopVideo";
import { NetworkSphere } from "../components/NetworkSphere";
import { fetchFeed } from "../lib/api";
import { SearchBox } from "../components/SearchBox";

const SEARCH_ID = "trace-input";

function focusSearch() {
  const input = document.getElementById(SEARCH_ID);
  input?.scrollIntoView({ block: "center" });
  input?.focus({ preventScroll: true });
}

/** Real numbers from the live feed; hidden until the first answer arrives. */
function LiveStats() {
  const feed = useQuery({ queryKey: ["feed-home"], queryFn: () => fetchFeed("new", false, 5), refetchInterval: 10_000 });
  const stats = feed.data?.stats;
  if (!stats) return null;
  const items = [
    { n: stats.seenLastHour.toLocaleString("en-US"), label: "launches in the last hour" },
    { n: stats.tracedLastHour.toLocaleString("en-US"), label: "traced" },
    ...(stats.highRiskShare !== null ? [{ n: `${Math.round(stats.highRiskShare * 100)}%`, label: "of traced scored high" }] : []),
  ];
  return (
    <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="sr-only">{i.label}</dt>
          <dd className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{i.n}</span>
            <span className="text-sm text-muted">{i.label}</span>
          </dd>
        </div>
      ))}
      {stats.connected && (
        <div className="flex items-center gap-2 self-center text-sm text-safe">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-safe opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-safe" />
          </span>
          Live
        </div>
      )}
    </dl>
  );
}

export function HomePage() {
  return (
    <div className="space-y-20 pb-10 sm:space-y-28">
      <section id="trace" aria-labelledby="hero-title" className="relative grid scroll-mt-24 items-center gap-8 pt-6 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="relative z-10">
          <h1 id="hero-title" className="text-4xl font-semibold tracking-tight sm:text-6xl">
            Know the dev
            <span className="block text-gradient">before the next launch.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            pumpfun.dev maps deployer wallets, funding links, launch history and recurring behaviour behind new pump.fun memecoins.
          </p>
          <div className="mt-8 max-w-xl">
            <SearchBox id={SEARCH_ID} autoFocus />
          </div>
          <p className="mt-3 text-sm text-muted">Paste a token to trace its dev, or a wallet to see what it launched.</p>
          <LiveStats />
        </div>
        <div className="relative -mx-4 sm:mx-0">
          <LoopVideo
            name="hero"
            width={1600}
            height={1200}
            className="block h-auto w-full [mask-image:radial-gradient(75%_75%_at_50%_50%,#000_55%,transparent_100%)]"
          />
        </div>
      </section>

      <ClusterPreview />
      <HowItWorks />
      <Patterns />
      <Archetypes />
      <LiveNow />

      <section aria-labelledby="cta-title" className="relative overflow-hidden rounded-3xl border border-line bg-surface/60 px-6 py-12 text-center sm:py-16">
        <NetworkSphere className="absolute -left-20 top-1/2 h-80 w-80 -translate-y-1/2 opacity-40" />
        <div className="relative">
          <h2 id="cta-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Trace the wallet <span className="text-gradient">before you trust the launch.</span>
          </h2>
          <p className="mt-3 text-muted">Better research. Fewer surprises.</p>
          <button
            type="button"
            onClick={focusSearch}
            className="mt-6 rounded-full bg-accent-strong px-6 py-3 text-sm font-semibold text-white shadow-[0_0_28px_-6px_var(--color-accent-strong)] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Trace a token
          </button>
        </div>
      </section>
    </div>
  );
}
