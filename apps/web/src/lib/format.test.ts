import { describe, expect, it } from "vitest";
import type { ChainNode } from "@pumpfun/shared";
import { formatMcap, relTime, roleLabel, shortAge } from "./format";

describe("relTime", () => {
  it("formats past times relative to now", () => {
    expect(relTime(1000 - 30, 1000)).toBe("30 seconds ago");
    expect(relTime(10_000 - 7200, 10_000)).toBe("2 hours ago");
    expect(relTime(1_000_000 - 3 * 86_400, 1_000_000)).toBe("3 days ago");
  });
});

describe("roleLabel", () => {
  const n = (role: ChainNode["role"], depth: number) => ({ role, depth }) as ChainNode;
  it("names each role", () => {
    expect(roleLabel(n("deployer", 0))).toBe("Dev (deployer)");
    expect(roleLabel(n("creator", 0))).toBe("Current creator");
    expect(roleLabel(n("funder", 2))).toBe("Funder · hop 2");
  });
});

describe("shortAge", () => {
  it("picks the largest whole unit", () => {
    expect(shortAge(100, 145)).toBe("45s");
    expect(shortAge(0, 754)).toBe("12m");
    expect(shortAge(0, 3 * 3600 + 59)).toBe("3h");
    expect(shortAge(0, 2 * 86_400)).toBe("2d");
    expect(shortAge(200, 100)).toBe("0s");
  });
});

describe("formatMcap", () => {
  it("rounds large values and handles unknown", () => {
    expect(formatMcap(70.36)).toBe("70.4 SOL");
    expect(formatMcap(150.7)).toBe("151 SOL");
    expect(formatMcap(null)).toBe("–");
  });
});
