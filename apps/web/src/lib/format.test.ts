import { describe, expect, it } from "vitest";
import type { ChainNode } from "@pumpfun/shared";
import { relTime, roleLabel } from "./format";

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
