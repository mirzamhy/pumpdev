import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MetadataSource } from "@pumpfun/core";
import { SqliteStore } from "@pumpfun/db";
import { MetadataFetcher, gatewayUrls, isPublicAddress } from "../src/feed/metadataFetcher";
import { MetadataQueue } from "../src/feed/metadataQueue";

const CID = "QmVm9xTnQkSHjXZr5KDJ5jnsV6p2PfQbFnNCY7LypNoDK1";

describe("gatewayUrls", () => {
  it("moves IPFS links to working gateways", () => {
    const expected = [`https://ipfs.filebase.io/ipfs/${CID}`, `https://4everland.io/ipfs/${CID}`];
    expect(gatewayUrls(`ipfs://${CID}`)).toEqual(expected);
    expect(gatewayUrls(`https://ipfs.io/ipfs/${CID}`)).toEqual(expected);
    expect(gatewayUrls(`https://foo.mypinata.cloud/ipfs/${CID}/meta.json`)).toEqual(expected.map((u) => `${u}/meta.json`));
  });
  it("keeps plain http(s) links and drops the rest", () => {
    expect(gatewayUrls("https://metadata.j7tracker.io/metadata/x.json")).toEqual(["https://metadata.j7tracker.io/metadata/x.json"]);
    expect(gatewayUrls("ar://abc")).toEqual([]);
    expect(gatewayUrls("file:///etc/passwd")).toEqual([]);
    expect(gatewayUrls("not a url")).toEqual([]);
  });
});

describe("isPublicAddress", () => {
  it("rejects private, loopback, link-local and special ranges", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.29", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it("accepts public addresses", () => {
    for (const ip of ["8.8.8.8", "104.18.0.1", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe("MetadataFetcher", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/ok") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: "Coin", twitter: "https://x.com/coin" }));
      if (url === "/redirect-ok") return res.writeHead(302, { location: "/ok" }).end();
      if (url === "/redirect-internal") return res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
      if (url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
      if (url === "/big") return res.writeHead(200).end(JSON.stringify({ pad: "x".repeat(70_000) }));
      if (url === "/html") return res.writeHead(200).end("<html>nope</html>");
      if (url === "/array") return res.writeHead(200).end("[1,2]");
      if (url === "/slow") return setTimeout(() => res.writeHead(200).end("{}"), 1000);
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  // Tests talk to 127.0.0.1, so loopback is allowed here and nowhere else.
  const testFetcher = (over: Partial<ConstructorParameters<typeof MetadataFetcher>[0]> = {}) =>
    new MetadataFetcher({ allowAddress: (ip) => ip === "127.0.0.1", allowAnyPort: true, timeoutMs: 300, ...over });

  it("returns the JSON object and follows a short redirect", async () => {
    expect(await testFetcher().fetch(`${base}/ok`)).toEqual({ name: "Coin", twitter: "https://x.com/coin" });
    expect(await testFetcher().fetch(`${base}/redirect-ok`)).toMatchObject({ name: "Coin" });
  });

  it("refuses private addresses, including by hostname and through redirects", async () => {
    const port = (server.address() as AddressInfo).port;
    expect(await new MetadataFetcher({ allowAnyPort: true }).fetch(`${base}/ok`)).toBeNull();
    expect(await new MetadataFetcher({ allowAnyPort: true }).fetch(`http://localhost:${port}/ok`)).toBeNull();
    expect(await testFetcher().fetch(`${base}/redirect-internal`)).toBeNull();
  });

  it("refuses non-default ports unless allowed", async () => {
    expect(await new MetadataFetcher({ allowAddress: () => true }).fetch(`${base}/ok`)).toBeNull();
  });

  it("gives up on redirect loops, big bodies, non-JSON, arrays and slow servers", async () => {
    const f = testFetcher();
    expect(await f.fetch(`${base}/loop`)).toBeNull();
    expect(await f.fetch(`${base}/big`)).toBeNull();
    expect(await f.fetch(`${base}/html`)).toBeNull();
    expect(await f.fetch(`${base}/array`)).toBeNull();
    expect(await f.fetch(`${base}/slow`)).toBeNull();
    expect(await f.fetch(`${base}/missing`)).toBeNull();
  });
});

describe("MetadataQueue", () => {
  let store: SqliteStore;
  let now: number;
  beforeEach(() => {
    store = new SqliteStore(":memory:");
    now = 1_800_000_000;
  });
  afterEach(() => store.close());

  function fakeSource(answers: Record<string, unknown | null>) {
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const src: MetadataSource = {
      fetch: async (uri) => {
        calls.push(uri);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return answers[uri] ?? null;
      },
    };
    return { src, calls, maxInFlight: () => maxInFlight };
  }

  it("stores parsed metadata with limited concurrency", async () => {
    const answers = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`u${i}`, { twitter: `https://x.com/c${i}` }]));
    const f = fakeSource(answers);
    const q = new MetadataQueue({ fetcher: f.src, store, now: () => now, concurrency: 2 });
    for (let i = 0; i < 6; i++) q.enqueue({ mint: `M${i}`, uri: `u${i}`, createdAt: now - i });
    await q.idle();
    expect(f.maxInFlight()).toBe(2);
    expect(store.getTokenMeta("M3")).toMatchObject({ ok: true, createdAt: now - 3, fetchedAt: now, twitter: { handle: "c3" } });
  });

  it("drops the oldest items when full", async () => {
    const f = fakeSource({});
    const q = new MetadataQueue({ fetcher: f.src, store, now: () => now, concurrency: 1, maxSize: 2 });
    q.enqueue({ mint: "A", uri: "a", createdAt: now });
    q.enqueue({ mint: "B", uri: "b", createdAt: now });
    q.enqueue({ mint: "C", uri: "c", createdAt: now });
    q.enqueue({ mint: "D", uri: "d", createdAt: now });
    await q.idle();
    expect(f.calls).toEqual(["a", "c", "d"]);
  });

  it("retries a failure once after a delay, then records it", async () => {
    const f = fakeSource({});
    const q = new MetadataQueue({ fetcher: f.src, store, now: () => now, retryAfterSec: 600 });
    q.enqueue({ mint: "A", uri: "a", createdAt: now });
    await q.idle();
    expect(store.getTokenMeta("A")).toBeNull();
    q.tick();
    await q.idle();
    expect(f.calls).toEqual(["a"]);
    now += 600;
    q.tick();
    await q.idle();
    expect(f.calls).toEqual(["a", "a"]);
    expect(store.getTokenMeta("A")).toMatchObject({ ok: false });
  });

  it("skips tokens whose metadata is already stored", async () => {
    const f = fakeSource({ a: {} });
    const q = new MetadataQueue({ fetcher: f.src, store, now: () => now });
    q.enqueue({ mint: "A", uri: "a", createdAt: now });
    await q.idle();
    q.enqueue({ mint: "A", uri: "a", createdAt: now });
    await q.idle();
    expect(f.calls).toEqual(["a"]);
  });
});
