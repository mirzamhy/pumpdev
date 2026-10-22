import { describe, expect, it } from "vitest";
import type { TokenInfo, TraceEvent } from "@pumpfun/shared";
import type { MetadataSource } from "../src/chain";
import { parseMetadata } from "../src/pump/socials";
import { runTrace } from "../src/runTrace";
import type { TokenMetaRecord } from "../src/store";
import { analyzeSocials } from "../src/trace/socials";
import { MemoryStore, createScenario } from "../src/testing";

const NOW = 1_800_000_000;
const CID = "QmVm9xTnQkSHjXZr5KDJ5jnsV6p2PfQbFnNCY7LypNoDK1";
const token = { mint: "MINT", uri: "https://meta.example/m.json", createdAt: NOW - 60 } as TokenInfo;
const json = { twitter: "https://x.com/RecycledDev", website: "https://rug.example", image: `ipfs://${CID}`, description: "hi" };

const meta = (mint: string, createdAt: number, raw: unknown, ok = true): TokenMetaRecord => ({ mint, createdAt, fetchedAt: createdAt, ok, ...parseMetadata(raw) });

function source(result: unknown | null) {
  const calls: string[] = [];
  const src: MetadataSource = {
    fetch: async (uri) => {
      calls.push(uri);
      return result;
    },
  };
  return { src, calls };
}

describe("analyzeSocials", () => {
  it("fetches, stores and reports socials with a gateway image", async () => {
    const store = new MemoryStore();
    const { src, calls } = source(json);
    const s = await analyzeSocials(token, store, src, NOW);
    expect(calls).toEqual([token.uri]);
    expect(s).toMatchObject({
      available: true,
      reason: null,
      twitter: { kind: "account", handle: "recycleddev" },
      website: "https://rug.example",
      image: `https://ipfs.filebase.io/ipfs/${CID}`,
      description: "hi",
      reuse: [],
      sameTweetCount: 0,
    });
    expect(store.getTokenMeta("MINT")).toMatchObject({ ok: true, createdAt: NOW - 60, websiteKey: "rug.example" });
  });

  it("uses stored metadata without fetching", async () => {
    const store = new MemoryStore();
    store.putTokenMeta(meta("MINT", NOW - 60, json));
    const { src, calls } = source(null);
    expect((await analyzeSocials(token, store, src, NOW)).available).toBe(true);
    expect(calls).toEqual([]);
  });

  it("flags socials reused from tokens at least an hour older", async () => {
    const store = new MemoryStore();
    store.putTokenMeta(meta("OLD", NOW - 7200, { twitter: "https://x.com/recycleddev", image: `https://ipfs.io/ipfs/${CID}` }));
    store.putTokenMeta(meta("WAVE", NOW - 120, { website: "https://rug.example" }));
    const s = await analyzeSocials(token, store, source(json).src, NOW);
    expect(s.reuse.map((r) => [r.kind, r.value, r.tokens.map((t) => t.mint)])).toEqual([
      ["twitter", "recycleddev", ["OLD"]],
      ["image", `ipfs:${CID}`, ["OLD"]],
    ]);
  });

  it("counts other tokens linking the same tweet", async () => {
    const store = new MemoryStore();
    const tweet = { twitter: "https://x.com/elon/status/123" };
    store.putTokenMeta(meta("A", NOW - 30, tweet));
    store.putTokenMeta(meta("B", NOW - 9000, tweet));
    const s = await analyzeSocials(token, store, source(tweet).src, NOW);
    expect(s).toMatchObject({ twitter: { kind: "tweet", handle: "elon", tweetId: "123" }, reuse: [], sameTweetCount: 2 });
  });

  it("reports tokens without a uri and failed fetches", async () => {
    const store = new MemoryStore();
    expect(await analyzeSocials({ ...token, uri: null }, store, source(json).src, NOW)).toMatchObject({ available: false, reason: "no_uri" });
    expect(await analyzeSocials(token, store, source(null).src, NOW)).toMatchObject({ available: false, reason: "fetch_failed" });
    expect(store.getTokenMeta("MINT")?.ok).toBe(false);
    // A failed record is retried by the next trace.
    expect((await analyzeSocials(token, store, source(json).src, NOW)).available).toBe(true);
  });
});

describe("runTrace with socials and dev profile", () => {
  it("emits both and stores them in the result", async () => {
    const s = await createScenario();
    const events: TraceEvent[] = [];
    const result = await runTrace(s.mint, {
      chain: s.chain,
      store: new MemoryStore(),
      metadata: source({ twitter: "https://x.com/testcoin" }).src,
      emit: (e) => events.push(e),
      now: () => s.now,
    });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["socials", "devProfile"]));
    expect(events.findIndex((e) => e.type === "socials")).toBeLessThan(events.findIndex((e) => e.type === "node"));
    expect(result.socials).toMatchObject({ available: true, twitter: { handle: "testcoin" } });
    expect(result.devProfile).toMatchObject({ launches: 0, feeClaims: 0 });
  });
});
