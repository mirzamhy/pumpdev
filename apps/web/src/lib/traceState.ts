import type {
  ChainNode,
  Crosslink,
  DevStatus,
  DevToken,
  RiskScore,
  StepName,
  StepState,
  TokenInfo,
  TraceEvent,
  TraceResult,
} from "@pumpfun/shared";

export interface TraceView {
  token: TokenInfo | null;
  nodes: ChainNode[];
  devHistory: DevToken[] | null;
  devHistoryPartial: boolean;
  devStatus: DevStatus | null;
  crosslinks: Crosslink[] | null;
  score: RiskScore | null;
  steps: Partial<Record<StepName, StepState>>;
  done: boolean;
  partial: boolean;
  error: string | null;
}

export const emptyView: TraceView = {
  token: null,
  nodes: [],
  devHistory: null,
  devHistoryPartial: false,
  devStatus: null,
  crosslinks: null,
  score: null,
  steps: {},
  done: false,
  partial: false,
  error: null,
};

export type TraceAction = { kind: "reset" } | { kind: "result"; result: TraceResult } | { kind: "event"; event: TraceEvent };

const nodeKey = (n: ChainNode) => `${n.chainRoot}:${n.address}`;

export function applyEvent(v: TraceView, e: TraceEvent): TraceView {
  switch (e.type) {
    case "step":
      return { ...v, steps: { ...v.steps, [e.data.step]: e.data.state } };
    case "token":
      return { ...v, token: e.data };
    case "node":
      if (v.nodes.some((n) => nodeKey(n) === nodeKey(e.data))) return v;
      return { ...v, nodes: [...v.nodes, e.data] };
    case "devHistory":
      return { ...v, devHistory: e.data.tokens, devHistoryPartial: e.data.partial };
    case "devStatus":
      return { ...v, devStatus: e.data };
    case "crosslinks":
      return { ...v, crosslinks: e.data };
    case "score":
      return { ...v, score: e.data };
    case "done":
      return { ...v, done: true, partial: e.data.partial };
    case "error":
      return { ...v, done: true, error: e.data.message };
  }
}

export function viewFromResult(r: TraceResult): TraceView {
  return {
    token: r.token,
    nodes: r.nodes,
    devHistory: r.devHistory,
    devHistoryPartial: r.devHistoryPartial,
    devStatus: r.devStatus,
    crosslinks: r.crosslinks,
    score: r.score,
    steps: { token: "done", funders: "done", devActivity: "done", crosslinks: "done", score: "done" },
    done: true,
    partial: r.partial,
    error: null,
  };
}

export function traceReducer(v: TraceView, a: TraceAction): TraceView {
  switch (a.kind) {
    case "reset":
      return emptyView;
    case "result":
      return viewFromResult(a.result);
    case "event":
      return applyEvent(v, a.event);
  }
}
