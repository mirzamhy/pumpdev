import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion } from "motion/react";
import { formatSol, shortAddress, type ChainNode } from "@pumpfun/shared";
import { relTime, roleLabel } from "../lib/format";
import { terminalShort } from "../lib/risk";

type WalletNodeData = { node: ChainNode; selected: boolean };
type WalletFlowNode = Node<WalletNodeData, "wallet">;

function WalletNode({ data }: NodeProps<WalletFlowNode>) {
  const n = data.node;
  const border = data.selected ? "border-accent" : n.terminal && n.terminal !== "max_depth" ? "border-warn/50" : "border-line";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`w-56 rounded-lg border bg-surface px-3 py-2 text-left ${border}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted">
        <span>{roleLabel(n)}</span>
        {n.fundedAt && <span>{relTime(n.fundedAt)}</span>}
      </div>
      <div className="font-mono text-sm text-text">{shortAddress(n.address)}</div>
      {n.fundingAmountLamports && <div className="text-xs text-muted">received {formatSol(n.fundingAmountLamports)}</div>}
      {n.terminal && <div className="mt-1 text-xs text-warn">{terminalShort[n.terminal]}</div>}
      <Handle type="source" position={Position.Bottom} />
    </motion.div>
  );
}

const nodeTypes = { wallet: WalletNode };
const id = (n: ChainNode) => `${n.chainRoot}:${n.address}`;

export function FunderGraph({ nodes, selected, onSelect }: { nodes: ChainNode[]; selected: string | null; onSelect: (address: string) => void }) {
  const roots = [...new Set(nodes.map((n) => n.chainRoot))];
  // Funders sit above the wallet they funded; arrows point down, in the direction SOL moved.
  const flowNodes: WalletFlowNode[] = nodes.map((n) => ({
    id: id(n),
    type: "wallet",
    position: { x: roots.indexOf(n.chainRoot) * 280, y: -n.depth * 130 },
    data: { node: n, selected: selected === n.address },
    draggable: false,
  }));
  const edges: Edge[] = nodes
    .filter((n) => n.fundedBy && nodes.some((m) => m.chainRoot === n.chainRoot && m.address === n.fundedBy))
    .map((n) => ({
      id: `${n.chainRoot}:${n.fundedBy}->${n.address}`,
      source: `${n.chainRoot}:${n.fundedBy}`,
      target: id(n),
      animated: true,
      style: { stroke: "var(--color-accent)" },
    }));

  return (
    <div className="h-[520px]" aria-label="Funding chain graph">
      <ReactFlow
        key={flowNodes.length}
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        colorMode="dark"
        nodesConnectable={false}
        onNodeClick={(_, node) => onSelect(node.data.node.address)}
      >
        <Background color="#1f2a24" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
