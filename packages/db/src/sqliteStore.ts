import Database from "better-sqlite3";
import type { ParsedTx, Store, TaintedFunder, WalletRecord } from "@pumpfun/core";
import type { ChainNode, Crosslink, JobState, RecentTrace, TraceEvent, TraceResult, WalletView } from "@pumpfun/shared";
import { SCHEMA } from "./schema";

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
  fetchedAt: r.fetched_at,
});

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");
const MAX_WALLET_CHAIN = 6;

export class SqliteStore implements Store {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
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
        `INSERT INTO wallets (address, funder_resolved, funder, funding_signature, funding_amount_lamports, funded_at, terminal, fetched_at)
         VALUES (@address, @funderResolved, @funder, @fundingSignature, @fundingAmountLamports, @fundedAt, @terminal, @fetchedAt)
         ON CONFLICT(address) DO UPDATE SET
           funder_resolved = excluded.funder_resolved, funder = excluded.funder,
           funding_signature = excluded.funding_signature, funding_amount_lamports = excluded.funding_amount_lamports,
           funded_at = excluded.funded_at, terminal = excluded.terminal, fetched_at = excluded.fetched_at`,
      )
      .run({
        address: w.address,
        funderResolved: w.funderResolved ? 1 : 0,
        funder: w.funder,
        fundingSignature: w.fundingSignature,
        fundingAmountLamports: w.fundingAmountLamports,
        fundedAt: w.fundedAt,
        terminal: w.terminal,
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
    const row = this.db
      .prepare("SELECT json_extract(json, '$.token.createSignature') AS sig FROM trace_results WHERE mint = ?")
      .get(mint) as { sig: string | null } | undefined;
    return row?.sig ?? null;
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
