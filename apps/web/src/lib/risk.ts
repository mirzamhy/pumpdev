import type { RiskLevel, TerminalReason } from "@pumpfun/shared";

export type Tone = "safe" | "warn" | "danger" | "neutral";

export const levelTone: Record<RiskLevel, Exclude<Tone, "neutral">> = { low: "safe", medium: "warn", high: "danger" };

export const toneText: Record<Tone, string> = {
  safe: "text-safe",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-muted",
};

export const terminalLabel: Record<TerminalReason, string> = {
  high_activity: "High-activity wallet (likely an exchange or service). Trace stops here.",
  unknown_origin: "Not funded by a plain SOL transfer (swap, bridge, or too old). Trace stops here.",
  max_depth: "Trace depth limit reached.",
  loop: "Funding loops back to a wallet already in this chain.",
  incomplete: "Could not be fetched (RPC error).",
};

export const terminalShort: Record<TerminalReason, string> = {
  high_activity: "Likely exchange",
  unknown_origin: "Origin unknown",
  max_depth: "Depth limit",
  loop: "Loop",
  incomplete: "Fetch failed",
};
