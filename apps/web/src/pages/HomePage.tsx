import { Archetypes } from "../components/home/Archetypes";
import { HowItWorks } from "../components/home/HowItWorks";
import { LiveNow } from "../components/home/LiveNow";
import { Patterns } from "../components/home/Patterns";
import { NetworkSphere } from "../components/NetworkSphere";
import { SearchBox } from "../components/SearchBox";

const SEARCH_ID = "trace-input";

function focusSearch() {
  const input = document.getElementById(SEARCH_ID);
  input?.scrollIntoView({ block: "center" });
  input?.focus({ preventScroll: true });
}

export function HomePage() {
  return (
    <div className="space-y-20 pb-10 sm:space-y-28">
      <section id="trace" aria-labelledby="hero-title" className="relative scroll-mt-24 pt-6 sm:pt-12">
        <NetworkSphere className="absolute -right-24 -top-10 h-[420px] w-[420px] opacity-30 md:-right-10 md:top-0 md:h-[520px] md:w-[520px] md:opacity-90" />
        <div className="relative max-w-2xl">
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
        </div>
      </section>

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
