import { parseMetadata, type MetadataSource } from "@pumpfun/core";
import type { SqliteStore } from "@pumpfun/db";

export interface MetadataItem {
  mint: string;
  uri: string;
  createdAt: number;
}

interface Pending extends MetadataItem {
  attempt: number;
  notBefore: number;
}

export interface MetadataQueueDeps {
  fetcher: MetadataSource;
  store: Pick<SqliteStore, "getTokenMeta" | "putTokenMeta">;
  /** Unix seconds. */
  now?: () => number;
  concurrency?: number;
  /** Oldest items are dropped beyond this; new launches matter more than a backlog. */
  maxSize?: number;
  retryAfterSec?: number;
  log?: (message: string, err?: unknown) => void;
}

/** Fetches metadata for new tokens in the background so reuse checks have something to compare against. */
export class MetadataQueue {
  private pending: Pending[] = [];
  private active = 0;
  private waiters: (() => void)[] = [];
  private readonly now: () => number;
  private readonly concurrency: number;
  private readonly maxSize: number;
  private readonly retryAfterSec: number;

  constructor(private readonly deps: MetadataQueueDeps) {
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    this.concurrency = deps.concurrency ?? 4;
    this.maxSize = deps.maxSize ?? 500;
    this.retryAfterSec = deps.retryAfterSec ?? 600;
  }

  enqueue(item: MetadataItem): void {
    if (this.deps.store.getTokenMeta(item.mint)?.ok) return;
    this.pending.push({ ...item, attempt: 0, notBefore: 0 });
    if (this.pending.length > this.maxSize) this.pending.splice(0, this.pending.length - this.maxSize);
    this.tick();
  }

  /** Starts ready work; call periodically so delayed retries run. */
  tick(): void {
    const now = this.now();
    while (this.active < this.concurrency) {
      const i = this.pending.findIndex((p) => p.notBefore <= now);
      if (i < 0) break;
      const [item] = this.pending.splice(i, 1);
      this.active++;
      void this.process(item!).finally(() => {
        this.active--;
        this.tick();
        this.notifyIdle();
      });
    }
    this.notifyIdle();
  }

  /** Resolves when nothing is running and nothing is ready to run (delayed retries do not count). */
  idle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private isIdle(): boolean {
    const now = this.now();
    return this.active === 0 && !this.pending.some((p) => p.notBefore <= now);
  }

  private notifyIdle(): void {
    if (!this.isIdle()) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private async process(item: Pending): Promise<void> {
    try {
      const json = await this.deps.fetcher.fetch(item.uri);
      if (json === null && item.attempt === 0) {
        this.pending.push({ ...item, attempt: 1, notBefore: this.now() + this.retryAfterSec });
        return;
      }
      this.deps.store.putTokenMeta({ mint: item.mint, createdAt: item.createdAt, fetchedAt: this.now(), ok: json !== null, ...parseMetadata(json) });
    } catch (err) {
      this.deps.log?.(`metadata: could not store ${item.mint}`, err);
    }
  }
}
