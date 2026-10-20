import type { ChainNode, DevStatus, EarlyBuyer, Holder, HolderAnalysis, HolderCluster, HolderTag, TokenInfo } from "@pumpfun/shared";
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
  const pct = (amount: bigint) => Number((amount * 1_000_000n) / supply) / 10_000;

  const curve = await bondingCurvePda(token.mint);
  const balances = new Map<string, bigint>();
  for (const account of await chain.getMintHolders(token.mint, mintAccount.owner)) {
    const amount = BigInt(account.amount);
    if (account.owner === curve || amount === 0n) continue;
    balances.set(account.owner, (balances.get(account.owner) ?? 0n) + amount);
  }
  const ranked = [...balances].sort(byAmountDesc);
  const top = ranked.slice(0, TOP_N);
  const holding = (wallet: string) => balances.get(wallet) ?? 0n;

  const devWallets = new Set([token.deployer, token.creatorCurrent, token.creatorOriginal].filter((w): w is string => Boolean(w)));
  const insiders = new Set(devStatus?.transfers.map((t) => t.to) ?? []);

  const earlyBuyers = token.createSlot === null ? null : await findEarlyBuyers(chain, token.mint, token.createSlot, curve, devWallets, holding);
  const bundleWallets = new Set(earlyBuyers?.filter((b) => b.slotOffset === 0).map((b) => b.wallet) ?? []);
  const sniperWallets = new Set(earlyBuyers?.filter((b) => b.slotOffset > 0).map((b) => b.wallet) ?? []);
  const repeatSnipers = earlyBuyers?.length ? store.findRepeatSnipers(earlyBuyers.map((b) => b.wallet), token.mint) : [];
  const repeatSet = new Set(repeatSnipers.map((r) => r.wallet));

  const records = await mapLimit(top, RPC_CONCURRENCY, async ([address]): Promise<WalletRecord | null> => {
    try {
      return await resolveWallet(address, chain, store, cfg, now);
    } catch (err) {
      if (isAbortError(err)) throw err;
      return null; // one unresolved holder should not sink the whole analysis
    }
  });
  const funderOf = new Map(top.map(([address], i) => [address, records[i]?.funder ?? null]));
  const busy = await busyWallets(chain, store, cfg, [...new Set([...funderOf.values()].filter((f): f is string => f !== null))]);

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
  };
}

async function findEarlyBuyers(
  chain: ChainSource,
  mint: string,
  createSlot: number,
  curve: string,
  devWallets: Set<string>,
  holding: (wallet: string) => bigint,
): Promise<EarlyBuyer[]> {
  const bought = new Map<string, { slotOffset: number; amount: bigint }>();
  for (let offset = 0; offset < EARLY_SLOTS; offset++) {
    for (const tx of await chain.getBlockTokenChanges(createSlot + offset)) {
      for (const [owner, delta] of balanceDeltas(tx.preTokenBalances, tx.postTokenBalances, mint)) {
        if (delta <= 0n || owner === curve || devWallets.has(owner)) continue;
        const prev = bought.get(owner);
        if (prev) prev.amount += delta;
        else bought.set(owner, { slotOffset: offset, amount: delta });
      }
    }
  }
  return [...bought]
    .map(([wallet, b]) => ({ wallet, slotOffset: b.slotOffset, bought: b.amount.toString(), holding: holding(wallet).toString() }))
    .sort((a, b) => a.slotOffset - b.slotOffset || (BigInt(b.bought) > BigInt(a.bought) ? 1 : -1));
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
