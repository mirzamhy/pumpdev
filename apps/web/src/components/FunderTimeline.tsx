import { formatSol, shortAddress, type ChainNode } from "@pumpfun/shared";
import { relTime, roleLabel } from "../lib/format";
import { terminalLabel } from "../lib/risk";

export function FunderTimeline({ nodes, selected, onSelect }: { nodes: ChainNode[]; selected: string | null; onSelect: (address: string) => void }) {
  const roots = [...new Set(nodes.map((n) => n.chainRoot))];
  return (
    <div className="space-y-6">
      {roots.map((root) => (
        <ol key={root} className="space-y-3 border-l border-line pl-4">
          {nodes
            .filter((n) => n.chainRoot === root)
            .sort((a, b) => a.depth - b.depth)
            .map((n) => (
              <li key={n.address}>
                <button
                  type="button"
                  onClick={() => onSelect(n.address)}
                  className={`w-full rounded-lg border bg-surface px-3 py-2 text-left hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${selected === n.address ? "border-accent" : "border-line"}`}
                >
                  <div className="text-[11px] uppercase tracking-wide text-muted">{roleLabel(n)}</div>
                  <div className="font-mono text-sm">{shortAddress(n.address)}</div>
                  {n.fundingAmountLamports && (
                    <div className="text-xs text-muted">
                      received {formatSol(n.fundingAmountLamports)} from the wallet below{n.fundedAt ? ` · ${relTime(n.fundedAt)}` : ""}
                    </div>
                  )}
                  {n.terminal && <div className="mt-1 text-xs text-warn">{terminalLabel[n.terminal]}</div>}
                </button>
              </li>
            ))}
        </ol>
      ))}
    </div>
  );
}
