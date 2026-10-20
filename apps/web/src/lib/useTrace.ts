import { useEffect, useReducer, useState } from "react";
import { startTrace, streamTrace } from "./api";
import { emptyView, traceReducer, type TraceView } from "./traceState";

export function useTrace(mint: string): { view: TraceView; retry: () => void } {
  const [view, dispatch] = useReducer(traceReducer, emptyView);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    dispatch({ kind: "reset" });
    startTrace(mint)
      .then((res) => {
        if (cancelled) return;
        if ("cached" in res) dispatch({ kind: "result", result: res.result });
        else stop = streamTrace(res.jobId, (event) => dispatch({ kind: "event", event }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Request failed";
        dispatch({ kind: "event", event: { type: "error", data: { message } } });
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [mint, attempt]);

  return { view, retry: () => setAttempt((a) => a + 1) };
}
