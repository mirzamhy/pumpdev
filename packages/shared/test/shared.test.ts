import { describe, expect, it } from "vitest";
import { FeedQuery, TraceRequest, formatPct, formatSol, formatTokenAmount, shortAddress } from "../src/index";

const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";

describe("TraceRequest", () => {
  it("accepts a base58 mint", () => {
    expect(TraceRequest.safeParse({ mint: MINT }).success).toBe(true);
  });
  it("trims surrounding whitespace", () => {
    const r = TraceRequest.safeParse({ mint: `  ${MINT}\n` });
    expect(r.success && r.data.mint).toBe(MINT);
  });
  it("rejects characters outside base58", () => {
    expect(TraceRequest.safeParse({ mint: "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl" }).success).toBe(false);
  });
  it("rejects short strings", () => {
    expect(TraceRequest.safeParse({ mint: "abc" }).success).toBe(false);
  });
});

describe("formatting", () => {
  it("formats raw 6-decimal token amounts compactly", () => {
    expect(formatTokenAmount("30000000000000")).toBe("30M");
    expect(formatTokenAmount(1_500_000n)).toBe("1.5");
    expect(formatTokenAmount("0")).toBe("0");
  });
  it("formats lamports as SOL", () => {
    expect(formatSol("1500000000")).toBe("1.5 SOL");
  });
  it("formats percentages", () => {
    expect(formatPct(12.345)).toBe("12.3%");
    expect(formatPct(0.04)).toBe("<0.1%");
    expect(formatPct(0)).toBe("0%");
  });
  it("shortens addresses", () => {
    expect(shortAddress(MINT)).toBe("9BB6…pump");
    expect(shortAddress("short")).toBe("short");
  });
});

describe("FeedQuery", () => {
  it("has defaults", () => {
    expect(FeedQuery.parse({})).toEqual({ tab: "new", hideHigh: false, limit: 100 });
  });
  it("reads query strings", () => {
    expect(FeedQuery.parse({ tab: "hot", hideHigh: "1", limit: "20" })).toEqual({ tab: "hot", hideHigh: true, limit: 20 });
  });
  it("rejects out-of-range limits and unknown tabs", () => {
    expect(FeedQuery.safeParse({ limit: "500" }).success).toBe(false);
    expect(FeedQuery.safeParse({ tab: "old" }).success).toBe(false);
  });
});
