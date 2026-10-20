import type { RiskLevel, RiskScore } from "@pumpfun/shared";
import { levelTone, toneText } from "../lib/risk";
import { Card, Skeleton } from "./ui";

export function RiskCard({ score, done }: { score: RiskScore | null; done: boolean }) {
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
        <ul className="mt-4 space-y-2">
          {score.factors.map((f) => (
            <li key={f.id} className="flex gap-3 text-sm">
              <span className="mt-0.5 h-fit shrink-0 rounded bg-danger/15 px-1.5 text-xs font-semibold tabular-nums text-danger">+{f.points}</span>
              <span>{f.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">None of our checks found a red flag. That is not a guarantee.</p>
      )}
    </Card>
  );
}

export function ScorePill({ score, level }: { score: number; level: RiskLevel }) {
  return <span className={`font-mono text-sm tabular-nums ${toneText[levelTone[level]]}`}>{score}</span>;
}
