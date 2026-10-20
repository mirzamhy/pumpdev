import type { FeedItem, FeedResponse, TraceResult } from "@pumpfun/shared";

export const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const DEV = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const FUNDER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const BUNDLER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SIB_A = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
const SIB_B = "EuBYDqZ8aH8N2ehpR5Q5KkSDhd5Us3MHmdd8rrwJyNdC";

export const sampleResult: TraceResult = {
  token: {
    mint: MINT,
    name: "Test Coin",
    symbol: "TEST",
    uri: null,
    tokenProgram: null,
    quoteMint: null,
    deployer: DEV,
    creatorCurrent: DEV,
    creatorOriginal: DEV,
    createdAt: 1_760_000_000,
    createSignature: "create",
    createSlot: 1,
    complete: false,
    isMayhemMode: false,
    devInitialBuy: "1000000000",
    createTxFound: true,
  },
  nodes: [
    { address: DEV, depth: 0, role: "deployer", chainRoot: DEV, fundedBy: FUNDER, fundingAmountLamports: "2000000000", fundedAt: 1_759_999_400, fundingSignature: "fund", terminal: null },
    { address: FUNDER, depth: 1, role: "funder", chainRoot: DEV, fundedBy: null, fundingAmountLamports: null, fundedAt: null, fundingSignature: null, terminal: "unknown_origin" },
  ],
  devHistory: [],
  devHistoryPartial: false,
  holders: {
    available: true,
    reason: null,
    holderCount: 214,
    totalSupply: "1000000000000000",
    top: [
      { address: BUNDLER, amount: "90000000000000", pct: 9, rank: 1, tags: ["bundle"], cluster: null, fundedBy: null, firstSeenAt: null },
      { address: SIB_A, amount: "60000000000000", pct: 6, rank: 2, tags: ["fresh"], cluster: 1, fundedBy: FUNDER, firstSeenAt: 1_759_990_000 },
      { address: SIB_B, amount: "50000000000000", pct: 5, rank: 3, tags: [], cluster: 1, fundedBy: FUNDER, firstSeenAt: null },
      { address: DEV, amount: "30000000000000", pct: 3, rank: 4, tags: ["dev"], cluster: null, fundedBy: FUNDER, firstSeenAt: null },
    ],
    clusters: [{ id: 1, members: [SIB_A, SIB_B], pct: 11, linkedToDev: false, sharedFunder: FUNDER }],
    earlyBuyers: [{ wallet: BUNDLER, slotOffset: 0, bought: "90000000000000", holding: "90000000000000" }],
    bundlePct: 9,
    insiderPct: 12,
    top10Pct: 23,
    freshCount: 1,
    repeatSnipers: [],
  },
  devStatus: {
    initialBuy: "1000000000",
    bought: "0",
    sold: "600000000",
    transferredOut: "100000000",
    balance: "300000000",
    releasedPct: 70,
    transfers: [{ to: FUNDER, amount: "100000000", signature: "move" }],
    partial: false,
  },
  crosslinks: [],
  score: {
    score: 50,
    level: "medium",
    factors: [
      { id: "devReleased", points: 25, reason: "Dev has sold or moved 70% of their tokens." },
      { id: "devTransferOut", points: 15, reason: "Dev moved 100 tokens to 1 other wallet." },
      { id: "freshFunding", points: 10, reason: "Dev wallet was funded 10 minutes before launch." },
    ],
    incomplete: false,
  },
  partial: false,
  finishedAt: 1_760_000_100,
};

const feedItem = (over: Partial<FeedItem>): FeedItem => ({
  mint: MINT,
  name: "Test Coin",
  symbol: "TEST",
  creator: DEV,
  createdAt: Math.floor(Date.now() / 1000) - 90,
  marketCapSol: 70.4,
  progressPct: 50,
  peakProgressPct: 50,
  realSol: 17.6,
  initialBuySol: 1,
  complete: false,
  migratedAt: null,
  isMayhemMode: false,
  copycatCount: 0,
  autoTraced: false,
  trace: { state: "none", score: null, level: null },
  ...over,
});

export const sampleFeed: FeedResponse = {
  items: [
    feedItem({ autoTraced: true, trace: { state: "done", score: 82, level: "high" } }),
    feedItem({ mint: FUNDER, name: "Queued Coin", symbol: "QUEUE", progressPct: 41, trace: { state: "queued", score: null, level: null } }),
    feedItem({ mint: BUNDLER, name: "Korean Coin", symbol: "KOREAN", copycatCount: 3, marketCapSol: 28, progressPct: 1, peakProgressPct: 60 }),
  ],
  stats: { seenLastHour: 1200, tracedLastHour: 12, highRiskShare: 0.5, connected: true },
};
