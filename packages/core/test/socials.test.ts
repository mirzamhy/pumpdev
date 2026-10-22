import { describe, expect, it } from "vitest";
import { ipfsCid, parseMetadata } from "../src/pump/socials";

const CID = "QmVm9xTnQkSHjXZr5KDJ5jnsV6p2PfQbFnNCY7LypNoDK1";

describe("parseMetadata twitter", () => {
  const tw = (twitter: unknown) => parseMetadata({ twitter }).twitter;

  it("recognises project accounts", () => {
    expect(tw("https://x.com/RuneLabFun")).toEqual({ url: "https://x.com/RuneLabFun", kind: "account", handle: "runelabfun", tweetId: null });
    expect(tw("https://www.twitter.com/Foo/")).toMatchObject({ kind: "account", handle: "foo" });
  });

  it("recognises links to a single tweet", () => {
    expect(tw("https://x.com/MagatardxSOL/status/2112621133799543295?s=20")).toEqual({
      url: "https://x.com/MagatardxSOL/status/2112621133799543295?s=20",
      kind: "tweet",
      handle: "magatardxsol",
      tweetId: "2112621133799543295",
    });
    expect(tw("https://mobile.twitter.com/a/status/1")).toMatchObject({ kind: "tweet", tweetId: "1" });
  });

  it("recognises communities and other links", () => {
    expect(tw("https://x.com/i/communities/1912345")).toMatchObject({ kind: "community", handle: null, tweetId: null });
    expect(tw("https://x.com/home")).toMatchObject({ kind: "other", handle: null });
    expect(tw("https://example.com/foo")).toMatchObject({ kind: "other", handle: null });
  });

  it("drops anything that is not an http(s) URL", () => {
    expect(tw("javascript:alert(1)")).toBeNull();
    expect(tw("@foo")).toBeNull();
    expect(tw("")).toBeNull();
    expect(tw(42)).toBeNull();
  });
});

describe("parseMetadata links and keys", () => {
  it("keys websites by host, or host and path on big platforms", () => {
    expect(parseMetadata({ website: "https://www.RuneLab.fun/x" })).toMatchObject({ website: "https://www.RuneLab.fun/x", websiteKey: "runelab.fun" });
    expect(parseMetadata({ website: "https://youtube.com/watch?v=1" }).websiteKey).toBe("youtube.com/watch");
    expect(parseMetadata({ website: "https://www.tiktok.com/@a/video/9/" }).websiteKey).toBe("tiktok.com/@a/video/9");
    expect(parseMetadata({ website: "ftp://x.com" })).toMatchObject({ website: null, websiteKey: null });
    expect(parseMetadata({ website: "https://otcdesks.cash/coin/5nt1L6KuVyawLuAvG7SLwoTTsKcc1ZaVN9nZz6Kopump" }).websiteKey).toBe(
      "otcdesks.cash/coin/5nt1L6KuVyawLuAvG7SLwoTTsKcc1ZaVN9nZz6Kopump",
    );
  });

  it("keeps telegram only as an http(s) URL", () => {
    expect(parseMetadata({ telegram: "https://t.me/abc" }).telegram).toBe("https://t.me/abc");
    expect(parseMetadata({ telegram: "t.me/abc" }).telegram).toBeNull();
  });

  it("keys images by IPFS CID when possible", () => {
    expect(parseMetadata({ image: `ipfs://${CID}` })).toMatchObject({ image: `ipfs://${CID}`, imageKey: `ipfs:${CID}` });
    expect(parseMetadata({ image: `https://ipfs.io/ipfs/${CID}/1.png` }).imageKey).toBe(`ipfs:${CID}`);
    expect(parseMetadata({ image: "https://cdn.example/i/abc.png?w=100" }).imageKey).toBe("https://cdn.example/i/abc.png");
    expect(parseMetadata({ image: "data:image/png;base64,AAA" })).toMatchObject({ image: null, imageKey: null });
  });

  it("trims descriptions", () => {
    expect(parseMetadata({ description: `  ${"a".repeat(400)} ` }).description).toHaveLength(280);
    expect(parseMetadata({ description: "   " }).description).toBeNull();
  });

  it("returns empty metadata for non-objects", () => {
    expect(parseMetadata(null)).toEqual({ twitter: null, telegram: null, website: null, websiteKey: null, image: null, imageKey: null, description: null });
    expect(parseMetadata("x")).toEqual(parseMetadata(null));
  });
});

describe("ipfsCid", () => {
  it("finds CIDs in ipfs:// and gateway URLs", () => {
    expect(ipfsCid(`ipfs://${CID}`)).toBe(CID);
    expect(ipfsCid(`https://gateway.pinata.cloud/ipfs/${CID}`)).toBe(CID);
    expect(ipfsCid(`https://foo.mypinata.cloud/ipfs/${CID}?x=1`)).toBe(CID);
    expect(ipfsCid("https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.dweb.link/")).toBe("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi");
    expect(ipfsCid("https://example.com/a.json")).toBeNull();
  });
});
