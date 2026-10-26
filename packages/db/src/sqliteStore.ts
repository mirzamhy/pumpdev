import Database from "better-sqlite3";
import { classifyDev, computeQuickScore, type ParsedTx, type RepeatSniper, type SocialKeys, type Store, type TaintedFunder, type TokenMetaRecord, type WalletRecord } from "@pumpfun/core";
import {
  curveDumped,
  type ChainNode,
  type ClusterWallet,
  type Crosslink,
  type DevProfile,
  type FeedLaunch,
  type FeedStats,
  type FeedTab,
  type JobState,
  type RecentTrace,
  type RiskyWallets,
  type SocialReuse,
  type TraceEvent,
  type TraceResult,
  type TwitterKind,
  type WalletView,
} from "@pumpfun/shared";
import { rawToFeedRow, symbolKey, type FeedCurveUpdate, type FeedRow, type FeedRowBase, type FeedRowRaw, type FeedTokenInput } from "./feed";
import { riskyWallets } from "./risky";
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
const CLUSTER_LIMIT = 20;

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
/** Socials shared with tokens younger than this are a copycat wave, not recycling. */
const REUSE_MIN_AGE_SEC = HOUR;
const REUSE_EXAMPLES = 5;
/** A key shared by more tokens than this belongs to a platform or template (a launchpad site, a default image), not one project. */
const REUSE_MAX_SHARED = 20;

interface TokenMetaRow {
  mint: string;
  created_at: number;
  fetched_at: number;
  ok: number;
  twitter_url: string | null;
  twitter_kind: TwitterKind | null;
  twitter_handle: string | null;
  tweet_id: string | null;
  telegram: string | null;
  website: string | null;
  website_key: string | null;
  image: string | null;
  image_key: string | null;
  description: string | null;
}

const rowToMeta = (r: TokenMetaRow): TokenMetaRecord => ({
  mint: r.mint,
  createdAt: r.created_at,
  fetchedAt: r.fetched_at,
  ok: r.ok === 1,
  twitter: r.twitter_url && r.twitter_kind ? { url: r.twitter_url, kind: r.twitter_kind, handle: r.twitter_handle, tweetId: r.tweet_id } : null,
  telegram: r.telegram,
  website: r.website,
  websiteKey: r.website_key,
  image: r.image,
  imageKey: r.image_key,
  description: r.description,
});

const shared = (column: string) => `(SELECT COUNT(*) FROM token_meta c WHERE c.${column} = me.${column}) <= ${REUSE_MAX_SHARED}`;

/** Same project account, website or image as an older token (feed query, per row). */
const RECYCLED_SQL = `EXISTS (
  SELECT 1 FROM token_meta me JOIN token_meta o ON o.mint != me.mint AND o.ok = 1 AND o.created_at <= me.created_at - ${REUSE_MIN_AGE_SEC}
    AND ((me.twitter_kind = 'account' AND o.twitter_kind = 'account' AND o.twitter_handle = me.twitter_handle AND ${shared("twitter_handle")})
      OR (o.website_key = me.website_key AND ${shared("website_key")})
      OR (o.image_key = me.image_key AND ${shared("image_key")}))
  WHERE me.mint = f.mint AND me.ok = 1
)`;

/** Same rule as `curveDumped` in @pumpfun/shared, for SQL. */
const DUMPED_SQL = "(complete = 0 AND peak_progress_pct >= 20 AND progress_pct <= peak_progress_pct * 0.4)";

const FEED_COLUMNS = `f.mint, f.name, f.symbol, f.creator, f.created_at, f.market_cap_sol, f.progress_pct, f.peak_progress_pct, f.real_sol, f.initial_buy_sol, f.dev_buy_pct,
           f.complete, f.migrated_at, f.mayhem, f.auto_traced_at,
           CASE WHEN f.symbol_key IS NULL THEN 0 ELSE (
             SELECT COUNT(*) FROM feed_tokens o WHERE o.symbol_key = f.symbol_key AND o.mint != f.mint AND o.created_at > @daySince
           ) END AS copycat_count,
           ${RECYCLED_SQL} AS recycled_socials,
           tr.score AS score, json_extract(tr.json, '$.score.level') AS level, tr.finished_at AS traced_at`;

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
           initial_buy_sol, dev_buy_pct, mayhem, market_cap_sol, progress_pct, peak_progress_pct, real_sol)
         VALUES (@mint, @name, @symbol, @symbolKey, @uri, @creator, @bondingCurve, @createSignature, @createdAt,
           @initialBuySol, @devBuyPct, @mayhem, @marketCapSol, @progressPct, @progressPct, @realSol)`,
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
    // Quick scores are computed after the query, so hiding high risk fetches extra rows to fill the page.
    const fetchLimit = opts.hideHigh ? opts.limit * 2 : opts.limit;
    const raw = this.db
      .prepare(
        `SELECT ${FEED_COLUMNS}
         FROM feed_tokens f LEFT JOIN trace_results tr ON tr.mint = f.mint
         WHERE ${where} ${hideHigh}
         ORDER BY ${order} LIMIT @limit`,
      )
      .all({ daySince: opts.now - DAY, hotSince: opts.now - HOT_MAX_AGE_SEC, limit: fetchLimit }) as FeedRowRaw[];
    const rows = this.withQuick(raw.map(rawToFeedRow), opts.now);
    const shown = opts.hideHigh ? rows.filter((r) => r.score !== null || r.quick.level !== "high") : rows;
    return shown.slice(0, opts.limit);
  }

  /** One feed token with its quick score, for the token page while a trace runs; null when the feed never saw it. */
  feedItem(mint: string, now: number): FeedRow | null {
    const raw = this.db
      .prepare(`SELECT ${FEED_COLUMNS} FROM feed_tokens f LEFT JOIN trace_results tr ON tr.mint = f.mint WHERE f.mint = @mint`)
      .get({ mint, daySince: now - DAY }) as FeedRowRaw | undefined;
    return raw ? this.withQuick([rawToFeedRow(raw)], now)[0]! : null;
  }

  /** Adds the instant score from what earlier traces and the live feed already know about each creator. */
  private withQuick(rows: FeedRowBase[], now: number): FeedRow[] {
    const creators = [...new Set(rows.map((r) => r.creator))];
    if (creators.length === 0) return [];
    const ph = placeholders(creators.length);
    const dead = new Map(
      (
        this.db
          .prepare(`SELECT deployer AS wallet, COUNT(*) AS n FROM dev_tokens WHERE deployer IN (${ph}) AND status = 'dead_dev_exited' GROUP BY deployer`)
          .all(...creators) as { wallet: string; n: number }[]
      ).map((r) => [r.wallet, r.n]),
    );
    const launches = this.db
      .prepare(
        `SELECT creator, mint, ${DUMPED_SQL} AS dumped FROM feed_tokens WHERE creator IN (${ph}) AND created_at > ?`,
      )
      .all(...creators, now - DAY) as { creator: string; mint: string; dumped: number }[];
    const byCreator = new Map<string, { mint: string; dumped: boolean }[]>();
    for (const l of launches) byCreator.set(l.creator, [...(byCreator.get(l.creator) ?? []), { mint: l.mint, dumped: l.dumped === 1 }]);

    const funders = this.db
      .prepare(`SELECT address, funder FROM wallets WHERE address IN (${ph}) AND funder IS NOT NULL`)
      .all(...creators) as { address: string; funder: string }[];
    const funderOf = new Map(funders.filter((f) => f.funder !== f.address).map((f) => [f.address, f.funder]));
    const tainted = new Map(this.findTaintedFunders([...new Set(funderOf.values())], "").map((t) => [t.wallet, t.deadCount]));

    const profiles = new Map<string, { fastSells: number; soldObserved: number }>();
    const profileRows = this.db
      .prepare(
        `SELECT t.deployer AS wallet, json_extract(tr.json, '$.devProfile.fastSells') AS fastSells,
           json_extract(tr.json, '$.devProfile.soldObserved') AS soldObserved
         FROM trace_results tr JOIN tokens t ON t.mint = tr.mint
         WHERE t.deployer IN (${ph}) AND json_extract(tr.json, '$.devProfile') IS NOT NULL
         ORDER BY tr.finished_at DESC`,
      )
      .all(...creators) as { wallet: string; fastSells: number | null; soldObserved: number | null }[];
    for (const p of profileRows) {
      if (!profiles.has(p.wallet)) profiles.set(p.wallet, { fastSells: p.fastSells ?? 0, soldObserved: p.soldObserved ?? 0 });
    }

    return rows.map(({ devBuyPct, ...row }) => {
      const others = (byCreator.get(row.creator) ?? []).filter((l) => l.mint !== row.mint);
      const funder = funderOf.get(row.creator);
      const funderDead = funder ? (tainted.get(funder) ?? 0) : 0;
      const profile = profiles.get(row.creator);
      const quick = computeQuickScore({
        copycatCount: row.copycatCount,
        recycledSocials: row.recycledSocials,
        dumped: curveDumped(row),
        peakProgressPct: row.peakProgressPct,
        progressPct: row.progressPct,
        devBuyPct,
        creatorDeadLaunches: dead.get(row.creator) ?? 0,
        creatorLaunches24h: others.length,
        creatorDumped24h: others.filter((l) => l.dumped).length,
        taintedFunder: funder && funderDead > 0 ? { wallet: funder, deadCount: funderDead } : null,
        fastSells: profile?.fastSells ?? 0,
        soldObserved: profile?.soldObserved ?? 0,
      });
      return { ...row, quick };
    });
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

  // ---- Token metadata ----

  getTokenMeta(mint: string): TokenMetaRecord | null {
    const row = this.db.prepare("SELECT * FROM token_meta WHERE mint = ?").get(mint) as TokenMetaRow | undefined;
    return row ? rowToMeta(row) : null;
  }

  putTokenMeta(m: TokenMetaRecord): void {
    this.db
      .prepare(
        `INSERT INTO token_meta (mint, created_at, fetched_at, ok, twitter_url, twitter_kind, twitter_handle, tweet_id, telegram, website,
           website_key, image, image_key, description)
         VALUES (@mint, @createdAt, @fetchedAt, @ok, @twitterUrl, @twitterKind, @twitterHandle, @tweetId, @telegram, @website,
           @websiteKey, @image, @imageKey, @description)
         ON CONFLICT(mint) DO UPDATE SET fetched_at = excluded.fetched_at, ok = excluded.ok, twitter_url = excluded.twitter_url,
           twitter_kind = excluded.twitter_kind, twitter_handle = excluded.twitter_handle, tweet_id = excluded.tweet_id,
           telegram = excluded.telegram, website = excluded.website, website_key = excluded.website_key, image = excluded.image,
           image_key = excluded.image_key, description = excluded.description`,
      )
      .run({
        mint: m.mint,
        createdAt: m.createdAt,
        fetchedAt: m.fetchedAt,
        ok: m.ok ? 1 : 0,
        twitterUrl: m.twitter?.url ?? null,
        twitterKind: m.twitter?.kind ?? null,
        twitterHandle: m.twitter?.handle ?? null,
        tweetId: m.twitter?.tweetId ?? null,
        telegram: m.telegram,
        website: m.website,
        websiteKey: m.websiteKey,
        image: m.image,
        imageKey: m.imageKey,
        description: m.description,
      });
  }

  findSocialReuse(mint: string, createdAt: number, keys: SocialKeys): { reuse: SocialReuse[]; sameTweetCount: number } {
    const reuse: SocialReuse[] = [];
    /** `column` is one of our own column names, never user input. */
    const add = (kind: SocialReuse["kind"], value: string | null, column: string, extra = "") => {
      if (!value) return;
      const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM token_meta WHERE ${column} = ?`).get(value) as { n: number }).n;
      if (total > REUSE_MAX_SHARED) return;
      const tokens = this.db
        .prepare(
          `SELECT m.mint AS mint, COALESCE(f.symbol, t.symbol) AS symbol, m.created_at AS createdAt
           FROM token_meta m LEFT JOIN feed_tokens f ON f.mint = m.mint LEFT JOIN tokens t ON t.mint = m.mint
           WHERE m.ok = 1 AND m.mint != ? AND m.created_at <= ? AND m.${column} = ? ${extra}
           ORDER BY m.created_at DESC LIMIT ?`,
        )
        .all(mint, createdAt - REUSE_MIN_AGE_SEC, value, REUSE_EXAMPLES) as SocialReuse["tokens"];
      if (tokens.length) reuse.push({ kind, value, tokens });
    };
    add("twitter", keys.twitterHandle, "twitter_handle", "AND m.twitter_kind = 'account'");
    add("website", keys.websiteKey, "website_key");
    add("image", keys.imageKey, "image_key");
    const sameTweetCount = keys.tweetId
      ? (this.db.prepare("SELECT COUNT(*) AS n FROM token_meta WHERE ok = 1 AND tweet_id = ? AND mint != ?").get(keys.tweetId, mint) as { n: number }).n
      : 0;
    return { reuse, sameTweetCount };
  }

  pruneTokenMeta(before: number): number {
    return this.db
      .prepare("DELETE FROM token_meta WHERE created_at < ? AND mint NOT IN (SELECT mint FROM trace_results)")
      .run(before).changes;
  }

  riskyWallets(now: number): RiskyWallets {
    return riskyWallets(this.db, now);
  }

  /** This creator's tokens in the live feed, newest first, with quick scores. */
  feedByCreator(creator: string, now: number): FeedRow[] {
    const raw = this.db
      .prepare(
        `SELECT ${FEED_COLUMNS} FROM feed_tokens f LEFT JOIN trace_results tr ON tr.mint = f.mint
         WHERE f.creator = @creator ORDER BY f.created_at DESC LIMIT 100`,
      )
      .all({ creator, daySince: now - DAY }) as FeedRowRaw[];
    return this.withQuick(raw.map(rawToFeedRow), now);
  }

  /** Wallets around one address: same funder, funded by it, repeat early buyers and insiders of its launches. */
  private walletCluster(address: string, self: WalletRecord | null): WalletView["cluster"] {
    const launchesOf = `(SELECT COUNT(*) FROM tokens t WHERE t.deployer = w.address)
      + (SELECT COUNT(*) FROM feed_tokens f WHERE f.creator = w.address AND NOT EXISTS (SELECT 1 FROM tokens t2 WHERE t2.mint = f.mint))`;
    // An exchange funds everyone, so it says nothing about common ownership.
    const funder = self?.funder && this.getWallet(self.funder)?.terminal !== "high_activity" ? self.funder : null;
    const siblings = funder
      ? (this.db
          .prepare(
            `SELECT w.address AS wallet, ${launchesOf} AS count,
               (SELECT COUNT(*) FROM dev_tokens dt WHERE dt.deployer = w.address AND dt.status = 'dead_dev_exited') AS dead
             FROM wallets w WHERE w.funder = ? AND w.address != ? ORDER BY count DESC, dead DESC LIMIT ${CLUSTER_LIMIT}`,
          )
          .all(funder, address) as ClusterWallet[])
      : [];
    const funded = this.db
      .prepare(`SELECT w.address AS wallet, ${launchesOf} AS count FROM wallets w WHERE w.funder = ? ORDER BY count DESC LIMIT ${CLUSTER_LIMIT}`)
      .all(address) as ClusterWallet[];
    const repeatBuyers = this.db
      .prepare(
        `SELECT eb.wallet AS wallet, COUNT(DISTINCT eb.mint) AS count FROM early_buyers eb JOIN tokens t ON t.mint = eb.mint
         WHERE t.deployer = ? AND eb.slot_offset <= 2 AND eb.wallet != ?
         GROUP BY eb.wallet HAVING count >= 2 ORDER BY count DESC LIMIT ${CLUSTER_LIMIT}`,
      )
      .all(address, address) as ClusterWallet[];
    const insiders = this.db
      .prepare(
        `SELECT tw.wallet AS wallet, COUNT(DISTINCT tw.mint) AS count FROM trace_wallets tw JOIN tokens t ON t.mint = tw.mint
         WHERE t.deployer = ? AND tw.role = 'insider' GROUP BY tw.wallet ORDER BY count DESC LIMIT ${CLUSTER_LIMIT}`,
      )
      .all(address) as ClusterWallet[];
    return { funder, siblings, funded, repeatBuyers, insiders };
  }

  walletView(address: string, now = Math.floor(Date.now() / 1000)): WalletView {
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

    const profileRow = this.db
      .prepare(
        `SELECT json_extract(tr.json, '$.devProfile') AS profile FROM trace_results tr JOIN tokens t ON t.mint = tr.mint
         WHERE t.deployer = ? ORDER BY tr.finished_at DESC LIMIT 1`,
      )
      .get(address) as { profile: string | null } | undefined;
    const profile = profileRow?.profile ? (JSON.parse(profileRow.profile) as DevProfile) : null;

    const self = this.getWallet(address);
    const cluster = this.walletCluster(address, self);
    const feedLaunches: FeedLaunch[] = this.feedByCreator(address, now).map((r) => ({
      mint: r.mint,
      name: r.name,
      symbol: r.symbol,
      createdAt: r.createdAt,
      progressPct: r.progressPct,
      peakProgressPct: r.peakProgressPct,
      complete: r.complete,
      migratedAt: r.migratedAt,
      recycledSocials: r.recycledSocials,
      quick: r.quick,
      score: r.score,
      level: r.level,
    }));

    const tracedMints = new Set(deployed.map((d) => d.mint));
    const feedOnly = feedLaunches.filter((f) => !tracedMints.has(f.mint));
    const archetype = classifyDev({
      launches: deployed.length + feedOnly.length,
      dead: deployed.filter((d) => d.status === "dead_dev_exited").length,
      migrated: deployed.filter((d) => d.status === "migrated").length + feedOnly.filter((f) => f.complete || f.migratedAt !== null).length,
      dumped: feedLaunches.filter((f) => curveDumped(f)).length,
      fastSells: profile?.fastSells ?? 0,
      soldObserved: profile?.soldObserved ?? 0,
      launches24h: feedLaunches.filter((f) => f.createdAt > now - DAY).length,
      siblings: cluster.siblings.length,
      repeatBuyers: cluster.repeatBuyers.length,
      recycled: feedLaunches.filter((f) => f.recycledSocials).length,
    });

    const known = chain.length > 0 || deployed.length > 0 || appearances.length > 0 || feedLaunches.length > 0;
    return { address, known, chain, deployed, appearances, profile, firstSeenAt: self?.firstSeenAt ?? null, cluster, feedLaunches, archetype };
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
