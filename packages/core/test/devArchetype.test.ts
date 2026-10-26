import { describe, expect, it } from "vitest";
import { classifyDev, type DevArchetypeInput } from "../src/index";

const none: DevArchetypeInput = { launches: 0, dead: 0, migrated: 0, dumped: 0, fastSells: 0, soldObserved: 0, launches24h: 0, siblings: 0, repeatBuyers: 0, recycled: 0 };
const kind = (i: Partial<DevArchetypeInput>) => classifyDev({ ...none, ...i }).kind;

describe("classifyDev", () => {
  it("is unclear without data", () => {
    expect(classifyDev(none)).toEqual({ kind: "unclear", evidence: [] });
    expect(kind({ launches: 1 })).toBe("unclear");
  });

  it("calls a dev whose launches die and who sells fast a rugger, with evidence", () => {
    const r = classifyDev({ ...none, launches: 6, dead: 4, fastSells: 3, soldObserved: 4 });
    expect(r.kind).toBe("rugger");
    expect(r.evidence).toEqual(["4 of 6 launches died with the dev exiting.", "Sold 3 of 4 earlier launches within 10 minutes."]);
  });

  it("calls a busy dev sharing funders and reusing socials a recycler", () => {
    expect(kind({ launches: 5, launches24h: 5, siblings: 3, recycled: 2 })).toBe("recycler");
  });

  it("calls a dev with migrations and no dead launches a runner", () => {
    const r = classifyDev({ ...none, launches: 3, migrated: 1, soldObserved: 2 });
    expect(r.kind).toBe("runner");
    expect(r.evidence).toEqual(["1 of 3 launches migrated.", "None of 3 launches died with the dev exiting.", "Held each launch longer than 10 minutes before selling."]);
  });

  it("breaks ties toward the riskier label", () => {
    // rugger 1 (dumped) vs recycler 1 (siblings)
    expect(kind({ launches: 4, dumped: 2, siblings: 2, dead: 1 })).toBe("rugger");
    // recycler 1 vs runner 1
    expect(kind({ launches: 1, migrated: 1, recycled: 1 })).toBe("recycler");
  });

  it("does not count dead launches as rugging when they are a minority", () => {
    expect(kind({ launches: 10, dead: 3, migrated: 4 })).toBe("runner");
  });
});
