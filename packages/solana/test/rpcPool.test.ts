import { describe, expect, it } from "vitest";
import { RpcError, RpcPool, parseEndpoints } from "../src/rpcPool";

type Handler = (url: string, body: { method: string; params: unknown[] }) => Response;

function harness(handler: Handler, endpoints = [{ url: "https://a", rps: 100, methodRps: 100 }], maxRetries = 4) {
  let now = 0;
  const calls: string[] = [];
  const pool = new RpcPool(endpoints, {
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    random: () => 0,
    maxRetries,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push(url);
      return handler(url, JSON.parse(String(init.body)));
    }) as typeof fetch,
  });
  return { pool, calls, elapsed: () => now };
}

const ok = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });

describe("RpcPool", () => {
  it("returns the JSON-RPC result", async () => {
    const { pool } = harness((_u, body) => ok({ echo: body.method }));
    await expect(pool.call("getSlot", [])).resolves.toEqual({ echo: "getSlot" });
  });

  it("retries HTTP 429 with backoff", async () => {
    let n = 0;
    const { pool, calls, elapsed } = harness(() => (n++ === 0 ? new Response("slow down", { status: 429 }) : ok(7)));
    await expect(pool.call("getSlot", [])).resolves.toBe(7);
    expect(calls).toHaveLength(2);
    expect(elapsed()).toBeGreaterThanOrEqual(500);
  });

  it("does not retry invalid-params errors", async () => {
    const { pool, calls } = harness(() => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid param" } }));
    await expect(pool.call("getSlot", [])).rejects.toMatchObject({ name: "RpcError", retryable: false, code: -32602 });
    expect(calls).toHaveLength(1);
  });

  it("gives up after maxRetries", async () => {
    const { pool, calls } = harness(() => new Response("down", { status: 503 }), undefined, 2);
    await expect(pool.call("getSlot", [])).rejects.toBeInstanceOf(RpcError);
    expect(calls).toHaveLength(3);
  });

  it("respects the per-method rate", async () => {
    const { pool, elapsed } = harness(() => ok(1), [{ url: "https://a", rps: 100, methodRps: 1 }]);
    await pool.call("getTransaction", []);
    await pool.call("getTransaction", []);
    await pool.call("getTransaction", []);
    expect(elapsed()).toBeGreaterThanOrEqual(2000);
  });

  it("cools down an endpoint that keeps returning 429 and uses the next one", async () => {
    const { pool, calls } = harness(
      (url) => (url === "https://a" ? new Response("no", { status: 429 }) : ok("b")),
      [
        { url: "https://a", rps: 100, methodRps: 100 },
        { url: "https://b", rps: 100, methodRps: 100 },
      ],
    );
    for (let i = 0; i < 3; i++) await expect(pool.call("getSlot", [])).resolves.toBe("b");
    expect(calls.filter((u) => u === "https://a")).toHaveLength(2);
  });
});

describe("parseEndpoints", () => {
  it("parses urls with optional per-endpoint limits", () => {
    expect(parseEndpoints(" https://a , https://b|10|4 ", 8, 3.5)).toEqual([
      { url: "https://a", rps: 8, methodRps: 3.5 },
      { url: "https://b", rps: 10, methodRps: 4 },
    ]);
  });
});
