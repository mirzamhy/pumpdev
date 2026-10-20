import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { SqliteStore } from "@pumpfun/db";
import { FeedQuery, TraceRequest, type FeedItem, type FeedResponse, type TraceEvent } from "@pumpfun/shared";
import type { ApiConfig } from "./config";
import type { JobManager } from "./jobs";

export interface AppDeps {
  store: SqliteStore;
  jobs: JobManager;
  config: Pick<ApiConfig, "traceRateLimitPerMin" | "freshResultSec">;
  logger?: boolean;
  now?: () => number;
  /** Whether the live feed websocket is connected; absent when the feed is disabled. */
  feedStatus?: () => boolean;
}

const PING_MS = 15_000;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { store, jobs, config } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });
  await app.register(rateLimit, { global: false });

  app.post(
    "/api/trace",
    { config: { rateLimit: { max: config.traceRateLimitPerMin, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = TraceRequest.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid token address" });
      const { mint } = parsed.data;
      const cached = store.getResult(mint);
      if (cached && now() - cached.finishedAt < config.freshResultSec) return { cached: true, result: cached.result };
      return { jobId: jobs.start(mint) };
    },
  );

  app.get<{ Params: { jobId: string } }>("/api/trace/:jobId/stream", (req, reply) => {
    const job = store.getJob(req.params.jobId);
    if (!job) {
      reply.code(404).send({ error: "Job not found" });
      return;
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    let lastSeq = -1;
    let closed = false;
    let replaying = true;
    const buffered: [number, TraceEvent][] = [];

    // Subscribe before replaying so nothing emitted in between is lost; `lastSeq` drops duplicates.
    const unsubscribe = jobs.subscribe(job.id, (seq, event) => {
      if (replaying) buffered.push([seq, event]);
      else send(seq, event);
    });
    const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);

    function finish(): void {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsubscribe?.();
      res.end();
    }

    function send(seq: number, event: TraceEvent): void {
      if (closed || seq <= lastSeq) return;
      lastSeq = seq;
      res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
      if (event.type === "done" || event.type === "error") finish();
    }

    for (const { seq, event } of store.listEvents(job.id)) send(seq, event);
    replaying = false;
    for (const [seq, event] of buffered) send(seq, event);
    // Not running and never finished: the server restarted mid-trace. Tell the client instead of hanging.
    if (!unsubscribe) send(lastSeq + 1, { type: "error", data: { message: "This trace was interrupted. Please try again." } });
    req.raw.on("close", finish);
  });

  app.get<{ Params: { mint: string } }>("/api/token/:mint", async (req, reply) => {
    const found = store.getResult(req.params.mint);
    if (!found) return reply.code(404).send({ error: "Not traced yet" });
    return found.result;
  });

  app.get<{ Params: { address: string } }>("/api/wallet/:address", async (req) => store.walletView(req.params.address));

  app.get("/api/recent", async () => store.recent(20));

  // Polled every few seconds by every open screener; keep it out of the request log.
  app.get("/api/feed", { logLevel: "warn" }, async (req, reply): Promise<FeedResponse | void> => {
    const parsed = FeedQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid feed query" });
    const t = now();
    const items: FeedItem[] = store.feed({ ...parsed.data, now: t }).map(({ score, level, tracedAt: _tracedAt, ...row }) => ({
      ...row,
      trace: { state: jobs.stateOf(row.mint) ?? (score !== null ? "done" : "none"), score, level },
    }));
    return { items, stats: { ...store.feedStats(t), connected: deps.feedStatus?.() ?? false } };
  });

  return app;
}
