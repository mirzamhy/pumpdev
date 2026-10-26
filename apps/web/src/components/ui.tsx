import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { shortAddress } from "@pumpfun/shared";
import type { Tone } from "../lib/risk";

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const badgeTones: Record<Tone, string> = {
  neutral: "border-line text-muted",
  safe: "border-safe/40 text-safe",
  warn: "border-warn/40 text-warn",
  danger: "border-danger/40 text-danger",
};

export function Badge({ tone = "neutral", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="rounded px-1.5 py-0.5 text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function Address({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Link to="/wallet/$address" params={{ address: value }} className="font-mono text-sm hover:text-accent">
        {shortAddress(value)}
      </Link>
      <CopyButton value={value} />
    </span>
  );
}

/** Deterministic two-tone avatar from an address, so every token gets a recognisable mark without loading its image. */
export function TokenAvatar({ seed, label, size = 32 }: { seed: string; label: string | null; size?: number }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40 + ((h >> 9) % 80)) % 360;
  const letter = (label ?? seed).replace(/[^a-z0-9]/gi, "").charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white/90 ring-1 ring-white/10"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${hue2} 75% 30%))`,
      }}
    >
      {letter}
    </span>
  );
}
