import type { BundleAnalysis, ChainNode, DevStatus, EarlyBuyer, Holder, HolderAnalysis, HolderCluster, HolderTag, TokenInfo } from "@pumpfun/shared";
import { isAbortError } from "../abort";
import type { ChainSource } from "../chain";
import { mapLimit } from "../concurrency";
import type { TraceConfig } from "../config";
import { bondingCurvePda } from "../pda";
import { decodeMintSupply } from "../pump/metadata";
import type { Store, WalletRecord } from "../store";
import { balanceDeltas } from "../tx";
import { resolveWallet } from "./funders";

const TOP_N = 20;
const EARLY_SLOTS = 3; // creation slot and the next two
const FRESH_SEC = 86_400;
const RPC_CONCURRENCY = 3;
/** Funders are resolved for this many of the earliest buyers; each costs a few RPC calls on a cold cache. */
const EARLY_RESOLVE = 12;
const UNIFORM_TOLERANCE = 0.1;
/** Mayhem Mode credits pump.fun's agent with 1B extra tokens (6 decimals) inside the create transaction. */
const MAYHEM_AGENT_MINT = 1_000_000_000_000_000n;

export interface HolderInput {
  token: TokenInfo;
  nodes: ChainNode[];
  devStatus: DevStatus | null;
}

function unavailable(reason: string): HolderAnalysis {
  return {
    available: false,
    reason,
    holderCount: 0,
    totalSupply: "0",
    top: [],
    clusters: [],
    earlyBuyers: null,
    bundlePct: null,
    insiderPct: null,
    top10Pct: null,
    freshCount: 0,
    repeatSnipers: [],
    bundle: null,
  };
}

const byAmountDesc = (a: [string, bigint], b: [string, bigint]) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0);

export async function analyzeHolders(input: HolderInput, chain: ChainSource, store: Store, cfg: TraceConfig, now: number): Promise<HolderAnalysis> {
  const { token, nodes, devStatus } = input;
  // Listing holders of a migrated token can mean hundreds of thousands of accounts: too heavy for free RPC.
  if (token.complete) return unavailable("migrated");

  const mintAccount = await chain.getAccount(token.mint);
  if (!mintAccount) throw new Error("mint account not found");
  const supply = decodeMintSupply(mintAccount.data);
  if (supply === 0n) throw new Error("mint has zero supply");

  const curve = await bondingCurvePda(token.mint);
  const balances = new Map<string, bigint>();
  for (const account of await chain.getMintHolders(token.mint, mintAccount.owner)) {
    const amount = BigInt(account.amount);
    if (account.owner === curve || amount === 0n) continue;
    balances.set(account.owner, (balances.get(account.owner) ?? 0n) + amount);
  }
  const holding = (wallet: string) => balances.get(wallet) ?? 0n;

  const devWallets = new Set([token.deployer, token.creatorCurrent, token.creatorOriginal].filter((w): w is string => Boolean(w)));
  const insiders = new Set(devStatus?.transfers.map((t) => t.to) ?? []);

  const found =
    token.createSlot === null ? null : await findEarlyBuyers(chain, token.mint, token.createSlot, token.createSignature, token.isMayhemMode, curve, devWallets, holding);

  // Mayhem Mode mints an extra 1B for pump.fun's trading agent; it is the platform, not a holder or a bundler.
  let agentHeld = 0n;
  for (const agent of found?.agents ?? []) {
    agentHeld += holding(agent);
    balances.delete(agent);
  }
  const circulating = supply - agentHeld > 0n ? supply - agentHeld : supply;
  const pct = (amount: bigint) => Number((amount * 1_000_000n) / circulating) / 10_000;
  const ranked = [...balances].sort(byAmountDesc);
  const top = ranked.slice(0, TOP_N);
  const firstBuyers = found?.buyers ?? [];
  const bundleWallets = new Set(firstBuyers.filter((b) => b.slotOffset === 0).map((b) => b.wallet));
  const sniperWallets = new Set(firstBuyers.filter((b) => b.slotOffset > 0).map((b) => b.wallet));
  const repeatSnipers = firstBuyers.length ? store.findRepeatSnipers(firstBuyers.map((b) => b.wallet), token.mint) : [];
  const repeatSet = new Set(repeatSnipers.map((r) => r.wallet));

  const resolve = async (address: string): Promise<WalletRecord | null> => {
    try {
      return await resolveWallet(address, chain, store, cfg, now);
    } catch (err) {
      if (isAbortError(err)) throw err;
      return null; // one unresolved wallet should not sink the whole analysis
    }
  };
  const records = await mapLimit(top, RPC_CONCURRENCY, ([address]) => resolve(address));
  const funderOf = new Map(top.map(([address], i) => [address, records[i]?.funder ?? null]));

  // The earliest buyers get their funder and age too; holders already resolved come from the cache.
  const earlyRecords = await mapLimit(found?.buyers.slice(0, EARLY_RESOLVE) ?? [], RPC_CONCURRENCY, (b) => resolve(b.wallet));
  const earlyBuyers: EarlyBuyer[] | null =
    found?.buyers.map((b, i) => {
      if (i >= EARLY_RESOLVE) return b;
      const r = earlyRecords[i];
      const seen = r?.firstSeenAt ?? null;
      return { ...b, fundedBy: r?.funder ?? null, fresh: seen !== null && now - seen >= 0 && now - seen < FRESH_SEC };
    }) ?? null;
  const earlyFunders = (earlyBuyers ?? []).map((b) => b.fundedBy).filter((f): f is string => Boolean(f));
  const busy = await busyWallets(chain, store, cfg, [...new Set([...[...funderOf.values()].filter((f): f is string => f !== null), ...earlyFunders])]);

  const clusters = buildClusters(top, funderOf, busy, devWallets, nodes, insiders, pct);
  const clusterOf = new Map(clusters.flatMap((c) => c.members.map((m) => [m, c.id] as const)));

  const holders: Holder[] = top.map(([address, amount], i) => {
    const record = records[i];
    const firstSeenAt = record?.firstSeenAt ?? null;
    const tags: HolderTag[] = [];
    if (devWallets.has(address)) tags.push("dev");
    if (insiders.has(address)) tags.push("insider");
    if (bundleWallets.has(address)) tags.push("bundle");
    if (sniperWallets.has(address)) tags.push("sniper");
    if (firstSeenAt !== null && now - firstSeenAt >= 0 && now - firstSeenAt < FRESH_SEC) tags.push("fresh");
    if (repeatSet.has(address)) tags.push("repeatSniper");
    return { address, amount: amount.toString(), pct: pct(amount), rank: i + 1, tags, cluster: clusterOf.get(address) ?? null, fundedBy: record?.funder ?? null, firstSeenAt };
  });

  const devSide = new Set([...devWallets, ...insiders, ...nodes.filter((n) => n.terminal !== "high_activity").map((n) => n.address)]);
  const bundle = earlyBuyers && found ? analyzeBundle(earlyBuyers, found.multiBuyerTxs, devSide, busy, pct, holding) : null;

  const insiderSet = new Set([...devWallets, ...insiders, ...bundleWallets]);
  for (const c of clusters) {
    if (c.linkedToDev || c.members.some((m) => bundleWallets.has(m))) for (const m of c.members) insiderSet.add(m);
  }
  const sum = (wallets: Iterable<string>) => [...wallets].reduce((total, w) => total + holding(w), 0n);

  return {
    available: true,
    reason: null,
    holderCount: balances.size,
    totalSupply: supply.toString(),
    top: holders,
    clusters,
    earlyBuyers,
    bundlePct: earlyBuyers ? pct(sum(bundleWallets)) : null,
    insiderPct: pct(sum(insiderSet)),
    top10Pct: pct(ranked.slice(0, 10).reduce((total, [, amount]) => total + amount, 0n)),
    freshCount: holders.filter((h) => h.tags.includes("fresh")).length,
    repeatSnipers,
    bundle,
  };
}

function analyzeBundle(
  buyers: EarlyBuyer[],
  multiBuyerTxs: number,
  devSide: Set<string>,
  busy: Set<string>,
  pct: (amount: bigint) => number,
  holding: (wallet: string) => bigint,
): BundleAnalysis {
  const block = buyers.filter((b) => b.slotOffset === 0);
  const byFunder = new Map<string, string[]>();
  for (const b of buyers) {
    if (!b.fundedBy || busy.has(b.fundedBy)) continue;
    byFunder.set(b.fundedBy, [...(byFunder.get(b.fundedBy) ?? []), b.wallet]);
  }
  const amounts = block.map((b) => Number(BigInt(b.bought))).sort((a, b) => a - b);
  const median = amounts.length ? amounts[Math.floor(amounts.length / 2)]! : 0;
  return {
    wallets: block.length,
    boughtPct: pct(block.reduce((s, b) => s + BigInt(b.bought), 0n)),
    heldPct: pct(block.reduce((s, b) => s + holding(b.wallet), 0n)),
    sameTxAsCreate: buyers.filter((b) => b.sameTxAsCreate).length,
    multiBuyerTxs,
    fundedByDev: buyers.filter((b) => b.fundedBy && devSide.has(b.fundedBy)).length,
    sharedFunders: [...byFunder].filter(([, w]) => w.length >= 2).map(([funder, wallets]) => ({ funder, wallets })),
    fresh: buyers.filter((b) => b.fresh).length,
    uniformBuys: amounts.length >= 3 && median > 0 && amounts.every((a) => Math.abs(a - median) <= median * UNIFORM_TOLERANCE),
  };
}

async function findEarlyBuyers(
  chain: ChainSource,
  mint: string,
  createSlot: number,
  createSignature: string | null,
  mayhem: boolean,
  curve: string,
  devWallets: Set<string>,
  holding: (wallet: string) => bigint,
): Promise<{ buyers: EarlyBuyer[]; multiBuyerTxs: number; agents: string[] }> {
  const bought = new Map<string, { slotOffset: number; amount: bigint; signature: string; txBuyers: number }>();
  const agents = new Set<string>();
  let multiBuyerTxs = 0;
  for (let offset = 0; offset < EARLY_SLOTS; offset++) {
    for (const tx of await chain.getBlockTokenChanges(createSlot + offset)) {
      const deltas = [...balanceDeltas(tx.preTokenBalances, tx.postTokenBalances, mint)];
      if (mayhem && tx.signature === createSignature) {
        for (const [owner, delta] of deltas) if (delta === MAYHEM_AGENT_MINT) agents.add(owner);
      }
      const credited = deltas.filter(([owner, delta]) => delta > 0n && owner !== curve && !devWallets.has(owner) && !agents.has(owner));
      if (offset === 0 && credited.length >= 2) multiBuyerTxs++;
      for (const [owner, delta] of credited) {
        const prev = bought.get(owner);
        if (prev) prev.amount += delta;
        else bought.set(owner, { slotOffset: offset, amount: delta, signature: tx.signature, txBuyers: credited.length });
      }
    }
  }
  const buyers = [...bought]
    .map(([wallet, b]) => ({
      wallet,
      slotOffset: b.slotOffset,
      bought: b.amount.toString(),
      holding: holding(wallet).toString(),
      signature: b.signature,
      sameTxAsCreate: createSignature !== null && b.signature === createSignature,
      txBuyers: b.txBuyers,
    }))
    .sort((a, b) => a.slotOffset - b.slotOffset || (BigInt(b.bought) > BigInt(a.bought) ? 1 : -1));
  return { buyers, multiBuyerTxs, agents: [...agents] };
}

/** Exchanges and services fund everyone, so a full first page of signatures disqualifies a funder from linking holders. */
async function busyWallets(chain: ChainSource, store: Store, cfg: TraceConfig, wallets: string[]): Promise<Set<string>> {
  const flags = await mapLimit(wallets, RPC_CONCURRENCY, async (wallet) => {
    if (store.getWallet(wallet)?.terminal === "high_activity") return true;
    try {
      return (await chain.getSignatures(wallet, { limit: cfg.pageSize })).length >= cfg.pageSize;
    } catch (err) {
      if (isAbortError(err)) throw err;
      return true; // unknown: do not risk a false link
    }
  });
  return new Set(wallets.filter((_, i) => flags[i]));
}

function buildClusters(
  top: [string, bigint][],
  funderOf: Map<string, string | null>,
  busy: Set<string>,
  devWallets: Set<string>,
  nodes: ChainNode[],
  insiders: Set<string>,
  pct: (amount: bigint) => number,
): HolderCluster[] {
  const parent = new Map(top.map(([address]) => [address, address]));
  const find = (a: string): string => {
    const p = parent.get(a)!;
    if (p === a) return a;
    const root = find(p);
    parent.set(a, root);
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  const byFunder = new Map<string, string>();
  for (const [address] of top) {
    const funder = funderOf.get(address);
    if (!funder || busy.has(funder)) continue;
    if (parent.has(funder)) union(address, funder); // funded by another top holder
    const sibling = byFunder.get(funder);
    if (sibling) union(address, sibling);
    else byFunder.set(funder, address);
  }

  const devSet = new Set([...devWallets, ...insiders, ...nodes.filter((n) => n.terminal !== "high_activity").map((n) => n.address)]);
  const amounts = new Map(top);
  const groups = new Map<string, string[]>();
  for (const [address] of top) {
    const root = find(address);
    groups.set(root, [...(groups.get(root) ?? []), address]);
  }

  return [...groups.values()]
    .filter((members) => members.length >= 2)
    .map((members) => {
      const funders = new Set(members.map((m) => funderOf.get(m) ?? null));
      const total = members.reduce((s, m) => s + (amounts.get(m) ?? 0n), 0n);
      return {
        members,
        total,
        linkedToDev: members.some((m) => devSet.has(m) || devSet.has(funderOf.get(m) ?? "")),
        sharedFunder: funders.size === 1 ? [...funders][0]! : null,
      };
    })
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
    .map((c, i) => ({ id: i + 1, members: c.members, pct: pct(c.total), linkedToDev: c.linkedToDev, sharedFunder: c.sharedFunder }));
}
