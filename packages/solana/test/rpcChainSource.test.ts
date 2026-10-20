import { describe, expect, it } from "vitest";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@pumpfun/core";
import { RpcChainSource } from "../src/rpcChainSource";
import { RpcPool } from "../src/rpcPool";

function source(results: Record<string, (params: any[]) => unknown>) {
  const seen: { method: string; params: any[] }[] = [];
  const pool = new RpcPool([{ url: "https://rpc", rps: 1000, methodRps: 1000 }], {
    fetch: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push(body);
      return Response.json({ jsonrpc: "2.0", id: 1, result: results[body.method]!(body.params) });
    }) as typeof fetch,
  });
  return { chain: new RpcChainSource(pool), seen };
}

describe("RpcChainSource", () => {
  it("maps getSignaturesForAddress and forwards `before`", async () => {
    const { chain, seen } = source({
      getSignaturesForAddress: () => [{ signature: "s1", slot: 5, blockTime: 9, err: null, memo: null, confirmationStatus: "finalized" }],
    });
    expect(await chain.getSignatures("W", { before: "s0", limit: 10 })).toEqual([{ signature: "s1", slot: 5, blockTime: 9, err: null }]);
    expect(seen[0]!.params).toEqual(["W", { limit: 10, before: "s0", commitment: "finalized" }]);
  });

  it("requests jsonParsed transactions up to version 1", async () => {
    const { chain, seen } = source({ getTransaction: () => null });
    expect(await chain.getTransaction("sig")).toBeNull();
    expect(seen[0]!.params).toEqual(["sig", { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "finalized" }]);
  });

  it("decodes base64 account data", async () => {
    const { chain } = source({
      getAccountInfo: () => ({ context: { slot: 1 }, value: { data: [Buffer.from([1, 2, 3]).toString("base64"), "base64"], owner: "P", lamports: 1, executable: false } }),
      getMultipleAccounts: () => ({ context: { slot: 1 }, value: [null, { data: ["AQ==", "base64"], owner: "Q", lamports: 1, executable: false }] }),
    });
    expect(await chain.getAccount("X")).toEqual({ address: "X", owner: "P", data: new Uint8Array([1, 2, 3]) });
    expect(await chain.getAccounts(["Y", "Z"])).toEqual([null, { address: "Z", owner: "Q", data: new Uint8Array([1]) }]);
    expect(await chain.getAccounts([])).toEqual([]);
  });

  it("sums holdings across SPL Token and Token-2022 accounts", async () => {
    const row = (mint: string, amount: string) => ({ pubkey: "acc", account: { data: { parsed: { info: { mint, tokenAmount: { amount } } } } } });
    const { chain, seen } = source({
      getTokenAccountsByOwner: (params) =>
        params[1].programId === TOKEN_PROGRAM_ID
          ? { context: { slot: 1 }, value: [row("M1", "5"), row("M1", "7")] }
          : { context: { slot: 1 }, value: [row("M2", "1")] },
    });
    expect(await chain.getTokenHoldings("OWNER")).toEqual([
      { mint: "M1", amount: "12" },
      { mint: "M2", amount: "1" },
    ]);
    expect(seen.map((s) => s.params[1].programId)).toEqual([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);
  });
});
