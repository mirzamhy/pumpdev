import type { DevStatus, DevToken, TokenInfo } from "@pumpfun/shared";
import type { AccountData, ChainSource, ParsedTx, SignatureInfo } from "../chain";
import type { TraceConfig } from "../config";
import { bondingCurvePda } from "../pda";
import { decodeBondingCurve } from "../pump/bondingCurve";
import type { CreateEvent } from "../pump/events";
import { lamportDelta, ownerGainedOtherToken, pumpEvents, tokenDeltas } from "../tx";

export interface DevActivity {
  history: DevToken[];
  historyPartial: boolean;
  status: DevStatus;
}

interface DevTx {
  sig: SignatureInfo;
  tx: ParsedTx;
}

const DAY = 86_400;

export async function analyzeDev(token: TokenInfo, chain: ChainSource, cfg: TraceConfig, now: number): Promise<DevActivity> {
  const sigs = await chain.getSignatures(token.deployer, { limit: cfg.devTxScan });
  const txs: DevTx[] = [];
  for (const sig of sigs) {
    if (sig.err) continue;
    const tx = await chain.getTransaction(sig.signature);
    if (tx) txs.push({ sig, tx });
  }
  const holdings = await chain.getTokenHoldings(token.deployer);
  const balances = new Map(holdings.map((h) => [h.mint, BigInt(h.amount)]));
  const scannedAll = sigs.length < cfg.devTxScan;

  return {
    history: await buildHistory(token, txs, balances, chain, now),
    historyPartial: !scannedAll,
    status: buildStatus(token, txs, balances, scannedAll),
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
      if (e.kind !== "create" || e.event.user !== dev || e.event.mint === token.mint) continue;
      const mint = e.event.mint;
      const buy = events.find((t) => t.kind === "trade" && t.event.mint === mint && t.event.user === dev && t.event.isBuy);
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
  const base = (initialBuy ?? 0n) + bought;
  const released = sold + transferredOut;
  return {
    initialBuy: initialBuy === null ? null : initialBuy.toString(),
    bought: bought.toString(),
    sold: sold.toString(),
    transferredOut: transferredOut.toString(),
    balance: (balances.get(token.mint) ?? 0n).toString(),
    releasedPct: base > 0n ? Number((released * 10_000n) / base) / 100 : null,
    transfers,
    partial: !reachedLaunch,
  };
}
