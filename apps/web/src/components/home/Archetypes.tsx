import { LoopVideo } from "../LoopVideo";

type ToneName = "accent" | "warn" | "danger";

interface Archetype {
  name: string;
  tone: ToneName;
  summary: string;
  signals: string[];
  /** Loop rendered from media/patterns, cropped per card. */
  video: string;
}

const ARCHETYPES: Archetype[] = [
  {
    name: "Runner",
    tone: "accent",
    summary: "Builds and keeps going. Longer activity, cleaner history.",
    signals: ["Earlier launches that migrated", "Dev still holds instead of selling", "Funded from an older, quiet wallet"],
    video: "pattern-runner",
  },
  {
    name: "Recycler",
    tone: "warn",
    summary: "Reuses money, wallets and branding across short-lived launches.",
    signals: ["Socials or images from older tokens", "Same funder behind several devs", "Several launches a day"],
    video: "pattern-recycler",
  },
  {
    name: "Rugger",
    tone: "danger",
    summary: "Launches fast, exits faster.",
    signals: ["Dev sells within minutes of launch", "Earlier tokens died with the dev exiting", "Launch-block wallets hold the supply"],
    video: "pattern-rugger",
  },
];

const toneVar: Record<ToneName, string> = { accent: "var(--color-accent)", warn: "var(--color-warn)", danger: "var(--color-danger)" };
const toneText: Record<ToneName, string> = { accent: "text-accent", warn: "text-warn", danger: "text-danger" };

export function Archetypes() {
  return (
    <section aria-labelledby="archetypes-title" className="rounded-3xl border border-line bg-surface/60 p-5 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="archetypes-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Runner, recycler or rugger?
          </h2>
          <p className="mt-2 max-w-xl text-muted">Different behaviour leaves different on-chain traces. A trace shows you which signals are present.</p>
        </div>
        <p className="text-sm text-muted">Patterns are signals, not verdicts.</p>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {ARCHETYPES.map((a) => (
          <article key={a.name} className="rounded-2xl border border-line bg-bg/60 p-5">
            <h3 className={`text-lg font-semibold ${toneText[a.tone]}`}>{a.name}</h3>
            <p className="mt-1 text-sm text-muted">{a.summary}</p>
            <LoopVideo name={a.video} width={800} height={360} className="mt-4 block h-auto w-full rounded-xl" />
            <ul className="mt-4 space-y-2 text-sm">
              {a.signals.map((s) => (
                <li key={s} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: toneVar[a.tone] }} />
                  {s}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
