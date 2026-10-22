import type { DevProfile, DevStatus, DevToken, TokenInfo } from "@pumpfun/shared";
import type { AccountData, ChainSource, ParsedTx, SignatureInfo } from "../chain";
import type { TraceConfig } from "../config";
import { bondingCurvePda } from "../pda";
import { decodeBondingCurve } from "../pump/bondingCurve";
import type { CreateEvent } from "../pump/events";
import { mapLimit } from "../concurrency";
import { lamportDelta, ownerGainedOtherToken, pumpEvents, tokenDeltas } from "../tx";

export interface DevActivity {
  history: DevToken[];
  historyPartial: boolean;
  status: DevStatus;
  profile: DevProfile;
}

interface DevTx {
  sig: SignatureInfo;
  tx: ParsedTx;
}

const DAY = 86_400;
const TX_FETCH_CONCURRENCY = 4;
/** A dev selling an earlier launch within this many minutes counts as a fast sell. */
const FAST_SELL_MIN = 10;

export async function analyzeDev(token: TokenInfo, chain: ChainSource, cfg: TraceConfig, now: number): Promise<DevActivity> {
  const sigs = await chain.getSignatures(token.deployer, { limit: cfg.devTxScan });
  // RPC latency, not the rate limit, is the bottleneck for sequential fetches; the pool still caps the rate.
  const fetched = await mapLimit(
    sigs.filter((s) => !s.err),
    TX_FETCH_CONCURRENCY,
    async (sig) => ({ sig, tx: await chain.getTransaction(sig.signature) }),
  );
  const txs: DevTx[] = fetched.filter((f): f is DevTx => f.tx !== null);
  const holdings = await chain.getTokenHoldings(token.deployer);
  const balances = new Map(holdings.map((h) => [h.mint, BigInt(h.amount)]));
  const scannedAll = sigs.length < cfg.devTxScan;

  const history = await buildHistory(token, txs, balances, chain, now);
  return {
    history,
    historyPartial: !scannedAll,
    status: buildStatus(token, txs, balances, scannedAll),
    profile: buildProfile(token.deployer, txs, history, !scannedAll, now),
  };
}

async function buildHistory(
  token: TokenInfo,
  txs: DevTx[],
  balances: Map<string, bigint>,
  chain: ChainSource,
  now: number,
): Promise<DevToken[]> {
  const dev = token.deployer;
  const created = new Map<string, { ev: CreateEvent; createdAt: number | null; initialBuy: bigint }>();
  for (const { tx } of txs) {
    const events = pumpEvents(tx);
    for (const e of events) {
      // Launchpad tools sign `create` for the user and pass the user as `creator`, so match either.
      if (e.kind !== "create" || (e.event.user !== dev && e.event.creator !== dev) || e.event.mint === token.mint) continue;
      const mint = e.event.mint;
      const signer = e.event.user;
      const buy = events.find((t) => t.kind === "trade" && t.event.mint === mint && t.event.user === signer && t.event.isBuy);
      created.set(mint, {
        ev: e.event,
        createdAt: e.event.timestamp ?? tx.blockTime,
        initialBuy: buy && buy.kind === "trade" ? buy.event.tokenAmount : 0n,
      });
    }
  }

  const mints = [...created.keys()];
  const pdas = await Promise.all(mints.map((m) => bondingCurvePda(m)));
  const accounts: (AccountData | null)[] = [];
  for (let i = 0; i < pdas.length; i += 100) accounts.push(...(await chain.getAccounts(pdas.slice(i, i + 100))));

  return mints
    .map((mint, i): DevToken => {
      const { ev, createdAt, initialBuy } = created.get(mint)!;
      const account = accounts[i];
      const complete = account ? decodeBondingCurve(account.data).complete : false;
      const balance = balances.get(mint) ?? 0n;
      const age = createdAt === null ? 0 : now - createdAt;
      const exited = initialBuy > 0n ? balance * 100n < initialBuy : balance === 0n;
      const status: DevToken["status"] = complete ? "migrated" : age > DAY && exited ? "dead_dev_exited" : "alive";
      return {
        mint,
        name: ev.name,
        symbol: ev.symbol,
        createdAt,
        complete,
        devBalance: balance.toString(),
        initialBuy: initialBuy.toString(),
        status,
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Habits across the dev's earlier launches, from the same transaction window as the history. */
function buildProfile(dev: string, txs: DevTx[], history: DevToken[], partial: boolean, now: number): DevProfile {
  const firstSell = new Map<string, number>();
  let feeClaims = 0;
  let feeLamports = 0n;
  for (const { tx } of txs) {
    for (const e of pumpEvents(tx)) {
      if (e.kind === "trade" && !e.event.isBuy && e.event.user === dev) {
        const prev = firstSell.get(e.event.mint);
        if (prev === undefined || e.event.timestamp < prev) firstSell.set(e.event.mint, e.event.timestamp);
      } else if (e.kind === "feeClaim" && e.event.creator === dev) {
        feeClaims++;
        feeLamports += e.event.lamports;
      }
    }
  }

  const minutes = history.flatMap((t) => {
    const sold = firstSell.get(t.mint);
    return t.createdAt !== null && sold !== undefined && sold >= t.createdAt ? [(sold - t.createdAt) / 60] : [];
  });
  const created = history.map((t) => t.createdAt).filter((c): c is number => c !== null);
  const oldest = created.length ? Math.min(...created) : null;
  const days = oldest === null ? 0 : Math.max(1, (now - oldest) / DAY);
  return {
    launches: history.length,
    dead: history.filter((t) => t.status === "dead_dev_exited").length,
    migrated: history.filter((t) => t.status === "migrated").length,
    launchesPerDay: history.length >= 2 && days > 0 ? history.length / days : null,
    soldObserved: minutes.length,
    medianMinutesToSell: median(minutes),
    fastSells: minutes.filter((m) => m <= FAST_SELL_MIN).length,
    feeClaims,
    feeClaimedSol: Number(feeLamports) / 1e9,
    partial,
  };
}

function buildStatus(token: TokenInfo, txs: DevTx[], balances: Map<string, bigint>, scannedAll: boolean): DevStatus {
  const dev = token.deployer;
  let sold = 0n;
  let transferredOut = 0n;
  let bought = 0n;
  const transfers: DevStatus["transfers"] = [];
  let reachedLaunch = scannedAll || token.createdAt === null;

  for (const { sig, tx } of txs) {
    const time = sig.blockTime ?? tx.blockTime ?? 0;
    if (token.createdAt !== null && time <= token.createdAt) reachedLaunch = true;
    if (sig.signature === token.createSignature) continue;
    if (token.createdAt !== null && time < token.createdAt) continue;

    const deltas = tokenDeltas(tx, token.mint);
    const d = deltas.get(dev) ?? 0n;
    if (d > 0n) bought += d;
    if (d >= 0n) continue;

    if (lamportDelta(tx, dev) > 0n || ownerGainedOtherToken(tx, dev, token.mint)) {
      sold += -d;
      continue;
    }
    const receivers = [...deltas].filter(([owner, v]) => owner !== dev && v > 0n);
    if (receivers.length === 0) {
      sold += -d;
      continue;
    }
    transferredOut += -d;
    for (const [to, amount] of receivers) transfers.push({ to, amount: amount.toString(), signature: sig.signature });
  }

  const initialBuy = token.devInitialBuy === null ? null : BigInt(token.devInitialBuy);
  const balance = balances.get(token.mint) ?? 0n;
  const base = (initialBuy ?? 0n) + bought;
  // Sells older than the scan window are invisible, but a balance below what the dev acquired still shows them.
  const shortfall = base > balance ? base - balance : 0n;
  const seen = sold + transferredOut;
  const released = seen > shortfall ? seen : shortfall;
  return {
    initialBuy: initialBuy === null ? null : initialBuy.toString(),
    bought: bought.toString(),
    sold: sold.toString(),
    transferredOut: transferredOut.toString(),
    balance: balance.toString(),
    releasedPct: base > 0n ? Number((released * 10_000n) / base) / 100 : null,
    transfers,
    partial: !reachedLaunch,
  };
}
