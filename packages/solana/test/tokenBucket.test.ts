import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/tokenBucket";

describe("TokenBucket", () => {
  it("allows a burst up to capacity, then reports the wait", () => {
    let t = 0;
    const b = new TokenBucket(2, 2, () => t);
    expect(b.waitMs()).toBe(0);
    b.take();
    b.take();
    expect(b.waitMs()).toBe(500);
    t = 500;
    expect(b.waitMs()).toBe(0);
  });
});
