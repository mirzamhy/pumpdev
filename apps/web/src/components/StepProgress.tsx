import type { StepName, StepState } from "@pumpfun/shared";

const STEPS: { id: StepName; label: string }[] = [
  { id: "token", label: "Token" },
  { id: "funders", label: "Funding chain" },
  { id: "devActivity", label: "Dev activity" },
  { id: "holders", label: "Holders" },
  { id: "crosslinks", label: "Cross-links" },
  { id: "score", label: "Score" },
];

const stateClass: Record<StepState | "pending", string> = {
  pending: "border-line text-muted",
  running: "animate-pulse border-accent text-accent",
  done: "border-safe/40 text-safe",
  incomplete: "border-warn/40 text-warn",
};

export function StepProgress({ steps, done }: { steps: Partial<Record<StepName, StepState>>; done: boolean }) {
  if (done) return null;
  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label="Trace progress">
      {STEPS.map((s) => (
        <li key={s.id} className={`rounded-full border px-2.5 py-1 ${stateClass[steps[s.id] ?? "pending"]}`}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}
