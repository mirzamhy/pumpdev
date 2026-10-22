import { describe, expect, it } from "vitest";
import type { ChainNode, DevProfile, DevStatus, DevToken, HolderAnalysis, TokenInfo, TokenSocials } from "@pumpfun/shared";
import { computeScore, riskLevel, type ScoreInput } from "../src/score";

const token: TokenInfo = {
  mint: "MINT",
  name: null,
  symbol: null,
  uri: null,
  tokenProgram: null,
  quoteMint: null,
  deployer: "DEV",
  creatorCurrent: "DEV",
  creatorOriginal: "DEV",
  createdAt: 10_000,
  createSignature: "c",
  createSlot: 1,
  complete: false,
  isMayhemMode: false,
  devInitialBuy: "1000",
  createTxFound: true,
};

const base: ScoreInput = { token, nodes: [], devHistory: [], devStatus: null, taintedFunders: [], holders: null, incomplete: false };

const devToken = (status: DevToken["status"]): DevToken => ({
  mint: Math.random().toString(),
  name: null,
  symbol: null,
  createdAt: 1,
  complete: status === "migrated",
  devBalance: "0",
  initialBuy: "1",
  status,
});

const devStatus = (over: Partial<DevStatus>): DevStatus => ({
  initialBuy: "1000",
  bought: "0",
  sold: "0",
  transferredOut: "0",
  balance: "1000",
  releasedPct: 0,
  transfers: [],
  partial: false,
  ...over,
});

const deployerNode = (fundedAt: number): ChainNode => ({
  address: "DEV",
  depth: 0,
  role: "deployer",
  chainRoot: "DEV",
  fundedBy: "F",
  fundingAmountLamports: "1",
  fundedAt,
  fundingSignature: "s",
  terminal: null,
});

describe("riskLevel", () => {
  it("maps score bands", () => {
    expect([riskLevel(0), riskLevel(29), riskLevel(30), riskLevel(59), riskLevel(60)]).toEqual(["low", "low", "medium", "medium", "high"]);
  });
});

describe("computeScore", () => {
  it("is zero with no red flags", () => {
    expect(computeScore(base)).toEqual({ score: 0, level: "low", factors: [], incomplete: false });
  });

  it("flags a serial dev whose launches mostly died", () => {
    const s = computeScore({ ...base, devHistory: [devToken("dead_dev_exited"), devToken("dead_dev_exited"), devToken("alive"), devToken("migrated")] });
    expect(s.factors).toEqual([{ id: "serialDeadDev", points: 30, reason: "Dev launched 4 other tokens; 2 died with the dev exiting." }]);
    expect(s.level).toBe("medium");
  });

  it("needs at least 3 previous launches for the serial flag", () => {
    expect(computeScore({ ...base, devHistory: [devToken("dead_dev_exited"), devToken("dead_dev_exited")] }).factors).toEqual([]);
  });

  it("flags released supply and transfer-outs", () => {
    const s = computeScore({
      ...base,
      devStatus: devStatus({
        releasedPct: 70,
        transferredOut: "100000000",
        transfers: [
          { to: "W1", amount: "60000000", signature: "a" },
          { to: "W1", amount: "40000000", signature: "b" },
        ],
      }),
    });
    expect(s.factors.map((f) => f.reason)).toEqual([
      "Dev has sold or moved 70% of their tokens.",
      "Dev moved 100 tokens to 1 other wallet.",
    ]);
    expect(s.score).toBe(40);
  });

  it("flags a dev wallet funded less than an hour before launch", () => {
    const s = computeScore({ ...base, nodes: [deployerNode(10_000 - 720)] });
    expect(s.factors).toEqual([{ id: "freshFunding", points: 10, reason: "Dev wallet was funded 12 minutes before launch." }]);
  });

  it("ignores funding older than an hour", () => {
    expect(computeScore({ ...base, nodes: [deployerNode(10_000 - 4000)] }).factors).toEqual([]);
  });

  it("flags funders linked to dead tokens", () => {
    const s = computeScore({
      ...base,
      taintedFunders: [
        { wallet: "OtherWallet22222", deadCount: 1 },
        { wallet: "FunderWallet1111", deadCount: 3 },
      ],
    });
    expect(s.factors).toEqual([
      { id: "taintedFunder", points: 20, reason: "Funder Fund…1111 is linked to 3 dead tokens (+1 more flagged funder)." },
    ]);
  });

  it("caps at 100 and carries the incomplete flag", () => {
    const s = computeScore({
      token,
      nodes: [deployerNode(10_000 - 60)],
      devHistory: [devToken("dead_dev_exited"), devToken("dead_dev_exited"), devToken("dead_dev_exited")],
      devStatus: devStatus({ releasedPct: 100, transferredOut: "5", transfers: [{ to: "W", amount: "5", signature: "x" }] }),
      taintedFunders: [{ wallet: "F", deadCount: 1 }],
      holders: null,
      incomplete: true,
    });
    expect(s).toMatchObject({ score: 100, level: "high", incomplete: true });
    expect(s.factors.map((f) => f.id)).toEqual(["serialDeadDev", "devReleased", "devTransferOut", "freshFunding", "taintedFunder"]);
  });
});

const holders = (over: Partial<HolderAnalysis>): HolderAnalysis => ({
  available: true,
  reason: null,
  holderCount: 100,
  totalSupply: "1000000",
  top: [],
  clusters: [],
  earlyBuyers: [],
  bundlePct: 0,
  insiderPct: 0,
  top10Pct: 30,
  freshCount: 0,
  repeatSnipers: [],
  ...over,
});

describe("holder factors", () => {
  it("adds nothing for a clean holder base or an unavailable analysis", () => {
    expect(computeScore({ ...base, holders: holders({}) }).factors).toEqual([]);
    expect(computeScore({ ...base, holders: { ...holders({ bundlePct: 50 }), available: false } }).factors).toEqual([]);
  });

  it("flags bundle, insider share, clusters, fresh holders and repeat snipers", () => {
    const s = computeScore({
      ...base,
      holders: holders({
        bundlePct: 12.5,
        insiderPct: 31,
        clusters: [
          { id: 1, members: ["a", "b"], pct: 40, linkedToDev: false, sharedFunder: null },
          { id: 2, members: ["c", "d", "e"], pct: 14.2, linkedToDev: false, sharedFunder: "F" },
        ],
        freshCount: 6,
        repeatSnipers: [{ wallet: "s", count: 4 }],
      }),
    });
    expect(s.factors).toEqual([
      { id: "bundleHeld", points: 20, reason: "Wallets that bought in the launch block still hold 12.5% of supply." },
      { id: "insiderSupply", points: 20, reason: "Dev-linked and launch-block wallets hold 31.0% of supply." },
      { id: "holderCluster", points: 15, reason: "3 top holders that look like one owner hold 14.2% of supply." },
      { id: "freshHolders", points: 10, reason: "6 of the top 20 holders are wallets less than a day old." },
      { id: "repeatSniper", points: 10, reason: "1 launch-block buyer also bought early in 3+ other tokens we traced." },
    ]);
    expect(s.score).toBe(75);
  });

  it("stays below thresholds", () => {
    const s = computeScore({ ...base, holders: holders({ bundlePct: 9.9, insiderPct: 19.9, freshCount: 4, clusters: [{ id: 1, members: ["a", "b", "c"], pct: 9.9, linkedToDev: true, sharedFunder: null }] }) });
    expect(s.factors).toEqual([]);
  });
});

describe("socials and dev habit factors", () => {
  const socials = (reuse: TokenSocials["reuse"]): TokenSocials => ({
    available: true,
    reason: null,
    twitter: null,
    telegram: null,
    website: null,
    image: null,
    description: null,
    reuse,
    imageFromMint: null,
    sameTweetCount: 0,
  });
  const profile = (fastSells: number): DevProfile => ({
    launches: 5,
    dead: 0,
    migrated: 0,
    launchesPerDay: 1,
    soldObserved: 4,
    medianMinutesToSell: 8,
    fastSells,
    feeClaims: 0,
    feeClaimedSol: 0,
    partial: false,
  });

  it("flags recycled socials", () => {
    const s = computeScore({
      ...base,
      socials: socials([
        { kind: "twitter", value: "dev", tokens: [{ mint: "A", symbol: null, createdAt: 1 }] },
        { kind: "image", value: "ipfs:Qm", tokens: [{ mint: "A", symbol: null, createdAt: 1 }, { mint: "B", symbol: null, createdAt: 2 }] },
      ]),
    });
    expect(s.factors).toEqual([{ id: "recycledSocials", points: 15, reason: "Reuses the X account @dev, image of 2 older tokens." }]);
    expect(computeScore({ ...base, socials: socials([]) }).factors).toEqual([]);
    expect(computeScore({ ...base, socials: { ...socials([]), imageFromMint: "9qJfF6BWRsCdkdnZYNRfznJkFYgCGKoeHJ3fNAmPpump" } }).factors).toEqual([
      { id: "recycledSocials", points: 15, reason: "Its image was uploaded for another token (9qJf…pump)." },
    ]);
  });

  it("flags devs who repeatedly sell within 10 minutes", () => {
    expect(computeScore({ ...base, devProfile: profile(2) }).factors).toEqual([
      { id: "fastSeller", points: 15, reason: "Dev sold 2 of 4 earlier launches within 10 minutes of launching." },
    ]);
    expect(computeScore({ ...base, devProfile: profile(1) }).factors).toEqual([]);
  });
});
