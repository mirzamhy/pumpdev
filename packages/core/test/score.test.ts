import { describe, expect, it } from "vitest";
import type { ChainNode, DevStatus, DevToken, TokenInfo } from "@pumpfun/shared";
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

const base: ScoreInput = { token, nodes: [], devHistory: [], devStatus: null, taintedFunders: [], incomplete: false };

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
      incomplete: true,
    });
    expect(s).toMatchObject({ score: 100, level: "high", incomplete: true });
    expect(s.factors.map((f) => f.id)).toEqual(["serialDeadDev", "devReleased", "devTransferOut", "freshFunding", "taintedFunder"]);
  });
});
