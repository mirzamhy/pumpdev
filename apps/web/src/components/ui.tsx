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
