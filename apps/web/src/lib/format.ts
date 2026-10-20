import type { ChainNode } from "@pumpfun/shared";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

export function relTime(unixSec: number, nowSec = Date.now() / 1000): string {
  const diff = Math.round(unixSec - nowSec);
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), "day");
  if (abs < 86_400 * 365) return rtf.format(Math.round(diff / (86_400 * 30)), "month");
  return rtf.format(Math.round(diff / (86_400 * 365)), "year");
}

export function roleLabel(node: ChainNode): string {
  if (node.role === "deployer") return "Dev (deployer)";
  if (node.role === "creator") return "Current creator";
  return `Funder · hop ${node.depth}`;
}

/** Compact age for dense tables: 45s, 12m, 3h, 2d. */
export function shortAge(unixSec: number, nowSec = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(nowSec - unixSec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

export function formatMcap(sol: number | null): string {
  if (sol === null) return "–";
  return `${sol >= 100 ? Math.round(sol) : sol.toFixed(1)} SOL`;
}
