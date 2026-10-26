import type { QuickScore, RiskFactor, RiskLevel, RiskScore } from "@pumpfun/shared";
import { levelTone, toneText } from "../lib/risk";
import { Card, Skeleton } from "./ui";

function FactorList({ factors }: { factors: RiskFactor[] }) {
  return (
    <ul className="mt-4 space-y-2">
      {factors.map((f) => (
        <li key={f.id} className="flex gap-3 text-sm">
          <span className="mt-0.5 h-fit shrink-0 rounded bg-danger/15 px-1.5 text-xs font-semibold tabular-nums text-danger">+{f.points}</span>
          <span>{f.reason}</span>
        </li>
      ))}
    </ul>
  );
}

export function RiskCard({ score, done, quick = null }: { score: RiskScore | null; done: boolean; quick?: QuickScore | null }) {
  if (!score && quick && !done) {
    const tone = quick.level === "low" ? "text-muted" : toneText[levelTone[quick.level]];
    return (
      <Card title="Risk · quick check">
        <div className="flex items-end gap-3">
          <span className={`text-5xl font-semibold tabular-nums ${tone}`}>~{quick.score}</span>
          <span className="pb-2 text-sm text-muted">/ 100 · from the dev, socials and curve</span>
        </div>
        {quick.factors.length > 0 ? (
          <FactorList factors={quick.factors} />
        ) : (
          <p className="mt-4 text-sm text-muted">No known red flag yet.</p>
        )}
        <p className="mt-3 text-xs text-muted">Holders and bundles are not checked yet. The full score replaces this once the trace finishes.</p>
      </Card>
    );
  }
  if (!score) {
    return (
      <Card title="Risk">
        <Skeleton className="h-14 w-28" />
        <p className="mt-3 text-sm text-muted">{done ? "Score unavailable." : "Scoring once the trace finishes…"}</p>
      </Card>
    );
  }
  return (
    <Card title="Risk">
      <div className="flex items-end gap-3">
        <span className={`text-5xl font-semibold tabular-nums ${toneText[levelTone[score.level]]}`}>{score.score}</span>
        <span className="pb-2 text-sm text-muted">/ 100 · {score.level} risk</span>
      </div>
      {score.incomplete && <p className="mt-2 text-xs text-warn">Some data could not be fetched, so the score may be understated.</p>}
      {score.factors.length > 0 ? (
        <FactorList factors={score.factors} />
      ) : (
        <p className="mt-4 text-sm text-muted">None of our checks found a red flag. That is not a guarantee.</p>
      )}
    </Card>
  );
}

const chipTone = {
  safe: "border-safe/40 bg-safe/10 text-safe",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/50 bg-danger/15 text-danger",
} as const;

export function ScorePill({ score, level }: { score: number; level: RiskLevel }) {
  const tone = levelTone[level];
  return (
    <span className={`inline-flex min-w-9 justify-center rounded-md border px-1.5 py-0.5 font-mono text-sm font-semibold tabular-nums ${chipTone[tone]}`} aria-label={`Risk score ${score}, ${level}`}>
      {score}
    </span>
  );
}
