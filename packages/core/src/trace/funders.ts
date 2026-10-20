import type { ChainNode } from "@pumpfun/shared";
import { isAbortError } from "../abort";
import type { ChainSource } from "../chain";
import type { TraceConfig } from "../config";
import { collectSignatures } from "../signatures";
import type { Store, WalletRecord } from "../store";
import { findSolFunding } from "../tx";

const HIGH_ACTIVITY_RECHECK_SEC = 30 * 86_400;
/** A creator wallet can exist before it ever receives SOL, so "no funding found" may change. */
const UNKNOWN_ORIGIN_RECHECK_SEC = 86_400;

/** Finds who sent this wallet its first SOL. Results are cached in the store. */
export async function resolveWallet(
  address: string,
  chain: ChainSource,
  store: Store,
  cfg: TraceConfig,
  now: number,
): Promise<WalletRecord> {
  const cached = store.getWallet(address);
  if (cached) {
    const age = now - cached.fetchedAt;
    const stale =
      (cached.terminal === "high_activity" && age > HIGH_ACTIVITY_RECHECK_SEC) ||
      (cached.terminal === "unknown_origin" && age > UNKNOWN_ORIGIN_RECHECK_SEC);
    if (!stale) return cached;
  }

  const base: WalletRecord = {
    address,
    funderResolved: false,
    funder: null,
    fundingSignature: null,
    fundingAmountLamports: null,
    fundedAt: null,
    terminal: null,
    fetchedAt: now,
  };

  const { sigs, complete } = await collectSignatures(chain, address, cfg.walletMaxPages, cfg.pageSize);
  let record: WalletRecord;
  if (!complete) {
    record = { ...base, terminal: "high_activity" };
  } else {
    const oldestFirst = sigs.slice(-cfg.oldestTxScan).reverse().filter((s) => !s.err);
    record = { ...base, terminal: "unknown_origin" };
    for (const sig of oldestFirst) {
      const tx = await chain.getTransaction(sig.signature);
      if (!tx) continue;
      const funding = findSolFunding(tx, address);
      if (!funding) continue;
      record = {
        ...base,
        funderResolved: true,
        funder: funding.from,
        fundingSignature: funding.signature,
        fundingAmountLamports: funding.lamports.toString(),
        fundedAt: funding.blockTime,
      };
      break;
    }
  }
  store.putWallet(record);
  return record;
}

export async function traceChain(
  start: string,
  role: "deployer" | "creator",
  chain: ChainSource,
  store: Store,
  cfg: TraceConfig,
  now: number,
  onNode: (node: ChainNode) => void,
  signal?: AbortSignal,
): Promise<ChainNode[]> {
  const nodes: ChainNode[] = [];
  const seen = new Set<string>();
  let current = start;
  let depth = 0;

  for (;;) {
    signal?.throwIfAborted();
    seen.add(current);

    let record: WalletRecord | null = null;
    try {
      record = await resolveWallet(current, chain, store, cfg, now);
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
    }

    const node: ChainNode = {
      address: current,
      depth,
      role: depth === 0 ? role : "funder",
      chainRoot: start,
      fundedBy: record?.funder ?? null,
      fundingAmountLamports: record?.fundingAmountLamports ?? null,
      fundedAt: record?.fundedAt ?? null,
      fundingSignature: record?.fundingSignature ?? null,
      terminal: record ? record.terminal : "incomplete",
    };
    if (record?.funder && !node.terminal) {
      if (depth >= cfg.maxHops) node.terminal = "max_depth";
      else if (seen.has(record.funder)) node.terminal = "loop";
    }

    nodes.push(node);
    onNode(node);
    if (node.terminal || !record?.funder) return nodes;
    current = record.funder;
    depth++;
  }
}
