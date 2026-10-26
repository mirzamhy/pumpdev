import { Link } from "@tanstack/react-router";
import { shortAddress, type DevToken } from "@pumpfun/shared";
import type { ExampleSteps } from "../../lib/example";
import { useExample } from "../../lib/useExample";
import { LoopVideo } from "../LoopVideo";

const statusDot: Record<DevToken["status"], { color: string; label: string }> = {
  dead_dev_exited: { color: "bg-danger", label: "dead, dev exited" },
  alive: { color: "bg-muted", label: "still trading" },
  migrated: { color: "bg-safe", label: "migrated" },
};

function WalletChip({ address }: { address: string }) {
  return (
    <Link
      to="/wallet/$address"
      params={{ address }}
      className="flex items-center gap-2 rounded-lg border border-line bg-bg/60 px-3 py-2 font-mono text-sm hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
      {shortAddress(address)}
    </Link>
  );
}

interface Step {
  title: string;
  hint: string;
  body: (e: ExampleSteps) => React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Funding source",
    hint: "Where the dev wallet got its first SOL, followed back up to five wallets.",
    body: (e) => (e.funder ? <WalletChip address={e.funder} /> : <p className="text-sm text-muted">No plain SOL funder found.</p>),
  },
  {
    title: "Deployer",
    hint: "The wallet that created the token.",
    body: (e) => <WalletChip address={e.deployer} />,
  },
  {
    title: "Linked wallets",
    hint: "Funders and insiders that show up in other traced launches.",
    body: (e) =>
      e.linked.length > 0 ? (
        <div className="space-y-2">
          {e.linked.map((w) => (
            <WalletChip key={w} address={w} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">None seen in other traces yet.</p>
      ),
  },
  {
    title: "Launches",
    hint: "The dev's earlier tokens and how they ended.",
    body: (e) =>
      e.launches.length > 0 ? (
        <ul className="space-y-2">
          {e.launches.map((l) => (
            <li key={l.mint}>
              <Link
                to="/token/$mint"
                params={{ mint: l.mint }}
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm hover:border-accent"
              >
                <span className="truncate">{l.symbol ? `$${l.symbol}` : shortAddress(l.mint)}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                  <span className={`h-2 w-2 rounded-full ${statusDot[l.status].color}`} />
                  {statusDot[l.status].label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No earlier launches found.</p>
      ),
  },
];

export function HowItWorks() {
  const example = useExample()?.steps ?? null;
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="how-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            How a trace works
          </h2>
          <p className="mt-2 max-w-2xl text-muted">Four hops from the money to the launches, on public on-chain data.</p>
        </div>
        {example && (
          <p className="text-sm text-muted">
            Real example:{" "}
            <Link to="/token/$mint" params={{ mint: example.mint }} className="text-accent hover:underline">
              {example.symbol ? `$${example.symbol}` : shortAddress(example.mint)}
            </Link>
            , scored {example.score}/100
          </p>
        )}
      </div>
      <div className="mt-6 hidden overflow-hidden rounded-3xl border border-line md:block">
        <LoopVideo name="flow" width={1920} height={520} className="block h-auto w-full" />
      </div>
      <ol className="mt-4 grid gap-4 md:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative rounded-2xl border border-line bg-surface/80 p-4">
            {i < STEPS.length - 1 && (
              <span aria-hidden className="absolute -right-4 top-8 hidden h-px w-4 bg-gradient-to-r from-accent to-transparent md:block" />
            )}
            <h3 className="font-semibold">
              <span className="mr-2 text-accent">{i + 1}.</span>
              {step.title}
            </h3>
            <p className="mt-1 text-sm text-muted md:hidden">{step.hint}</p>
            {example && <div className="mt-4">{step.body(example)}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
