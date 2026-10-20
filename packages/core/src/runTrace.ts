import type { ChainNode, Crosslink, HolderAnalysis, StepName, TraceEvent, TraceResult } from "@pumpfun/shared";
import { withTxCache } from "./cachedChain";
import type { ChainSource } from "./chain";
import { DEFAULT_CONFIG, type TraceConfig } from "./config";
import { computeScore } from "./score";
import type { Store, TaintedFunder } from "./store";
import { analyzeDev, type DevActivity } from "./trace/devActivity";
import { traceChain } from "./trace/funders";
import { analyzeHolders } from "./trace/holders";
import { resolveToken } from "./trace/resolveToken";

export interface TraceDeps {
  chain: ChainSource;
  store: Store;
  emit: (event: TraceEvent) => void;
  now?: () => number;
  signal?: AbortSignal;
  config?: Partial<TraceConfig>;
}

export async function runTrace(mint: string, deps: TraceDeps): Promise<TraceResult> {
  const cfg: TraceConfig = { ...DEFAULT_CONFIG, ...deps.config };
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const { emit, store, signal } = deps;
  const chain = withTxCache(deps.chain, store);
  let partial = false;

  const mark = (step: StepName, state: "running" | "done" | "incomplete") => emit({ type: "step", data: { step, state } });

  async function step<T>(name: StepName, fallback: T, fn: () => Promise<T> | T): Promise<T> {
    if (signal?.aborted) {
      partial = true;
      mark(name, "incomplete");
      return fallback;
    }
    mark(name, "running");
    try {
      const value = await fn();
      mark(name, "done");
      return value;
    } catch {
      partial = true;
      mark(name, "incomplete");
      return fallback;
    }
  }

  mark("token", "running");
  const { info: token } = await resolveToken(mint, chain, cfg, store.findCreateSignature(mint));
  emit({ type: "token", data: token });
  mark("token", "done");

  const nodes: ChainNode[] = [];
  const onNode = (node: ChainNode) => {
    nodes.push(node);
    emit({ type: "node", data: node });
  };
  await step("funders", undefined, async () => {
    await traceChain(token.deployer, "deployer", chain, store, cfg, now(), onNode, signal);
    if (token.creatorCurrent && token.creatorCurrent !== token.deployer) {
      await traceChain(token.creatorCurrent, "creator", chain, store, cfg, now(), onNode, signal);
    }
  });

  const dev = await step<DevActivity | null>("devActivity", null, () => analyzeDev(token, chain, cfg, now()));
  const devHistory = dev?.history ?? [];
  const devHistoryPartial = dev ? dev.historyPartial : true;
  const devStatus = dev?.status ?? null;
  emit({ type: "devHistory", data: { tokens: devHistory, partial: devHistoryPartial } });
  if (devStatus) emit({ type: "devStatus", data: devStatus });

  const holders = await step<HolderAnalysis | null>("holders", null, () => analyzeHolders({ token, nodes, devStatus }, chain, store, cfg, now()));
  if (holders) emit({ type: "holders", data: holders });

  // Exchange-like wallets link everything to everything, so they never count as links.
  const linkable = nodes.filter((n) => n.terminal !== "high_activity").map((n) => n.address);
  const insiders = devStatus?.transfers.map((t) => t.to) ?? [];
  const crosslinks = await step<Crosslink[]>("crosslinks", [], () =>
    store.findCrosslinks([...new Set([...linkable, ...insiders])], mint),
  );
  emit({ type: "crosslinks", data: crosslinks });

  mark("score", "running");
  const funders = nodes.filter((n) => n.role === "funder" && n.terminal !== "high_activity").map((n) => n.address);
  let taintedFunders: TaintedFunder[] = [];
  try {
    taintedFunders = funders.length ? store.findTaintedFunders(funders, mint) : [];
  } catch {
    partial = true;
  }
  const score = computeScore({
    token,
    nodes,
    devHistory,
    devStatus,
    taintedFunders,
    holders,
    incomplete:
      partial || !token.createTxFound || (devStatus?.partial ?? true) || nodes.some((n) => n.terminal === "incomplete"),
  });
  emit({ type: "score", data: score });
  mark("score", "done");

  const result: TraceResult = {
    token,
    nodes,
    devHistory,
    devHistoryPartial,
    devStatus,
    holders,
    crosslinks,
    score,
    partial,
    finishedAt: now(),
  };
  emit({ type: "done", data: { partial } });
  return result;
}
