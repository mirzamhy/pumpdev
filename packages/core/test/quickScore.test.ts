import { describe, expect, it } from "vitest";
import { computeQuickScore, QUICK_WEIGHTS, type QuickInput } from "../src/index";

const clean: QuickInput = {
  copycatCount: 0,
  recycledSocials: false,
  dumped: false,
  peakProgressPct: 5,
  progressPct: 5,
  devBuyPct: 2,
  creatorDeadLaunches: 0,
  creatorLaunches24h: 0,
  creatorDumped24h: 0,
  taintedFunder: null,
  fastSells: 0,
  soldObserved: 0,
};

const ids = (input: Partial<QuickInput>) => computeQuickScore({ ...clean, ...input }).factors.map((f) => f.id);

describe("computeQuickScore", () => {
  it("is zero and low for a token with no known red flag", () => {
    expect(computeQuickScore(clean)).toEqual({ score: 0, level: "low", factors: [] });
  });

  it("flags a dev whose other launches today already dumped, instead of just counting them", () => {
    expect(ids({ creatorLaunches24h: 3, creatorDumped24h: 1 })).toEqual(["dumpingLauncher"]);
    expect(ids({ creatorLaunches24h: 2 })).toEqual(["serialLauncher"]);
    expect(ids({ creatorLaunches24h: 1 })).toEqual([]);
    const one = computeQuickScore({ ...clean, creatorLaunches24h: 1, creatorDumped24h: 1 }).factors[0]!.reason;
    expect(one).toBe("Another launch by this dev in the last 24 hours already dumped.");
    const two = computeQuickScore({ ...clean, creatorLaunches24h: 2, creatorDumped24h: 2 }).factors[0]!.reason;
    expect(two).toBe("2 other launches by this dev in the last 24 hours already dumped.");
  });

  it("uses what traces already learned about the dev and their funder", () => {
    expect(ids({ creatorDeadLaunches: 2, taintedFunder: { wallet: "FUNDERxxxxxxxxxxxx", deadCount: 4 }, fastSells: 2, soldObserved: 3 })).toEqual([
      "knownDeadDev",
      "taintedFunder",
      "fastSeller",
    ]);
    expect(ids({ creatorDeadLaunches: 1, fastSells: 1 })).toEqual([]);
  });

  it("flags the curve, socials, a big dev buy and heavy ticker reuse", () => {
    const r = computeQuickScore({ ...clean, dumped: true, peakProgressPct: 60, progressPct: 4, recycledSocials: true, devBuyPct: 12.5, copycatCount: 3 });
    expect(r.factors.map((f) => f.id)).toEqual(["dumped", "recycledSocials", "bigDevBuy", "copycat"]);
    expect(r.factors[0]!.reason).toBe("Curve fell from 60% to 4%: holders sold into it.");
    expect(r.factors[2]!.reason).toContain("12.5% of supply");
    expect(r.score).toBe(QUICK_WEIGHTS.dumped + QUICK_WEIGHTS.recycledSocials + QUICK_WEIGHTS.bigDevBuy + QUICK_WEIGHTS.copycat);
    expect(r.level).toBe("medium");
    expect(ids({ devBuyPct: 9.9, copycatCount: 2 })).toEqual([]);
    expect(ids({ devBuyPct: null })).toEqual([]);
  });

  it("caps at 100", () => {
    const r = computeQuickScore({
      ...clean,
      creatorDeadLaunches: 5,
      creatorLaunches24h: 4,
      creatorDumped24h: 3,
      taintedFunder: { wallet: "F", deadCount: 2 },
      fastSells: 3,
      dumped: true,
    });
    expect(r).toMatchObject({ score: 100, level: "high" });
  });
});
