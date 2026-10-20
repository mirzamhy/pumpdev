import {
  INITIAL_REAL_TOKEN_RESERVES,
  PUMP_PROGRAM_ID,
  bondingCurvePda,
  curveMetrics,
  decodeBondingCurve,
  type ChainSource,
} from "@pumpfun/core";
import type { FeedCurveUpdate, SqliteStore } from "@pumpfun/db";
import type { JobManager } from "../jobs";
import type { PortalEvent } from "./pumpPortal";

export interface FeedConfig {
  pollSec: number;
  autoTraceMinProgress: number;
  autoTraceWindowSec: number;
  autoTracePerHour: number;
  retentionHours: number;
}

export interface FeedServiceDeps {
  store: SqliteStore;
  chain: ChainSource;
  jobs: Pick<JobManager, "start" | "autoBacklog">;
  config: FeedConfig;
  /** Unix seconds. */
  now?: () => number;
  log?: (message: string, err?: unknown) => void;
}

const ACCOUNTS_PER_CALL = 100;
const PRUNE_EVERY_SEC = 600;
/** Do not queue more background traces than this; candidates wait for the next tick instead of going stale in a queue. */
const MAX_AUTO_BACKLOG = 2;
/** `virtual - real` token reserves, constant for every pump curve (279.9M tokens, raw units). */
const VIRTUAL_TOKEN_OFFSET = 279_900_000_000_000;

/** Progress implied by the virtual token reserves PumpPortal reports (whole tokens). */
export function progressFromVirtualTokens(vTokens: number | null): number {
  if (vTokens === null) return 0;
  const realTokens = vTokens * 1e6 - VIRTUAL_TOKEN_OFFSET;
  const sold = 1 - realTokens / Number(INITIAL_REAL_TOKEN_RESERVES);
  return Math.min(100, Math.max(0, sold * 100));
}

/** Stores new tokens from PumpPortal, keeps their curve metrics fresh and queues traces for tokens gaining traction. */
export class FeedService {
  private readonly now: () => number;
  private budget: number;
  private budgetAt: number;
  private ticking = false;
  private lastPrune = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: FeedServiceDeps) {
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    this.budget = deps.config.autoTracePerHour;
    this.budgetAt = this.now();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.config.pollSec * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async handle(event: PortalEvent): Promise<void> {
    try {
      if (event.type === "migrate") {
        this.deps.store.markMigrated(event.data.mint, this.now());
        return;
      }
      const e = event.data;
      this.deps.store.insertFeedToken({
        mint: e.mint,
        name: e.name,
        symbol: e.symbol,
        uri: e.uri,
        creator: e.creator,
        bondingCurve: e.bondingCurve ?? (await bondingCurvePda(e.mint)),
        createSignature: e.signature,
        createdAt: this.now(),
        initialBuySol: e.initialBuySol,
        isMayhemMode: e.isMayhemMode,
        marketCapSol: e.marketCapSol,
        progressPct: progressFromVirtualTokens(e.vTokens),
        realSol: 0,
      });
    } catch (err) {
      this.deps.log?.(`feed: could not store ${event.type} ${event.data.mint}`, err);
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      await this.pollCurves(now);
      this.autoTrace(now);
      if (now - this.lastPrune >= PRUNE_EVERY_SEC) {
        this.lastPrune = now;
        this.deps.store.pruneFeed(now - this.deps.config.retentionHours * 3600);
      }
    } catch (err) {
      this.deps.log?.("feed: tick failed", err);
    } finally {
      this.ticking = false;
    }
  }

  private async pollCurves(now: number): Promise<void> {
    const rows = this.deps.store.feedTokensToPoll(now);
    for (let i = 0; i < rows.length; i += ACCOUNTS_PER_CALL) {
      const chunk = rows.slice(i, i + ACCOUNTS_PER_CALL);
      try {
        const accounts = await this.deps.chain.getAccounts(chunk.map((r) => r.bondingCurve));
        const updates: FeedCurveUpdate[] = [];
        accounts.forEach((account, j) => {
          if (!account || account.owner !== PUMP_PROGRAM_ID) return;
          updates.push({ mint: chunk[j]!.mint, ...curveMetrics(decodeBondingCurve(account.data)) });
        });
        this.deps.store.updateFeedCurves(updates, now);
      } catch (err) {
        this.deps.log?.("feed: curve poll failed", err);
      }
    }
  }

  private autoTrace(now: number): void {
    const { autoTracePerHour, autoTraceMinProgress, autoTraceWindowSec } = this.deps.config;
    this.budget = Math.min(autoTracePerHour, this.budget + ((now - this.budgetAt) * autoTracePerHour) / 3600);
    this.budgetAt = now;
    if (this.budget < 1) return;
    let backlog = this.deps.jobs.autoBacklog();
    for (const mint of this.deps.store.autoTraceCandidates(now, autoTraceMinProgress, autoTraceWindowSec)) {
      if (this.budget < 1 || backlog >= MAX_AUTO_BACKLOG) break;
      this.budget--;
      backlog++;
      this.deps.store.markAutoTraced(mint, now);
      this.deps.jobs.start(mint, "auto");
    }
  }
}
