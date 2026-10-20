# Holders, Bundle, Bubble Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add holder analysis (holder count, top 20, launch-block buyers, clusters, fresh wallets, repeat snipers, insider %) with a bubble map to the existing token trace.

**Architecture:** A new `holders` step in `runTrace` (core) calls two new `ChainSource` methods (`getMintHolders`, `getBlockTokenChanges`) and reuses `resolveWallet` for holder funders. Results flow through the existing SSE/event/result pipeline; the web token page gets a Holders card with a d3-force bubble map.

**Tech Stack:** as sub-project 1, plus `d3-force` in the web app.

**Spec:** `docs/superpowers/specs/2026-10-21-holders-bundle-design.md`

**Execution note:** this plan is executed in the same session that wrote it, so each step names the exact files, interfaces, and test cases; the full code lands in the task's commit.

## Global Constraints

- Free public RPC only. `getTokenLargestAccounts` is not used (always 429 on public RPC).
- Holder analysis only when `token.complete === false`.
- Top 20 holders, cluster 1 hop. Busy funder = `high_activity` record or a full 1000-signature page; busy funders never join clusters.
- Launch-block buyers: slots `createSlot`, `+1`, `+2`; slot 0 = bundle, 1–2 = sniper; deployer, creator and the bonding-curve PDA are excluded.
- Fresh wallet: `firstSeenAt` within 86,400 s of now.
- Repeat sniper: early buyer (slot offset ≤ 2) in ≥ 3 other traced mints.
- Risk weights: bundleHeld +20 (≥10%), insiderSupply +20 (≥20%), holderCluster +15 (≥3 members, ≥10%), freshHolders +10 (≥5), repeatSniper +10 (≥1). Total capped at 100.
- Job timeout default 480,000 ms.
- UI copy in English.

---

### Task 1: Shared types

**Files:** Modify `packages/shared/src/index.ts`, `packages/shared/test/shared.test.ts`.

**Produces:** `HolderTag = "dev" | "insider" | "bundle" | "sniper" | "fresh" | "repeatSniper"`; `Holder { address; amount: string; pct: number; rank: number; tags: HolderTag[]; cluster: number | null; fundedBy: string | null; firstSeenAt: number | null }`; `HolderCluster { id: number; members: string[]; pct: number; linkedToDev: boolean; sharedFunder: string | null }`; `EarlyBuyer { wallet; slotOffset: number; bought: string; holding: string }`; `HolderAnalysis { available: boolean; reason: string | null; holderCount: number; totalSupply: string; top: Holder[]; clusters: HolderCluster[]; earlyBuyers: EarlyBuyer[] | null; bundlePct: number | null; insiderPct: number | null; top10Pct: number | null; freshCount: number; repeatSnipers: { wallet: string; count: number }[] }`; `TokenInfo.createSlot: number | null`; `StepName` adds `"holders"`; `TraceEvent` adds `{ type: "holders"; data: HolderAnalysis }`; `TraceResult.holders: HolderAnalysis | null`; `formatPct(n: number): string`.

- [ ] Test: `formatPct(12.345) === "12.3%"`, `formatPct(0.04) === "<0.1%"`, `formatPct(0) === "0%"`.
- [ ] Implement, run `pnpm --filter @pumpfun/shared test`, fix type fallout in other packages (`createSlot`, `holders`) so `pnpm typecheck` passes, commit.

### Task 2: Core plumbing (chain, store, wallet age, create slot, mint supply)

**Files:** Modify `packages/core/src/chain.ts`, `store.ts`, `trace/funders.ts`, `trace/resolveToken.ts`, `pump/metadata.ts` (mint supply), `testing/fakeChain.ts`, `testing/memoryStore.ts`, `testing/encode.ts`; tests in `test/funders.test.ts`, `test/resolveToken.test.ts`, `test/metadata.test.ts`.

**Produces:**
- `ChainSource.getMintHolders(mint: string, tokenProgram: string): Promise<{ owner: string; amount: string }[]>`
- `ChainSource.getBlockTokenChanges(slot: number): Promise<BlockTokenTx[]>`, `BlockTokenTx { signature: string; preTokenBalances: TokenBalance[]; postTokenBalances: TokenBalance[] }`
- `WalletRecord.firstSeenAt: number | null` (blockTime of oldest signature when history is complete, else null)
- `Store.findRepeatSnipers(wallets: string[], excludeMint: string): { wallet: string; count: number }[]`
- `decodeMintSupply(data: Uint8Array): bigint` (u64 at offset 36)
- `TokenInfo.createSlot` from the creation tx's `slot`
- FakeChain: `holders: Map<string, {owner, amount}[]>` keyed by mint, `blocks: Map<number, BlockTokenTx[]>`; MemoryStore: `repeatSnipers` list.

- [ ] Tests: resolveWallet stores `firstSeenAt` = oldest blockTime; high-activity wallet has `firstSeenAt` null; resolveToken returns `createSlot`; `decodeMintSupply` reads offset 36.
- [ ] Implement, run core tests + typecheck, commit.

### Task 3: Holder analysis

**Files:** Create `packages/core/src/trace/holders.ts`, `packages/core/test/holders.test.ts`; export from `src/index.ts`.

**Produces:** `analyzeHolders(input: { token: TokenInfo; nodes: ChainNode[]; devStatus: DevStatus | null }, chain: ChainSource, store: Store, cfg: TraceConfig, now: number): Promise<HolderAnalysis>`.

- [ ] Tests (FakeChain world: mint on Token-2022 with supply 1,000,000; curve PDA holds 500,000; holders A..):
  1. migrated token → `{ available: false, reason: "migrated" }`, no RPC holder call;
  2. aggregates multiple token accounts per owner, drops curve PDA and zero balances, counts holders, sorts, pct of supply, top10Pct;
  3. early buyers from blocks createSlot/+1/+2 with slot offsets, excludes deployer/creator/curve, `holding` from holder map, bundlePct from slot 0 only;
  4. `createSlot` null → `earlyBuyers` null, `bundlePct` null;
  5. cluster: two holders with same non-busy funder → one cluster with `sharedFunder`; busy funder (1000 sigs) → no cluster; holder funded by another holder → same cluster; holder funded by the deployer → `linkedToDev`;
  6. tags: dev, insider (dev transfer recipient), bundle, sniper, fresh (firstSeenAt within 24 h), repeatSniper (from store);
  7. insiderPct = deployer + insider + slot-0 buyers + dev-linked cluster members, no double counting.
- [ ] Implement, run tests, commit.

### Task 4: Score and orchestrator

**Files:** Modify `packages/core/src/score.ts`, `runTrace.ts`, `testing/scenario.ts` (holders + blocks for the scenario); tests `test/score.test.ts`, `test/runTrace.test.ts`.

**Produces:** `ScoreInput.holders: HolderAnalysis | null`; factors `bundleHeld`, `insiderSupply`, `holderCluster`, `freshHolders`, `repeatSniper` after the existing five; `runTrace` step `holders` after `devActivity`, emits `holders`, `TraceResult.holders`.

- [ ] Tests: each factor threshold and reason text; runTrace emits `holders` event and step, result carries holders; holder step failure → `incomplete`, holders null, score incomplete.
- [ ] Implement, run core suite + typecheck, commit.

### Task 5: RPC client methods

**Files:** Modify `packages/solana/src/rpcChainSource.ts`, `test/rpcChainSource.test.ts`.

- `getMintHolders`: `getProgramAccounts(tokenProgram, { encoding: "base64", dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: mint } }], commitment: "confirmed" })` → owner = base58 of bytes 0..32, amount = u64 LE at 32.
- `getBlockTokenChanges`: `getBlock(slot, { encoding: "jsonParsed", transactionDetails: "accounts", maxSupportedTransactionVersion: 1, rewards: false, commitment: "finalized" })` → per tx `{ signature: signatures[0], preTokenBalances, postTokenBalances }`; skip failed txs; null block → [].

- [ ] Tests for both mappings and params, implement, commit.

### Task 6: Database

**Files:** Modify `packages/db/src/schema.ts`, `sqliteStore.ts`, `test/sqliteStore.test.ts`; `apps/api/src/config.ts` + test (timeout 480000).

- Add `first_seen_at` to `wallets` (CREATE + `ALTER TABLE` when an existing DB lacks it), `early_buyers(mint, wallet, slot_offset, PRIMARY KEY (mint, wallet))`.
- `saveResult` writes early buyers (replace per mint); `findRepeatSnipers` counts distinct other mints with `slot_offset <= 2`, returns those with count ≥ 3.

- [ ] Tests: round-trip `firstSeenAt`; opening a DB created with the old schema adds the column; repeat snipers counted across ≥3 other mints and excluding current mint. Implement, commit.

### Task 7: Web Holders card + bubble map

**Files:** `apps/web/src/lib/traceState.ts` (+test), `components/StepProgress.tsx`, create `components/HoldersCard.tsx`, `components/BubbleMap.tsx`, modify `pages/TokenPage.tsx`, `e2e/fixtures.ts`, `e2e/token.spec.ts`; add `d3-force` + `@types/d3-force`.

- Reducer handles `holders`; `viewFromResult` marks `holders` done.
- BubbleMap: radius ∝ sqrt(pct), d3-force (charge, collide, center, link for cluster members), 300 ticks computed in `useMemo`, SVG with viewBox; colors per cluster from a fixed palette, dev/insider red outline; `<title>` tooltips; click → wallet page; `role="img"` with aria-label summary.
- HoldersCard: stats row, bubble map, top-20 table with tag badges, early buyers list, unavailable/unknown messages, skeleton while loading.
- e2e: fixture with holders; desktop test sees "Holders", the bubble map svg and a "bundle" tag.

- [ ] Implement, `pnpm --filter @pumpfun/web test`, typecheck, build, e2e, browser check, commit.

### Task 8: Live verification and docs

- [ ] Smoke trace an active bonding-curve token; record holders count, early buyers, clusters, timing in `docs/spikes/2026-10-21-holders-live.md`; fix anything found.
- [ ] Update README capacity note if timing changed; final `pnpm test`, `pnpm typecheck`, e2e; commit.
