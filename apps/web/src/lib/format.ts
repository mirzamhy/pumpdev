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
