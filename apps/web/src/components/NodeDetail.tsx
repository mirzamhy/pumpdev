import { Link } from "@tanstack/react-router";
import { formatSol, type ChainNode } from "@pumpfun/shared";
import { roleLabel } from "../lib/format";
import { terminalLabel } from "../lib/risk";
import { Card, CopyButton } from "./ui";

export function NodeDetail({ node, onClose }: { node: ChainNode | null; onClose: () => void }) {
  if (!node) return null;
  return (
    <Card
      title="Selected wallet"
      action={
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-text">
          Close
        </button>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Address</dt>
        <dd className="break-all font-mono text-xs">
          {node.address} <CopyButton value={node.address} />
        </dd>
        <dt className="text-muted">Role</dt>
        <dd>{roleLabel(node)}</dd>
        {node.fundedBy && (
          <>
            <dt className="text-muted">First SOL from</dt>
            <dd className="break-all font-mono text-xs">{node.fundedBy}</dd>
          </>
        )}
        {node.fundingAmountLamports && (
          <>
            <dt className="text-muted">Amount</dt>
            <dd>{formatSol(node.fundingAmountLamports)}</dd>
          </>
        )}
        {node.fundedAt && (
          <>
            <dt className="text-muted">When</dt>
            <dd>{new Date(node.fundedAt * 1000).toLocaleString()}</dd>
          </>
        )}
        {node.terminal && (
          <>
            <dt className="text-muted">Trace stopped</dt>
            <dd className="text-warn">{terminalLabel[node.terminal]}</dd>
          </>
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link to="/wallet/$address" params={{ address: node.address }} className="text-accent hover:underline">
          Wallet page
        </Link>
        <a href={`https://solscan.io/account/${node.address}`} target="_blank" rel="noreferrer" className="text-muted hover:text-text">
          Solscan ↗
        </a>
        {node.fundingSignature && (
          <a href={`https://solscan.io/tx/${node.fundingSignature}`} target="_blank" rel="noreferrer" className="text-muted hover:text-text">
            Funding tx ↗
          </a>
        )}
      </div>
    </Card>
  );
}
