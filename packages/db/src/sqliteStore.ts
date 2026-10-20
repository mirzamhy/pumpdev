import Database from "better-sqlite3";
import type { ParsedTx, RepeatSniper, Store, TaintedFunder, WalletRecord } from "@pumpfun/core";
import type { ChainNode, Crosslink, FeedStats, FeedTab, JobState, RecentTrace, TraceEvent, TraceResult, WalletView } from "@pumpfun/shared";
import { rawToFeedRow, symbolKey, type FeedCurveUpdate, type FeedRow, type FeedRowRaw, type FeedTokenInput } from "./feed";
import { COLUMN_MIGRATIONS, SCHEMA } from "./schema";

export interface JobRow {
  id: string;
  mint: string;
  state: JobState;
  partial: boolean;
}

interface WalletRow {
  address: string;
  funder_resolved: number;
  funder: string | null;
  funding_signature: string | null;
  funding_amount_lamports: string | null;
  funded_at: number | null;
  terminal: WalletRecord["terminal"];
  first_seen_at: number | null;
  fetched_at: number;
}

const rowToWallet = (r: WalletRow): WalletRecord => ({
  address: r.address,
  funderResolved: r.funder_resolved === 1,
  funder: r.funder,
  fundingSignature: r.funding_signature,
  fundingAmountLamports: r.funding_amount_lamports,
  fundedAt: r.funded_at,
  terminal: r.terminal,
  firstSeenAt: r.first_seen_at,
  fetchedAt: r.fetched_at,
});

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");
const MAX_WALLET_CHAIN = 6;

const HOUR = 3600;
const DAY = 86_400;
/** Tokens younger than this are polled every tick. */
const YOUNG_SEC = 600;
/** Older tokens with traction keep being polled, at most every HOT_POLL_SEC, until HOT_MAX_AGE_SEC. */
const HOT_MIN_PROGRESS = 10;
const HOT_POLL_SEC = 120;
const HOT_MAX_AGE_SEC = 6 * HOUR;
const MAX_POLL = 1000;
const MAX_CANDIDATES = 50;
const FRESH_TRACE_SEC = HOUR;

const FEED_ORDER: Record<FeedTab, { where: string; order: string }> = {
  new: { where: "1 = 1", order: "f.created_at DESC" },
  hot: { where: "f.migrated_at IS NULL AND f.complete = 0 AND f.created_at > @hotSince", order: "f.progress_pct DESC, f.created_at DESC" },
  traced: { where: "tr.mint IS NOT NULL", order: "tr.finished_at DESC" },
};

export class SqliteStore implements Store {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrateColumns();
    this.db.exec(SCHEMA);
  }

  private migrateColumns(): void {
    for (const m of COLUMN_MIGRATIONS) {
      const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(m.table);
      if (!exists) continue;
      const columns = this.db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
      if (!columns.some((c) => c.name === m.column)) this.db.exec(m.ddl);
    }
  }

  close(): void {
    this.db.close();
  }

  // ---- Store (trace cache) ----

  getWallet(address: string): WalletRecord | null {
    const row = this.db.prepare("SELECT * FROM wallets WHERE address = ?").get(address) as WalletRow | undefined;
    return row ? rowToWallet(row) : null;
  }

  putWallet(w: WalletRecord): void {
    this.db
      .prepare(
        `INSERT INTO wallets (address, funder_resolved, funder, funding_signature, funding_amount_lamports, funded_at, terminal, first_seen_at, fetched_at)
         VALUES (@address, @funderResolved, @funder, @fundingSignature, @fundingAmountLamports, @fundedAt, @terminal, @firstSeenAt, @fetchedAt)
         ON CONFLICT(address) DO UPDATE SET
           funder_resolved = excluded.funder_resolved, funder = excluded.funder,
           funding_signature = excluded.funding_signature, funding_amount_lamports = excluded.funding_amount_lamports,
           funded_at = excluded.funded_at, terminal = excluded.terminal, first_seen_at = excluded.first_seen_at,
           fetched_at = excluded.fetched_at`,
      )
      .run({
        address: w.address,
        funderResolved: w.funderResolved ? 1 : 0,
        funder: w.funder,
        fundingSignature: w.fundingSignature,
        fundingAmountLamports: w.fundingAmountLamports,
        fundedAt: w.fundedAt,
        terminal: w.terminal,
        firstSeenAt: w.firstSeenAt,
        fetchedAt: w.fetchedAt,
      });
  }

  getTx(signature: string): ParsedTx | null {
    const row = this.db.prepare("SELECT json FROM tx_cache WHERE signature = ?").get(signature) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as ParsedTx) : null;
  }

  putTx(signature: string, tx: ParsedTx): void {
    this.db.prepare("INSERT OR IGNORE INTO tx_cache (signature, json) VALUES (?, ?)").run(signature, JSON.stringify(tx));
  }

  findCreateSignature(mint: string): string | null {
    const traced = this.db
      .prepare("SELECT json_extract(json, '$.token.createSignature') AS sig FROM trace_results WHERE mint = ?")
      .get(mint) as { sig: string | null } | undefined;
    if (traced?.sig) return traced.sig;
    const feed = this.db.prepare("SELECT create_signature AS sig FROM feed_tokens WHERE mint = ?").get(mint) as { sig: string | null } | undefined;
    return feed?.sig ?? null;
  }

  findCrosslinks(wallets: string[], excludeMint: string): Crosslink[] {
    if (wallets.length === 0) return [];
    return this.db
      .prepare(
        `SELECT tw.wallet AS wallet, tw.role AS role, tw.mint AS otherMint, t.symbol AS otherSymbol
         FROM trace_wallets tw LEFT JOIN tokens t ON t.mint = tw.mint
         WHERE tw.wallet IN (${placeholders(wallets.length)}) AND tw.mint != ?
         ORDER BY tw.mint LIMIT 50`,
      )
      .all(...wallets, excludeMint) as Crosslink[];
  }

  findTaintedFunders(wallets: string[], excludeMint: string): TaintedFunder[] {
    if (wallets.length === 0) return [];
    const ph = placeholders(wallets.length);
    const viaTraces = this.db
      .prepare(
        `SELECT tw.wallet AS wallet, COUNT(DISTINCT dt.mint) AS deadCount
         FROM trace_wallets tw
         JOIN tokens t ON t.mint = tw.mint
         JOIN dev_tokens dt ON dt.deployer = t.deployer AND dt.status = 'dead_dev_exited'
         WHERE tw.wallet IN (${ph}) AND tw.role = 'funder' AND tw.mint != ?
         GROUP BY tw.wallet`,
      )
      .all(...wallets, excludeMint) as TaintedFunder[];
    const asDeployer = this.db
      .prepare(
        `SELECT deployer AS wallet, COUNT(*) AS deadCount FROM dev_tokens
         WHERE deployer IN (${ph}) AND status = 'dead_dev_exited' AND mint != ?
         GROUP BY deployer`,
      )
      .all(...wallets, excludeMint) as TaintedFunder[];
    const totals = new Map<string, number>();
    for (const row of [...viaTraces, ...asDeployer]) totals.set(row.wallet, (totals.get(row.wallet) ?? 0) + row.deadCount);
    return [...totals].map(([wallet, deadCount]) => ({ wallet, deadCount }));
  }

  findRepeatSnipers(wallets: string[], excludeMint: string): RepeatSniper[] {
    if (wallets.length === 0) return [];
    return this.db
      .prepare(
        `SELECT wallet, COUNT(DISTINCT mint) AS count FROM early_buyers
         WHERE wallet IN (${placeholders(wallets.length)}) AND mint != ? AND slot_offset <= 2
         GROUP BY wallet HAVING COUNT(DISTINCT mint) >= 3`,
      )
      .all(...wallets, excludeMint) as RepeatSniper[];
  }

  // ---- Jobs and events ----

  createJob(id: string, mint: string, startedAtMs: number): void {
    this.db.prepare("INSERT INTO trace_jobs (id, mint, state, partial, started_at) VALUES (?, ?, 'running', 0, ?)").run(id, mint, startedAtMs);
  }

  finishJob(id: string, state: JobState, partial: boolean, finishedAtMs: number): void {
    this.db.prepare("UPDATE trace_jobs SET state = ?, partial = ?, finished_at = ? WHERE id = ?").run(state, partial ? 1 : 0, finishedAtMs, id);
  }

  getJob(id: string): JobRow | null {
    const row = this.db.prepare("SELECT id, mint, state, partial FROM trace_jobs WHERE id = ?").get(id) as
      | { id: string; mint: string; state: JobState; partial: number }
      | undefined;
    return row ? { id: row.id, mint: row.mint, state: row.state, partial: row.partial === 1 } : null;
  }

  markRunningJobsInterrupted(nowMs: number): number {
    return this.db.prepare("UPDATE trace_jobs SET state = 'interrupted', partial = 1, finished_at = ? WHERE state = 'running'").run(nowMs).changes;
  }

  appendEvent(jobId: string, seq: number, event: TraceEvent): void {
    this.db.prepare("INSERT INTO trace_events (job_id, seq, json) VALUES (?, ?, ?)").run(jobId, seq, JSON.stringify(event));
  }

  listEvents(jobId: string): { seq: number; event: TraceEvent }[] {
    const rows = this.db.prepare("SELECT seq, json FROM trace_events WHERE job_id = ? ORDER BY seq").all(jobId) as { seq: number; json: string }[];
    return rows.map((r) => ({ seq: r.seq, event: JSON.parse(r.json) as TraceEvent }));
  }

  // ---- Results ----

  saveResult(r: TraceResult): void {
    const save = this.db.transaction((res: TraceResult) => {
      const { token } = res;
      this.db
        .prepare(
          `INSERT INTO trace_results (mint, json, score, finished_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(mint) DO UPDATE SET json = excluded.json, score = excluded.score, finished_at = excluded.finished_at`,
        )
        .run(token.mint, JSON.stringify(res), res.score.score, res.finishedAt);

      const upsertToken = this.db.prepare(
        `INSERT INTO tokens (mint, name, symbol, deployer, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(mint) DO UPDATE SET name = COALESCE(excluded.name, tokens.name), symbol = COALESCE(excluded.symbol, tokens.symbol),
           deployer = excluded.deployer, created_at = COALESCE(excluded.created_at, tokens.created_at)`,
      );
      upsertToken.run(token.mint, token.name, token.symbol, token.deployer, token.createdAt);

      const upsertDevToken = this.db.prepare(
        `INSERT INTO dev_tokens (deployer, mint, status, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(deployer, mint) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at`,
      );
      for (const t of res.devHistory) {
        upsertToken.run(t.mint, t.name, t.symbol, token.deployer, t.createdAt);
        upsertDevToken.run(token.deployer, t.mint, t.status, res.finishedAt);
      }

      this.db.prepare("DELETE FROM trace_wallets WHERE mint = ?").run(token.mint);
      const addWallet = this.db.prepare("INSERT OR IGNORE INTO trace_wallets (mint, wallet, role, depth) VALUES (?, ?, ?, ?)");
      for (const n of res.nodes) {
        if (n.terminal === "high_activity") continue;
        addWallet.run(token.mint, n.address, n.role, n.depth);
      }
      for (const t of res.devStatus?.transfers ?? []) addWallet.run(token.mint, t.to, "insider", 0);

      if (res.holders?.earlyBuyers) {
        this.db.prepare("DELETE FROM early_buyers WHERE mint = ?").run(token.mint);
        const addBuyer = this.db.prepare("INSERT OR IGNORE INTO early_buyers (mint, wallet, slot_offset) VALUES (?, ?, ?)");
        for (const b of res.holders.earlyBuyers) addBuyer.run(token.mint, b.wallet, b.slotOffset);
      }
    });
    save(r);
  }

  getResult(mint: string): { result: TraceResult; finishedAt: number } | null {
    const row = this.db.prepare("SELECT json, finished_at FROM trace_results WHERE mint = ?").get(mint) as
      | { json: string; finished_at: number }
      | undefined;
    return row ? { result: JSON.parse(row.json) as TraceResult, finishedAt: row.finished_at } : null;
  }

  recent(limit: number): RecentTrace[] {
    const rows = this.db.prepare("SELECT json FROM trace_results ORDER BY finished_at DESC LIMIT ?").all(limit) as { json: string }[];
    return rows.map((row) => {
      const r = JSON.parse(row.json) as TraceResult;
      return { mint: r.token.mint, name: r.token.name, symbol: r.token.symbol, score: r.score.score, level: r.score.level, finishedAt: r.finishedAt };
    });
  }

  // ---- Live feed ----

  insertFeedToken(t: FeedTokenInput): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO feed_tokens (mint, name, symbol, symbol_key, uri, creator, bonding_curve, create_signature, created_at,
           initial_buy_sol, mayhem, market_cap_sol, progress_pct, peak_progress_pct, real_sol)
         VALUES (@mint, @name, @symbol, @symbolKey, @uri, @creator, @bondingCurve, @createSignature, @createdAt,
           @initialBuySol, @mayhem, @marketCapSol, @progressPct, @progressPct, @realSol)`,
      )
      .run({ ...t, isMayhemMode: null, symbolKey: symbolKey(t.symbol), mayhem: t.isMayhemMode ? 1 : 0 });
    return result.changes === 1;
  }

  updateFeedCurves(rows: FeedCurveUpdate[], polledAt: number): void {
    const update = this.db.prepare(
      `UPDATE feed_tokens SET market_cap_sol = @marketCapSol, progress_pct = @progressPct, peak_progress_pct = MAX(peak_progress_pct, @progressPct),
         real_sol = @realSol,
         complete = MAX(complete, @complete), polled_at = @polledAt WHERE mint = @mint`,
    );
    this.db.transaction(() => {
      for (const r of rows) update.run({ ...r, complete: r.complete ? 1 : 0, polledAt });
    })();
  }

  markMigrated(mint: string, at: number): void {
    this.db.prepare("UPDATE feed_tokens SET complete = 1, progress_pct = 100, peak_progress_pct = 100, migrated_at = COALESCE(migrated_at, ?) WHERE mint = ?").run(at, mint);
  }

  markAutoTraced(mint: string, at: number): void {
    this.db.prepare("UPDATE feed_tokens SET auto_traced_at = ? WHERE mint = ?").run(at, mint);
  }

  feedTokensToPoll(now: number): { mint: string; bondingCurve: string }[] {
    return this.db
      .prepare(
        `SELECT mint, bonding_curve AS bondingCurve FROM feed_tokens
         WHERE complete = 0 AND (
           created_at > @young
           OR (progress_pct >= @minProgress AND created_at > @hotSince AND (polled_at IS NULL OR polled_at <= @due))
         )
         ORDER BY created_at DESC LIMIT @limit`,
      )
      .all({ young: now - YOUNG_SEC, minProgress: HOT_MIN_PROGRESS, hotSince: now - HOT_MAX_AGE_SEC, due: now - HOT_POLL_SEC, limit: MAX_POLL }) as {
      mint: string;
      bondingCurve: string;
    }[];
  }

  autoTraceCandidates(now: number, minProgress: number, windowSec: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT f.mint FROM feed_tokens f
         WHERE f.auto_traced_at IS NULL AND f.created_at > @since AND f.progress_pct >= @minProgress
           AND NOT EXISTS (SELECT 1 FROM trace_results tr WHERE tr.mint = f.mint AND tr.finished_at > @freshSince)
         ORDER BY f.progress_pct DESC LIMIT @limit`,
      )
      .all({ since: now - windowSec, minProgress, freshSince: now - FRESH_TRACE_SEC, limit: MAX_CANDIDATES }) as { mint: string }[];
    return rows.map((r) => r.mint);
  }

  feed(opts: { tab: FeedTab; hideHigh: boolean; limit: number; now: number }): FeedRow[] {
    const { where, order } = FEED_ORDER[opts.tab];
    const hideHigh = opts.hideHigh ? "AND (tr.mint IS NULL OR json_extract(tr.json, '$.score.level') != 'high')" : "";
    const rows = this.db
      .prepare(
        `SELECT f.mint, f.name, f.symbol, f.creator, f.created_at, f.market_cap_sol, f.progress_pct, f.peak_progress_pct, f.real_sol, f.initial_buy_sol,
           f.complete, f.migrated_at, f.mayhem, f.auto_traced_at,
           CASE WHEN f.symbol_key IS NULL THEN 0 ELSE (
             SELECT COUNT(*) FROM feed_tokens o WHERE o.symbol_key = f.symbol_key AND o.mint != f.mint AND o.created_at > @daySince
           ) END AS copycat_count,
           tr.score AS score, json_extract(tr.json, '$.score.level') AS level, tr.finished_at AS traced_at
         FROM feed_tokens f LEFT JOIN trace_results tr ON tr.mint = f.mint
         WHERE ${where} ${hideHigh}
         ORDER BY ${order} LIMIT @limit`,
      )
      .all({ daySince: opts.now - DAY, hotSince: opts.now - HOT_MAX_AGE_SEC, limit: opts.limit }) as FeedRowRaw[];
    return rows.map(rawToFeedRow);
  }

  feedStats(now: number): Omit<FeedStats, "connected"> {
    const seen = this.db.prepare("SELECT COUNT(*) AS n FROM feed_tokens WHERE created_at > ?").get(now - HOUR) as { n: number };
    const traced = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(json_extract(tr.json, '$.score.level') = 'high'), 0) AS high
         FROM trace_results tr JOIN feed_tokens f ON f.mint = tr.mint WHERE tr.finished_at > ?`,
      )
      .get(now - HOUR) as { n: number; high: number };
    return { seenLastHour: seen.n, tracedLastHour: traced.n, highRiskShare: traced.n === 0 ? null : traced.high / traced.n };
  }

  pruneFeed(before: number): number {
    return this.db.prepare("DELETE FROM feed_tokens WHERE created_at < ?").run(before).changes;
  }

  walletView(address: string): WalletView {
    const deployed = this.db
      .prepare(
        `SELECT t.mint AS mint, t.name AS name, t.symbol AS symbol, t.created_at AS createdAt, dt.status AS status
         FROM tokens t LEFT JOIN dev_tokens dt ON dt.mint = t.mint AND dt.deployer = t.deployer
         WHERE t.deployer = ? ORDER BY t.created_at DESC LIMIT 100`,
      )
      .all(address) as WalletView["deployed"];
    const appearances = this.db
      .prepare(
        `SELECT tw.mint AS mint, t.symbol AS symbol, tw.role AS role
         FROM trace_wallets tw LEFT JOIN tokens t ON t.mint = tw.mint
         WHERE tw.wallet = ? ORDER BY tw.mint LIMIT 100`,
      )
      .all(address) as WalletView["appearances"];

    const chain: ChainNode[] = [];
    const seen = new Set<string>();
    let current: string | null = address;
    for (let depth = 0; current && depth < MAX_WALLET_CHAIN && !seen.has(current); depth++) {
      seen.add(current);
      const w = this.getWallet(current);
      if (!w) {
        if (depth > 0) chain.push({ ...emptyNode(current, depth, address), terminal: "incomplete" });
        break;
      }
      chain.push({
        address: current,
        depth,
        role: depth === 0 && deployed.length > 0 ? "deployer" : "funder",
        chainRoot: address,
        fundedBy: w.funder,
        fundingAmountLamports: w.fundingAmountLamports,
        fundedAt: w.fundedAt,
        fundingSignature: w.fundingSignature,
        terminal: w.terminal,
      });
      current = w.funder;
    }

    const known = chain.length > 0 || deployed.length > 0 || appearances.length > 0;
    return { address, known, chain, deployed, appearances };
  }
}

function emptyNode(address: string, depth: number, chainRoot: string): ChainNode {
  return {
    address,
    depth,
    role: "funder",
    chainRoot,
    fundedBy: null,
    fundingAmountLamports: null,
    fundedAt: null,
    fundingSignature: null,
    terminal: null,
  };
}
