import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseMetadata, type TokenMetaRecord } from "@pumpfun/core";
import type { DevProfile, DevToken, TraceResult } from "@pumpfun/shared";
import { SqliteStore, type FeedTokenInput } from "../src/index";

const NOW = 1_800_000_000;
const CID = "QmVm9xTnQkSHjXZr5KDJ5jnsV6p2PfQbFnNCY7LypNoDK1";
let store: SqliteStore;
beforeEach(() => {
  store = new SqliteStore(":memory:");
});
afterEach(() => store.close());

const meta = (mint: string, createdAt: number, raw: unknown, ok = true): TokenMetaRecord => ({ mint, createdAt, fetchedAt: createdAt, ok, ...parseMetadata(raw) });
const keysOf = (m: TokenMetaRecord) => ({
  twitterHandle: m.twitter?.kind === "account" ? m.twitter.handle : null,
  websiteKey: m.websiteKey,
  imageKey: m.imageKey,
  tweetId: m.twitter?.tweetId ?? null,
});

const feedToken = (mint: string, over: Partial<FeedTokenInput> = {}): FeedTokenInput => ({
  mint,
  name: null,
  symbol: `S${mint}`,
  uri: null,
  creator: `DEV-${mint}`,
  bondingCurve: `C-${mint}`,
  createSignature: null,
  createdAt: NOW - 60,
  initialBuySol: null,
  devBuyPct: null,
  isMayhemMode: false,
  marketCapSol: null,
  progressPct: 0,
  realSol: 0,
  ...over,
});

const devToken = (mint: string, status: DevToken["status"], createdAt = NOW - 5 * 86_400): DevToken => ({
  mint,
  name: null,
  symbol: mint,
  createdAt,
  complete: status === "migrated",
  devBalance: "0",
  initialBuy: "1",
  status,
});

const profile: DevProfile = {
  launches: 4,
  dead: 3,
  migrated: 0,
  launchesPerDay: 2,
  soldObserved: 3,
  medianMinutesToSell: 6,
  fastSells: 2,
  feeClaims: 1,
  feeClaimedSol: 0.1,
  partial: false,
};

function result(mint: string, deployer: string, over: Partial<TraceResult> = {}): TraceResult {
  return {
    token: {
      mint,
      name: null,
      symbol: `T${mint}`,
      uri: null,
      tokenProgram: null,
      quoteMint: null,
      deployer,
      creatorCurrent: null,
      creatorOriginal: null,
      createdAt: NOW - 1000,
      createSignature: null,
      createSlot: null,
      complete: false,
      isMayhemMode: false,
      devInitialBuy: null,
      createTxFound: true,
    },
    nodes: [{ address: deployer, depth: 0, role: "deployer", chainRoot: deployer, fundedBy: null, fundingAmountLamports: null, fundedAt: null, fundingSignature: null, terminal: null }],
    devHistory: [],
    devHistoryPartial: false,
    devStatus: null,
    holders: null,
    crosslinks: [],
    score: { score: 10, level: "low", factors: [], incomplete: false },
    partial: false,
    finishedAt: NOW - 500,
    ...over,
  };
}

describe("token metadata", () => {
  it("round-trips and upserts", () => {
    const m = meta("A", NOW, { twitter: "https://x.com/a/status/5", website: "https://a.example", image: `ipfs://${CID}`, telegram: "https://t.me/a", description: "d" });
    store.putTokenMeta({ ...m, ok: false });
    store.putTokenMeta(m);
    expect(store.getTokenMeta("A")).toEqual(m);
    expect(store.getTokenMeta("NONE")).toBeNull();
  });

  it("finds reuse only from tokens at least an hour older, accounts only for X", () => {
    store.insertFeedToken(feedToken("OLD", { symbol: "OLDY" }));
    store.putTokenMeta(meta("OLD", NOW - 7200, { twitter: "https://x.com/Dev", website: "https://www.rug.example/a", image: `https://ipfs.io/ipfs/${CID}` }));
    store.putTokenMeta(meta("WAVE", NOW - 100, { twitter: "https://x.com/dev", website: "https://rug.example" }));
    store.putTokenMeta(meta("TWEET", NOW - 9000, { twitter: "https://x.com/dev/status/1" }));
    store.putTokenMeta(meta("FAILED", NOW - 9000, { twitter: "https://x.com/dev" }, false));
    const me = meta("ME", NOW, { twitter: "https://x.com/dev", website: "https://rug.example", image: `ipfs://${CID}` });
    store.putTokenMeta(me);
    const { reuse, sameTweetCount } = store.findSocialReuse("ME", NOW, keysOf(me));
    expect(reuse).toEqual([
      { kind: "twitter", value: "dev", tokens: [{ mint: "OLD", symbol: "OLDY", createdAt: NOW - 7200 }] },
      { kind: "website", value: "rug.example", tokens: [{ mint: "OLD", symbol: "OLDY", createdAt: NOW - 7200 }] },
      { kind: "image", value: `ipfs:${CID}`, tokens: [{ mint: "OLD", symbol: "OLDY", createdAt: NOW - 7200 }] },
    ]);
    expect(sameTweetCount).toBe(0);
  });

  it("counts tokens sharing a tweet and caps examples at five", () => {
    for (let i = 0; i < 7; i++) store.putTokenMeta(meta(`T${i}`, NOW - 4000 - i, { twitter: "https://x.com/elon/status/9", website: "https://same.example" }));
    const me = meta("ME", NOW, { twitter: "https://x.com/elon/status/9", website: "https://same.example" });
    const { reuse, sameTweetCount } = store.findSocialReuse("ME", NOW, keysOf(me));
    expect(sameTweetCount).toBe(7);
    expect(reuse).toHaveLength(1);
    expect(reuse[0]!.tokens).toHaveLength(5);
  });

  it("ignores keys shared by so many tokens that they belong to a platform", () => {
    for (let i = 0; i < 21; i++) store.putTokenMeta(meta(`P${i}`, NOW - 7200, { website: "https://launchpad.example", image: `ipfs://${CID}` }));
    store.putTokenMeta(meta("FEW", NOW - 7200, { twitter: "https://x.com/dev" }));
    const me = meta("ME", NOW, { website: "https://launchpad.example", image: `ipfs://${CID}`, twitter: "https://x.com/dev" });
    store.putTokenMeta(me);
    expect(store.findSocialReuse("ME", NOW, keysOf(me)).reuse.map((r) => r.kind)).toEqual(["twitter"]);
  });

  it("prunes old metadata but keeps traced tokens", () => {
    store.putTokenMeta(meta("OLD", NOW - 20 * 86_400, {}));
    store.putTokenMeta(meta("TRACED", NOW - 20 * 86_400, {}));
    store.putTokenMeta(meta("NEW", NOW, {}));
    store.saveResult(result("TRACED", "D"));
    expect(store.pruneTokenMeta(NOW - 14 * 86_400)).toBe(1);
    expect([store.getTokenMeta("OLD"), store.getTokenMeta("TRACED")?.mint, store.getTokenMeta("NEW")?.mint]).toEqual([null, "TRACED", "NEW"]);
  });

  it("marks feed tokens with recycled socials", () => {
    store.insertFeedToken(feedToken("ME"));
    store.insertFeedToken(feedToken("CLEAN"));
    store.putTokenMeta(meta("OLD", NOW - 7200, { website: "https://rug.example" }));
    store.putTokenMeta(meta("ME", NOW - 60, { website: "https://rug.example" }));
    store.putTokenMeta(meta("CLEAN", NOW - 60, { website: "https://fresh.example" }));
    store.insertFeedToken(feedToken("COMMON"));
    for (let i = 0; i < 21; i++) store.putTokenMeta(meta(`P${i}`, NOW - 7200, { image: `ipfs://${CID}` }));
    store.putTokenMeta(meta("COMMON", NOW - 60, { image: `ipfs://${CID}` }));
    const rows = store.feed({ tab: "new", hideHigh: false, limit: 10, now: NOW });
    expect(Object.fromEntries(rows.map((r) => [r.mint, r.recycledSocials]))).toEqual({ ME: true, CLEAN: false, COMMON: false });
  });
});

describe("wallet profile", () => {
  it("shows the newest stored dev profile for a deployer", () => {
    store.saveResult(result("M1", "DEVA", { devProfile: { ...profile, launches: 1 }, finishedAt: NOW - 900 }));
    store.saveResult(result("M2", "DEVA", { devProfile: profile, finishedAt: NOW - 100 }));
    expect(store.walletView("DEVA").profile).toEqual(profile);
    store.saveResult(result("M3", "DEVB"));
    expect(store.walletView("DEVB").profile).toBeNull();
    expect(store.walletView("NOBODY").profile).toBeNull();
  });
});

describe("risky wallets", () => {
  it("ranks serial devs, funders, early buyers and busy launchers", () => {
    const dead = ["D1", "D2", "D3"].map((m) => devToken(m, "dead_dev_exited"));
    store.saveResult(
      result("M1", "SERIAL", {
        devHistory: [...dead, devToken("A1", "alive")],
        nodes: [
          { address: "SERIAL", depth: 0, role: "deployer", chainRoot: "SERIAL", fundedBy: "FUNDER", fundingAmountLamports: null, fundedAt: null, fundingSignature: null, terminal: null },
          { address: "FUNDER", depth: 1, role: "funder", chainRoot: "SERIAL", fundedBy: null, fundingAmountLamports: null, fundedAt: null, fundingSignature: null, terminal: null },
        ],
      }),
    );
    store.saveResult(result("M2", "ONCE", { devHistory: [devToken("E1", "dead_dev_exited")] }));
    const early = (mint: string, wallets: string[]) =>
      store.saveResult(result(mint, `DEV-${mint}`, { holders: { earlyBuyers: wallets.map((wallet) => ({ wallet, slotOffset: 0, bought: "1", holding: "1" })) } as TraceResult["holders"] }));
    early("S1", ["SNIPER", "X"]);
    early("S2", ["SNIPER"]);
    early("S3", ["SNIPER", "X"]);
    for (let i = 0; i < 4; i++) store.insertFeedToken(feedToken(`L${i}`, { creator: "LAUNCHER", createdAt: NOW - 100 * i }));
    store.insertFeedToken(feedToken("OLDL", { creator: "LAUNCHER", createdAt: NOW - 90_000 }));
    store.insertFeedToken(feedToken("SOLO", { creator: "SOLO" }));

    const r = store.riskyWallets(NOW);
    expect(r.serialDevs).toEqual([{ wallet: "SERIAL", dead: 3, total: 4, lastAt: NOW - 5 * 86_400 }]);
    expect(r.funders).toEqual([{ wallet: "FUNDER", deadLaunches: 3, devs: 1 }]);
    expect(r.snipers).toEqual([{ wallet: "SNIPER", launches: 3 }]);
    expect(r.launchers).toEqual([{ wallet: "LAUNCHER", launches: 4, lastAt: NOW }]);
    expect(r.generatedAt).toBe(NOW);
  });
});

describe("quick score", () => {
  const quickOf = (mint: string) => store.feed({ tab: "new", hideHigh: false, limit: 50, now: NOW }).find((r) => r.mint === mint)!.quick;
  const node = (address: string, depth: number, role: "deployer" | "funder", fundedBy: string | null) => ({
    address, depth, role, chainRoot: "X", fundedBy, fundingAmountLamports: null, fundedAt: null, fundingSignature: null, terminal: null,
  });

  it("knows nothing bad about a fresh dev", () => {
    store.insertFeedToken(feedToken("NEW", { devBuyPct: 3 }));
    expect(quickOf("NEW")).toEqual({ score: 0, level: "low", factors: [] });
  });

  it("counts the dev's other launches today and which of them dumped", () => {
    store.insertFeedToken(feedToken("A", { creator: "FARM", createdAt: NOW - 3000 }));
    store.insertFeedToken(feedToken("B", { creator: "FARM", createdAt: NOW - 2000 }));
    store.insertFeedToken(feedToken("C", { creator: "FARM", createdAt: NOW - 100 }));
    store.insertFeedToken(feedToken("OLD", { creator: "FARM", createdAt: NOW - 90_000 }));
    expect(quickOf("C").factors.map((f) => f.id)).toEqual(["serialLauncher"]);
    store.updateFeedCurves([{ mint: "A", marketCapSol: 30, progressPct: 50, realSol: 20, complete: false }], NOW);
    store.updateFeedCurves([{ mint: "A", marketCapSol: 28, progressPct: 3, realSol: 1, complete: false }], NOW);
    expect(quickOf("C").factors).toEqual([expect.objectContaining({ id: "dumpingLauncher", reason: "Another launch by this dev in the last 24 hours already dumped." })]);
    // A's own dump is its curve, not "another launch".
    expect(quickOf("A").factors.map((f) => f.id)).toEqual(["serialLauncher", "dumped"]);
  });

  it("uses dead launches, the cached funder and the dev profile from earlier traces", () => {
    store.saveResult(result("PAST", "SERIAL", { devHistory: ["D1", "D2"].map((m) => devToken(m, "dead_dev_exited")), devProfile: profile }));
    store.saveResult(
      result("PAST2", "OTHERDEV", { devHistory: [devToken("D3", "dead_dev_exited")], nodes: [node("OTHERDEV", 0, "deployer", "BOSS"), node("BOSS", 1, "funder", null)] }),
    );
    store.putWallet({ address: "SERIAL", funderResolved: true, funder: "BOSS", fundingSignature: null, fundingAmountLamports: null, fundedAt: null, terminal: null, firstSeenAt: null, fetchedAt: NOW });
    store.insertFeedToken(feedToken("NOW1", { creator: "SERIAL", devBuyPct: 15 }));
    const q = quickOf("NOW1");
    expect(q.factors.map((f) => f.id)).toEqual(["knownDeadDev", "taintedFunder", "fastSeller", "bigDevBuy"]);
    expect(q.level).toBe("high");
  });

  it("hides untraced tokens whose quick score is high when asked", () => {
    store.saveResult(result("PAST", "SERIAL", { devHistory: ["D1", "D2"].map((m) => devToken(m, "dead_dev_exited")), devProfile: profile }));
    store.insertFeedToken(feedToken("BAD", { creator: "SERIAL", devBuyPct: 20 }));
    store.insertFeedToken(feedToken("OK"));
    store.updateFeedCurves([{ mint: "BAD", marketCapSol: 30, progressPct: 60, realSol: 20, complete: false }], NOW);
    store.updateFeedCurves([{ mint: "BAD", marketCapSol: 28, progressPct: 1, realSol: 1, complete: false }], NOW);
    expect(store.feed({ tab: "new", hideHigh: false, limit: 10, now: NOW }).map((r) => r.mint).sort()).toEqual(["BAD", "OK"]);
    expect(store.feed({ tab: "new", hideHigh: true, limit: 10, now: NOW }).map((r) => r.mint)).toEqual(["OK"]);
  });

  it("serves one feed token for the token page", () => {
    store.insertFeedToken(feedToken("ONE", { devBuyPct: 11 }));
    expect(store.feedItem("ONE", NOW)?.quick.factors.map((f) => f.id)).toEqual(["bigDevBuy"]);
    expect(store.feedItem("MISSING", NOW)).toBeNull();
  });
});
