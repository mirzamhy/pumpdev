import { randomUUID } from "node:crypto";
import { NotPumpTokenError, runTrace, type ChainSource, type TraceConfig } from "@pumpfun/core";
import type { SqliteStore } from "@pumpfun/db";
import type { TraceEvent } from "@pumpfun/shared";

export type JobListener = (seq: number, event: TraceEvent) => void;

interface Job {
  id: string;
  mint: string;
  seq: number;
  listeners: Set<JobListener>;
}

export interface JobManagerDeps {
  store: SqliteStore;
  chain: ChainSource;
  concurrency: number;
  timeoutMs: number;
  now?: () => number;
  traceConfig?: Partial<TraceConfig>;
  log?: (message: string, err?: unknown) => void;
}

/** In-process queue. One job per mint at a time; events are persisted so streams can replay. */
export class JobManager {
  private readonly byMint = new Map<string, Job>();
  private readonly byId = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private running = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly deps: JobManagerDeps) {}

  start(mint: string): string {
    const existing = this.byMint.get(mint);
    if (existing) return existing.id;
    const job: Job = { id: randomUUID(), mint, seq: 0, listeners: new Set() };
    this.byMint.set(mint, job);
    this.byId.set(job.id, job);
    this.deps.store.createJob(job.id, mint, Date.now());
    this.queue.push(job);
    this.pump();
    return job.id;
  }

  /** Returns null when the job is not running (finished or unknown); replay from the store instead. */
  subscribe(jobId: string, listener: JobListener): (() => void) | null {
    const job = this.byId.get(jobId);
    if (!job) return null;
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  whenIdle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running < this.deps.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.pump();
        if (this.running === 0 && this.queue.length === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          for (const resolve of waiters) resolve();
        }
      });
    }
  }

  private emit(job: Job, event: TraceEvent): void {
    const seq = job.seq++;
    this.deps.store.appendEvent(job.id, seq, event);
    for (const listener of job.listeners) listener(seq, event);
  }

  private async run(job: Job): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs);
    try {
      const result = await runTrace(job.mint, {
        chain: this.deps.chain,
        store: this.deps.store,
        emit: (e) => this.emit(job, e),
        signal: controller.signal,
        now: this.deps.now,
        config: this.deps.traceConfig,
        onStepError: (step, err) => this.deps.log?.(`step ${step} failed for ${job.mint}`, err),
      });
      this.deps.store.saveResult(result);
      this.deps.store.finishJob(job.id, "done", result.partial, Date.now());
    } catch (err) {
      const known = err instanceof NotPumpTokenError;
      if (!known) this.deps.log?.(`trace failed for ${job.mint}`, err);
      this.emit(job, { type: "error", data: { message: known ? err.message : "Trace failed. Please try again." } });
      this.deps.store.finishJob(job.id, "error", true, Date.now());
    } finally {
      clearTimeout(timer);
      this.byMint.delete(job.mint);
      this.byId.delete(job.id);
      job.listeners.clear();
    }
  }
}
