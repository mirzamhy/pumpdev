import type { FeedResponse, FeedTab, RecentTrace, TraceEvent, TraceResult, WalletView } from "@pumpfun/shared";

export type StartTraceResponse = { cached: true; result: TraceResult } | { jobId: string };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function startTrace(mint: string): Promise<StartTraceResponse> {
  return json(
    await fetch("/api/trace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mint }),
    }),
  );
}

/** Opens the SSE stream. Returns a function that closes it. */
export function streamTrace(jobId: string, onEvent: (event: TraceEvent) => void): () => void {
  const source = new EventSource(`/api/trace/${encodeURIComponent(jobId)}/stream`);
  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as TraceEvent;
    onEvent(event);
    if (event.type === "done" || event.type === "error") source.close();
  };
  return () => source.close();
}

export async function fetchRecent(): Promise<RecentTrace[]> {
  return json(await fetch("/api/recent"));
}

export async function fetchWallet(address: string): Promise<WalletView> {
  return json(await fetch(`/api/wallet/${encodeURIComponent(address)}`));
}

export async function fetchFeed(tab: FeedTab, hideHigh: boolean): Promise<FeedResponse> {
  return json(await fetch(`/api/feed?tab=${tab}&hideHigh=${hideHigh ? 1 : 0}&limit=100`));
}
