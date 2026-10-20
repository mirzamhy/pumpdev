import type { TraceResult } from "@pumpfun/shared";

export const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const DEV = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const FUNDER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

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
