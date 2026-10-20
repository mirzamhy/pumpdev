# pumpfun.dev Trace Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build sub-project 1 of pumpfun.dev: paste a pump.fun token address, get the dev wallet's funding chain (first SOL transfer, up to 5 hops), the dev's other launches, the dev's sell/transfer activity, cross-links to other traced tokens, and a 0–100 risk score, streamed live to a web UI.

**Architecture:** pnpm TypeScript monorepo. `packages/core` holds all trace logic as pure code behind two interfaces (`ChainSource` for chain data, `Store` for cache). `packages/solana` implements `ChainSource` over free Solana JSON-RPC with a rate-limited endpoint pool. `packages/db` implements `Store` (plus job/result storage) over SQLite. `apps/api` (Fastify) runs trace jobs in an in-process queue and streams events over SSE. `apps/web` (React SPA) renders the result. Caddy serves the SPA and proxies `/api` on one VPS.

**Tech Stack:** Node 24 LTS, pnpm, TypeScript, Vitest, `@solana/kit` (addresses, PDA, base58), Fastify 5 + `@fastify/rate-limit`, better-sqlite3, Zod, React 19, Vite, Tailwind CSS v4, TanStack Router + Query, React Flow (`@xyflow/react`), Motion, Playwright, Docker Compose, Caddy.

**Spec:** `docs/superpowers/specs/2026-10-20-trace-engine-design.md`

## Global Constraints

- Chain data comes only from free Solana JSON-RPC. Default endpoint `https://api.mainnet.solana.com`. No paid APIs.
- Public RPC limits: 100 req / 10 s per IP total, 40 req / 10 s per method. Defaults: 8 req/s global, 3.5 req/s per method, per endpoint.
- pump.fun program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`. PumpSwap program `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`. Bonding curve PDA seeds `["bonding-curve", mint]`. `BondingCurve.creator` at byte offset 49.
- Support both `create` and `create_v2`. Parse pump.fun **events** (`CreateEvent`, `TradeEvent`), never instruction names.
- Deployer = `CreateEvent.user` (signer). `BondingCurve.creator` can change later and is shown separately.
- Trace rule: one funder per wallet = sender of the first System Program SOL transfer. Max 5 hops. Wallet with > 5 pages (5,000) of signatures = `high_activity`, stop.
- Token amounts are raw integers as decimal strings (pump.fun tokens use 6 decimals). Lamports as decimal strings. Times are unix seconds.
- UI copy in English. Always show the disclaimer "Heuristic on-chain analysis. Not financial advice."
- Risk weights: serial dead-token dev +30, dev released ≥50% +25, dev transfer-out +15, deployer funded <1 h before create +10, tainted funder +20. Levels: 0–29 low, 30–59 medium, 60+ high.
- Workspace packages export TypeScript source directly (`"exports": "./src/index.ts"`). No build step for packages; the API runs with `tsx`.

## Changes from the spec (decided while planning)

These simplify the build without changing what the user sees. Task 16 records them in the spec.

1. **RPC transport is our own `fetch` pool**, not `@solana/kit`'s RPC client, so rate limiting, rotation, and retries live in one small class. `@solana/kit` is still used for address validation, PDA derivation, and base58.
2. **No Drizzle.** The schema is nine small tables; raw `better-sqlite3` prepared statements are shorter and have fewer moving parts.
3. **No shadcn CLI.** A handful of small hand-written Tailwind components in the same style.
4. **Creation tx is found from the mint's oldest signature** (up to 20 pages). The "creator wallet fast path" is dropped: scanning the creator's history would cost one `getTransaction` per signature.
5. **Dev history comes from the dev's 60 most recent transactions** (shared with the dev-status scan via the tx cache). The `getProgramAccounts` fast path is dropped: `BondingCurve` does not store its mint, so each hit would need extra lookups, and public RPC tends to reject the query anyway.
6. **The pump.fun event decoder lives in `packages/core`** (pure code), not `packages/solana`.
7. **SSE has no separate `edge` event.** Each `node` carries `fundedBy`. A `step` event drives the progress UI.
8. **The wallet page shows cached data only.** Wallets that were never part of a trace say so.

## File Structure

```
pumpfun.dev/
  package.json                     root scripts
  pnpm-workspace.yaml
  tsconfig.base.json
  .gitignore
  .env.example
  Dockerfile                       base (install+build) → api, web (caddy) targets
  docker-compose.yml
  deploy/Caddyfile
  README.md
  docs/spikes/2026-10-20-live-rpc.md   live smoke-test notes (Task 12)

  packages/shared/                 types + Zod + formatting shared by web and api
    src/index.ts
    test/shared.test.ts

  packages/core/                   pure trace logic
    src/index.ts
    src/chain.ts                   ChainSource interface + RPC data shapes
    src/store.ts                   Store interface
    src/config.ts                  TraceConfig + defaults
    src/abort.ts                   isAbortError
    src/pda.ts                     bondingCurvePda
    src/signatures.ts              collectSignatures (pagination)
    src/cachedChain.ts             withTxCache
    src/tx.ts                      helpers over parsed transactions
    src/pump/constants.ts          program ids
    src/pump/borsh.ts              Reader
    src/pump/bondingCurve.ts       decodeBondingCurve
    src/pump/events.ts             CreateEvent / TradeEvent decoder
    src/trace/resolveToken.ts      find create tx, deployer, initial buy
    src/trace/funders.ts           resolveWallet, traceChain
    src/trace/devActivity.ts       dev history + dev status
    src/score.ts                   computeScore
    src/runTrace.ts                orchestrator
    src/testing/                   test helpers exported as @pumpfun/core/testing
      index.ts encode.ts tx.ts fakeChain.ts memoryStore.ts scenario.ts
    test/*.test.ts

  packages/solana/                 ChainSource over JSON-RPC
    src/index.ts tokenBucket.ts rpcPool.ts rpcChainSource.ts
    test/*.test.ts

  packages/db/                     SQLite Store + jobs/results
    src/index.ts schema.ts sqliteStore.ts
    test/sqliteStore.test.ts

  apps/api/
    src/config.ts jobs.ts app.ts server.ts
    scripts/smoke.ts
    test/config.test.ts test/app.test.ts

  apps/web/
    index.html vite.config.ts playwright.config.ts
    src/main.tsx router.tsx index.css
    src/lib/format.ts risk.ts api.ts traceState.ts useTrace.ts useMediaQuery.ts
    src/lib/*.test.ts
    src/components/ui.tsx SearchBox.tsx Layout.tsx TokenHeader.tsx RiskCard.tsx
      StepProgress.tsx FunderGraph.tsx FunderTimeline.tsx NodeDetail.tsx
      DevStatusCard.tsx DevHistoryTable.tsx CrosslinksList.tsx
    src/pages/HomePage.tsx TokenPage.tsx WalletPage.tsx
    e2e/fixtures.ts e2e/token.spec.ts
```

All commands below run from the repo root `pumpfun.dev/` unless stated otherwise.

---

### Task 1: Monorepo scaffold + shared types

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/shared.test.ts`

**Interfaces:**
- Produces (`@pumpfun/shared`): `TraceRequest` (Zod), `base58Address`, `TOKEN_DECIMALS`, types `TerminalReason`, `StepName`, `StepState`, `NodeRole`, `RiskLevel`, `JobState`, `TokenInfo`, `ChainNode`, `DevToken`, `DevTransfer`, `DevStatus`, `Crosslink`, `RiskFactor`, `RiskScore`, `TraceEvent`, `TraceResult`, `RecentTrace`, `WalletView`; functions `formatTokenAmount(raw: string | bigint): string`, `formatSol(lamports: string | bigint): string`, `shortAddress(a: string): string`.

- [ ] **Step 1: Check tooling**

Run: `node -v` → expect `v24.x` or newer. Run: `pnpm -v`. If pnpm is missing: `npm install -g pnpm`.

- [ ] **Step 2: Create root files**

`package.json`:
```json
{
  "name": "pumpfun-dev",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "dev:api": "pnpm --filter @pumpfun/api dev",
    "dev:web": "pnpm --filter @pumpfun/web dev"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
onlyBuiltDependencies:
  - better-sqlite3
  - esbuild
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
*.db
*.db-wal
*.db-shm
.env
test-results/
playwright-report/
```

Then pin pnpm and install shared dev tools:
```bash
corepack use pnpm@latest
pnpm add -w -D typescript vitest tsx @types/node
```
(If `corepack use` fails on Windows without admin rights, skip it; the Dockerfile in Task 16 runs it inside the container.)

- [ ] **Step 3: Create the shared package skeleton**

`packages/shared/package.json`:
```json
{
  "name": "@pumpfun/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm --filter @pumpfun/shared add zod`

- [ ] **Step 4: Write the failing test**

`packages/shared/test/shared.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { TraceRequest, formatSol, formatTokenAmount, shortAddress } from "../src/index";

const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";

describe("TraceRequest", () => {
  it("accepts a base58 mint", () => {
    expect(TraceRequest.safeParse({ mint: MINT }).success).toBe(true);
  });
  it("trims surrounding whitespace", () => {
    const r = TraceRequest.safeParse({ mint: `  ${MINT}\n` });
    expect(r.success && r.data.mint).toBe(MINT);
  });
  it("rejects characters outside base58", () => {
    expect(TraceRequest.safeParse({ mint: "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl" }).success).toBe(false);
  });
  it("rejects short strings", () => {
    expect(TraceRequest.safeParse({ mint: "abc" }).success).toBe(false);
  });
});

describe("formatting", () => {
  it("formats raw 6-decimal token amounts compactly", () => {
    expect(formatTokenAmount("30000000000000")).toBe("30M");
    expect(formatTokenAmount(1_500_000n)).toBe("1.5");
    expect(formatTokenAmount("0")).toBe("0");
  });
  it("formats lamports as SOL", () => {
    expect(formatSol("1500000000")).toBe("1.5 SOL");
  });
  it("shortens addresses", () => {
    expect(shortAddress(MINT)).toBe("9BB6…pump");
    expect(shortAddress("short")).toBe("short");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @pumpfun/shared test`
Expected: FAIL (cannot resolve `../src/index`).

- [ ] **Step 6: Implement**

`packages/shared/src/index.ts`:
```ts
import { z } from "zod";

export const base58Address = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Not a Solana address");

export const TraceRequest = z.object({ mint: base58Address });
export type TraceRequest = z.infer<typeof TraceRequest>;

export const TOKEN_DECIMALS = 6;

export type TerminalReason = "high_activity" | "unknown_origin" | "max_depth" | "loop" | "incomplete";
export type StepName = "token" | "funders" | "devActivity" | "crosslinks" | "score";
export type StepState = "running" | "done" | "incomplete";
export type NodeRole = "deployer" | "creator" | "funder";
export type RiskLevel = "low" | "medium" | "high";
export type JobState = "running" | "done" | "error" | "interrupted";

export interface TokenInfo {
  mint: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  tokenProgram: string | null;
  quoteMint: string | null;
  deployer: string;
  creatorCurrent: string | null;
  creatorOriginal: string | null;
  createdAt: number | null;
  createSignature: string | null;
  complete: boolean;
  isMayhemMode: boolean;
  devInitialBuy: string | null;
  createTxFound: boolean;
}

export interface ChainNode {
  address: string;
  depth: number;
  role: NodeRole;
  chainRoot: string;
  fundedBy: string | null;
  fundingAmountLamports: string | null;
  fundedAt: number | null;
  fundingSignature: string | null;
  terminal: TerminalReason | null;
}

export interface DevToken {
  mint: string;
  name: string | null;
  symbol: string | null;
  createdAt: number | null;
  complete: boolean;
  devBalance: string;
  initialBuy: string | null;
  status: "alive" | "migrated" | "dead_dev_exited";
}

export interface DevTransfer {
  to: string;
  amount: string;
  signature: string;
}

export interface DevStatus {
  initialBuy: string | null;
  bought: string;
  sold: string;
  transferredOut: string;
  balance: string;
  releasedPct: number | null;
  transfers: DevTransfer[];
  partial: boolean;
}

export interface Crosslink {
  wallet: string;
  role: NodeRole | "insider";
  otherMint: string;
  otherSymbol: string | null;
}

export interface RiskFactor {
  id: string;
  points: number;
  reason: string;
}

export interface RiskScore {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  incomplete: boolean;
}

export type TraceEvent =
  | { type: "step"; data: { step: StepName; state: StepState } }
  | { type: "token"; data: TokenInfo }
  | { type: "node"; data: ChainNode }
  | { type: "devHistory"; data: { tokens: DevToken[]; partial: boolean } }
  | { type: "devStatus"; data: DevStatus }
  | { type: "crosslinks"; data: Crosslink[] }
  | { type: "score"; data: RiskScore }
  | { type: "done"; data: { partial: boolean } }
  | { type: "error"; data: { message: string } };

export interface TraceResult {
  token: TokenInfo;
  nodes: ChainNode[];
  devHistory: DevToken[];
  devHistoryPartial: boolean;
  devStatus: DevStatus | null;
  crosslinks: Crosslink[];
  score: RiskScore;
  partial: boolean;
  finishedAt: number;
}

export interface RecentTrace {
  mint: string;
  name: string | null;
  symbol: string | null;
  score: number;
  level: RiskLevel;
  finishedAt: number;
}

export interface WalletView {
  address: string;
  known: boolean;
  chain: ChainNode[];
  deployed: {
    mint: string;
    name: string | null;
    symbol: string | null;
    createdAt: number | null;
    status: DevToken["status"] | null;
  }[];
  appearances: { mint: string; symbol: string | null; role: Crosslink["role"] }[];
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const solFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export function formatTokenAmount(raw: string | bigint): string {
  return compact.format(Number(BigInt(raw)) / 10 ** TOKEN_DECIMALS);
}

export function formatSol(lamports: string | bigint): string {
  return `${solFmt.format(Number(BigInt(lamports)) / 1e9)} SOL`;
}

export function shortAddress(a: string): string {
  return a.length <= 10 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @pumpfun/shared test` → PASS (7 tests).
Run: `pnpm --filter @pumpfun/shared typecheck` → no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo and shared types"
```

---

### Task 2: pump.fun decoders (bonding curve + events)

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/pump/constants.ts`, `src/pump/borsh.ts`, `src/pump/bondingCurve.ts`, `src/pump/events.ts`
- Create: `packages/core/src/testing/encode.ts`, `src/testing/index.ts`, `src/index.ts`
- Test: `packages/core/test/pump.test.ts`

**Interfaces:**
- Produces: `PUMP_PROGRAM_ID`, `PUMP_AMM_PROGRAM_ID`, `SYSTEM_PROGRAM_ID`, `TOKEN_PROGRAM_ID`, `TOKEN_2022_PROGRAM_ID`; `Reader`; `interface BondingCurveState { complete: boolean; creator: string | null; isMayhemMode: boolean; quoteMint: string | null; realQuoteReserves: bigint }`, `decodeBondingCurve(data: Uint8Array): BondingCurveState`; `interface CreateEvent { name; symbol; uri; mint; bondingCurve; user: string; creator: string | null; timestamp: number | null; tokenProgram: string | null; isMayhemMode: boolean }`, `interface TradeEvent { mint: string; solAmount: bigint; tokenAmount: bigint; isBuy: boolean; user: string; timestamp: number }`, `type PumpEvent = { kind: "create"; event: CreateEvent } | { kind: "trade"; event: TradeEvent }`, `decodePumpEventData(data: Uint8Array): PumpEvent | null`, `EVENT_IX_TAG`, `CREATE_EVENT_DISC`, `TRADE_EVENT_DISC`.
- Produces (`@pumpfun/core/testing`): `addr(n: number): string`, `toBase58(bytes: Uint8Array): string`, `Writer`, `encodeCreateEvent(e)`, `encodeTradeEvent(e)`, `encodeBondingCurve(c)`.

- [ ] **Step 1: Package skeleton**

`packages/core/package.json`:
```json
{
  "name": "@pumpfun/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run:
```bash
pnpm --filter @pumpfun/core add @solana/kit "@pumpfun/shared@workspace:*"
```

- [ ] **Step 2: Constants, Reader, and test encoders (needed by the test)**

`packages/core/src/pump/constants.ts`:
```ts
export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
```

`packages/core/src/pump/borsh.ts`:
```ts
import { getBase58Decoder } from "@solana/kit";

const b58 = getBase58Decoder();
const utf8 = new TextDecoder();

/** Little-endian Borsh reader. Throws RangeError when data runs out. */
export class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private view(n: number): DataView {
    if (this.offset + n > this.bytes.length) throw new RangeError("borsh: out of data");
    const v = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, n);
    this.offset += n;
    return v;
  }

  u8(): number {
    return this.view(1).getUint8(0);
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u32(): number {
    return this.view(4).getUint32(0, true);
  }

  u64(): bigint {
    return this.view(8).getBigUint64(0, true);
  }

  i64(): bigint {
    return this.view(8).getBigInt64(0, true);
  }

  skip(n: number): void {
    this.view(n);
  }

  take(n: number): Uint8Array {
    const v = this.view(n);
    return new Uint8Array(v.buffer, v.byteOffset, n);
  }

  pubkey(): string {
    return b58.decode(this.take(32));
  }

  string(): string {
    return utf8.decode(this.take(this.u32()));
  }
}
```

`packages/core/src/pump/events.ts` (discriminators only for now; decoder comes in Step 5):
```ts
import { createHash } from "node:crypto";

const disc = (s: string): Uint8Array => new Uint8Array(createHash("sha256").update(s).digest()).subarray(0, 8);

/** Prefix of every Anchor event emitted through self-CPI (`emit_cpi!`). */
export const EVENT_IX_TAG = disc("anchor:event");
export const CREATE_EVENT_DISC = disc("event:CreateEvent");
export const TRADE_EVENT_DISC = disc("event:TradeEvent");
```

`packages/core/src/testing/encode.ts`:
```ts
import { getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { CREATE_EVENT_DISC, EVENT_IX_TAG, TRADE_EVENT_DISC } from "../pump/events";
import { TOKEN_PROGRAM_ID } from "../pump/constants";

const b58enc = getBase58Encoder();
const b58dec = getBase58Decoder();

/** Deterministic valid address: 32 bytes all equal to n (n must be 1..255). */
export function addr(n: number): string {
  return b58dec.decode(new Uint8Array(32).fill(n));
}

export function toBase58(bytes: Uint8Array): string {
  return b58dec.decode(bytes);
}

export class Writer {
  private readonly out: number[] = [];

  u8(v: number): this {
    this.out.push(v & 0xff);
    return this;
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  u32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return this.bytes(b);
  }
  u64(v: bigint): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    return this.bytes(b);
  }
  i64(v: bigint): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, v, true);
    return this.bytes(b);
  }
  bytes(b: Uint8Array): this {
    for (const x of b) this.out.push(x);
    return this;
  }
  pubkey(a: string): this {
    return this.bytes(new Uint8Array(b58enc.encode(a)));
  }
  string(s: string): this {
    const b = new TextEncoder().encode(s);
    return this.u32(b.length).bytes(b);
  }
  build(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

export interface CreateEventInput {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bondingCurve: string;
  user: string;
  /** Omit to produce a legacy (pre-2025) event that ends after `user`. */
  creator?: string;
  timestamp?: number;
  tokenProgram?: string;
  isMayhemMode?: boolean;
}

export function encodeCreateEvent(e: CreateEventInput): Uint8Array {
  const w = new Writer()
    .bytes(EVENT_IX_TAG)
    .bytes(CREATE_EVENT_DISC)
    .string(e.name)
    .string(e.symbol)
    .string(e.uri)
    .pubkey(e.mint)
    .pubkey(e.bondingCurve)
    .pubkey(e.user);
  if (e.creator !== undefined) {
    w.pubkey(e.creator)
      .i64(BigInt(e.timestamp ?? 0))
      .u64(0n)
      .u64(0n)
      .u64(0n)
      .u64(0n)
      .pubkey(e.tokenProgram ?? TOKEN_PROGRAM_ID)
      .bool(e.isMayhemMode ?? false);
  }
  return w.build();
}

export interface TradeEventInput {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: number;
}

export function encodeTradeEvent(e: TradeEventInput): Uint8Array {
  return new Writer()
    .bytes(EVENT_IX_TAG)
    .bytes(TRADE_EVENT_DISC)
    .pubkey(e.mint)
    .u64(e.solAmount)
    .u64(e.tokenAmount)
    .bool(e.isBuy)
    .pubkey(e.user)
    .i64(BigInt(e.timestamp))
    .u64(0n) // trailing fields real events carry; the decoder must ignore them
    .u64(0n)
    .build();
}

export interface BondingCurveInput {
  complete: boolean;
  realQuoteReserves?: bigint;
  /** Omit to produce a legacy 49-byte account without creator. */
  creator?: string;
  isMayhemMode?: boolean;
  quoteMint?: string;
}

export function encodeBondingCurve(c: BondingCurveInput): Uint8Array {
  const w = new Writer()
    .bytes(new Uint8Array(8))
    .u64(0n)
    .u64(0n)
    .u64(0n)
    .u64(c.realQuoteReserves ?? 0n)
    .u64(0n)
    .bool(c.complete);
  if (c.creator !== undefined) {
    w.pubkey(c.creator)
      .bool(c.isMayhemMode ?? false)
      .bool(false)
      .bytes(c.quoteMint ? new Uint8Array(b58enc.encode(c.quoteMint)) : new Uint8Array(32));
  }
  return w.build();
}
```

`packages/core/src/testing/index.ts`:
```ts
export * from "./encode";
```

- [ ] **Step 3: Write the failing test**

`packages/core/test/pump.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decodeBondingCurve } from "../src/pump/bondingCurve";
import { EVENT_IX_TAG, decodePumpEventData } from "../src/pump/events";
import { TOKEN_2022_PROGRAM_ID } from "../src/pump/constants";
import { addr, encodeBondingCurve, encodeCreateEvent, encodeTradeEvent } from "../src/testing";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("event discriminators", () => {
  it("matches Anchor's EVENT_IX_TAG", () => {
    expect(hex(EVENT_IX_TAG)).toBe("e445a52e51cb9a1d");
  });
});

describe("decodePumpEventData", () => {
  it("decodes a current CreateEvent", () => {
    const data = encodeCreateEvent({
      name: "Test Coin",
      symbol: "TEST",
      uri: "https://x/meta.json",
      mint: addr(1),
      bondingCurve: addr(2),
      user: addr(3),
      creator: addr(4),
      timestamp: 1_700_000_000,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      isMayhemMode: true,
    });
    expect(decodePumpEventData(data)).toEqual({
      kind: "create",
      event: {
        name: "Test Coin",
        symbol: "TEST",
        uri: "https://x/meta.json",
        mint: addr(1),
        bondingCurve: addr(2),
        user: addr(3),
        creator: addr(4),
        timestamp: 1_700_000_000,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        isMayhemMode: true,
      },
    });
  });

  it("decodes a legacy CreateEvent without creator/timestamp", () => {
    const data = encodeCreateEvent({ name: "Old", symbol: "OLD", uri: "u", mint: addr(1), bondingCurve: addr(2), user: addr(3) });
    const ev = decodePumpEventData(data);
    expect(ev?.kind).toBe("create");
    if (ev?.kind !== "create") throw new Error("unreachable");
    expect(ev.event.user).toBe(addr(3));
    expect(ev.event.creator).toBeNull();
    expect(ev.event.timestamp).toBeNull();
    expect(ev.event.tokenProgram).toBeNull();
  });

  it("decodes a TradeEvent and ignores trailing fields", () => {
    const data = encodeTradeEvent({ mint: addr(1), solAmount: 5n, tokenAmount: 1000n, isBuy: false, user: addr(9), timestamp: 42 });
    expect(decodePumpEventData(data)).toEqual({
      kind: "trade",
      event: { mint: addr(1), solAmount: 5n, tokenAmount: 1000n, isBuy: false, user: addr(9), timestamp: 42 },
    });
  });

  it("returns null for non-event data", () => {
    expect(decodePumpEventData(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodePumpEventData(new Uint8Array(40))).toBeNull();
  });

  it("returns null for a truncated event", () => {
    const data = encodeTradeEvent({ mint: addr(1), solAmount: 1n, tokenAmount: 1n, isBuy: true, user: addr(2), timestamp: 1 });
    expect(decodePumpEventData(data.subarray(0, 30))).toBeNull();
  });
});

describe("decodeBondingCurve", () => {
  it("decodes a current account", () => {
    const state = decodeBondingCurve(
      encodeBondingCurve({ complete: true, realQuoteReserves: 85n, creator: addr(7), isMayhemMode: true, quoteMint: addr(8) }),
    );
    expect(state).toEqual({ complete: true, creator: addr(7), isMayhemMode: true, quoteMint: addr(8), realQuoteReserves: 85n });
  });

  it("decodes a legacy 49-byte account", () => {
    const state = decodeBondingCurve(encodeBondingCurve({ complete: false }));
    expect(state).toEqual({ complete: false, creator: null, isMayhemMode: false, quoteMint: null, realQuoteReserves: 0n });
  });

  it("treats an all-zero creator as missing", () => {
    const data = new Uint8Array(150);
    expect(decodeBondingCurve(data).creator).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @pumpfun/core test`
Expected: FAIL (`decodeBondingCurve` / `decodePumpEventData` not exported).

- [ ] **Step 5: Implement the decoders**

`packages/core/src/pump/bondingCurve.ts`:
```ts
import { Reader } from "./borsh";
import { SYSTEM_PROGRAM_ID } from "./constants";

export interface BondingCurveState {
  complete: boolean;
  creator: string | null;
  isMayhemMode: boolean;
  quoteMint: string | null;
  realQuoteReserves: bigint;
}

/** All-zero pubkey decodes to the System Program id; treat it as "unset". */
const unset = (a: string | null) => (a === null || a === SYSTEM_PROGRAM_ID ? null : a);

/**
 * Layout (IDL pump.json): discriminator(8) virtual_token_reserves u64, virtual_quote_reserves u64,
 * real_token_reserves u64, real_quote_reserves u64, token_total_supply u64, complete bool,
 * creator pubkey (offset 49), is_mayhem_mode bool, is_cashback_coin bool, quote_mint pubkey, ...
 * Older accounts stop after `complete`, so trailing fields are optional.
 */
export function decodeBondingCurve(data: Uint8Array): BondingCurveState {
  const r = new Reader(data);
  r.skip(8);
  r.skip(8 * 3);
  const realQuoteReserves = r.u64();
  r.skip(8);
  const complete = r.bool();
  let creator: string | null = null;
  let isMayhemMode = false;
  let quoteMint: string | null = null;
  if (r.remaining >= 32) creator = r.pubkey();
  if (r.remaining >= 2) {
    isMayhemMode = r.bool();
    r.bool();
  }
  if (r.remaining >= 32) quoteMint = r.pubkey();
  return { complete, creator: unset(creator), isMayhemMode, quoteMint: unset(quoteMint), realQuoteReserves };
}
```

Replace `packages/core/src/pump/events.ts` with:
```ts
import { createHash } from "node:crypto";
import { Reader } from "./borsh";

const disc = (s: string): Uint8Array => new Uint8Array(createHash("sha256").update(s).digest()).subarray(0, 8);

/** Prefix of every Anchor event emitted through self-CPI (`emit_cpi!`). */
export const EVENT_IX_TAG = disc("anchor:event");
export const CREATE_EVENT_DISC = disc("event:CreateEvent");
export const TRADE_EVENT_DISC = disc("event:TradeEvent");

export interface CreateEvent {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bondingCurve: string;
  user: string;
  creator: string | null;
  timestamp: number | null;
  tokenProgram: string | null;
  isMayhemMode: boolean;
}

export interface TradeEvent {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: number;
}

export type PumpEvent = { kind: "create"; event: CreateEvent } | { kind: "trade"; event: TradeEvent };

function startsWith(data: Uint8Array, prefix: Uint8Array, at: number): boolean {
  if (data.length < at + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[at + i] !== prefix[i]) return false;
  return true;
}

function decodeCreate(body: Uint8Array): CreateEvent {
  const r = new Reader(body);
  const name = r.string();
  const symbol = r.string();
  const uri = r.string();
  const mint = r.pubkey();
  const bondingCurve = r.pubkey();
  const user = r.pubkey();
  let creator: string | null = null;
  let timestamp: number | null = null;
  let tokenProgram: string | null = null;
  let isMayhemMode = false;
  if (r.remaining >= 32) creator = r.pubkey();
  if (r.remaining >= 8) timestamp = Number(r.i64());
  // virtual_token_reserves, virtual_sol_reserves, real_token_reserves, token_total_supply
  if (r.remaining >= 32 + 32) {
    r.skip(32);
    tokenProgram = r.pubkey();
  }
  if (r.remaining >= 1) isMayhemMode = r.bool();
  return { name, symbol, uri, mint, bondingCurve, user, creator, timestamp, tokenProgram, isMayhemMode };
}

function decodeTrade(body: Uint8Array): TradeEvent {
  const r = new Reader(body);
  const mint = r.pubkey();
  const solAmount = r.u64();
  const tokenAmount = r.u64();
  const isBuy = r.bool();
  const user = r.pubkey();
  const timestamp = Number(r.i64());
  return { mint, solAmount, tokenAmount, isBuy, user, timestamp };
}

/** Decodes the data of a self-CPI event instruction. Returns null for anything else. */
export function decodePumpEventData(data: Uint8Array): PumpEvent | null {
  if (!startsWith(data, EVENT_IX_TAG, 0)) return null;
  const body = data.subarray(16);
  try {
    if (startsWith(data, CREATE_EVENT_DISC, 8)) return { kind: "create", event: decodeCreate(body) };
    if (startsWith(data, TRADE_EVENT_DISC, 8)) return { kind: "trade", event: decodeTrade(body) };
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
  return null;
}
```

`packages/core/src/index.ts`:
```ts
export * from "./pump/constants";
export * from "./pump/borsh";
export * from "./pump/bondingCurve";
export * from "./pump/events";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @pumpfun/core test` → PASS (9 tests).
Run: `pnpm --filter @pumpfun/core typecheck` → no errors.

If the `EVENT_IX_TAG` test fails, stop: the event prefix assumption is wrong and every later task depends on it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): decode pump.fun bonding curve and events"
```

---

### Task 3: Chain data shapes + transaction helpers

**Files:**
- Create: `packages/core/src/chain.ts`, `packages/core/src/tx.ts`, `packages/core/src/testing/tx.ts`
- Modify: `packages/core/src/testing/index.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/tx.test.ts`

**Interfaces:**
- Consumes: `decodePumpEventData`, `PumpEvent`, program-id constants (Task 2).
- Produces (`chain.ts`): `SignatureInfo { signature: string; slot: number; blockTime: number | null; err: unknown | null }`, `ParsedInstruction { programId: string; program?: string; parsed?: { type: string; info: Record<string, any> }; accounts?: string[]; data?: string }`, `TokenBalance { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }`, `ParsedTx`, `AccountData { address: string; owner: string; data: Uint8Array }`, `TokenHolding { mint: string; amount: string }`, `interface ChainSource { getSignatures(address, { before?, limit }); getTransaction(sig); getAccount(address); getAccounts(addresses); getTokenHoldings(owner) }`.
- Produces (`tx.ts`): `allInstructions(tx): ParsedInstruction[]`, `accountKeys(tx): string[]`, `txSignature(tx): string`, `interface SolFunding { from: string; lamports: bigint; signature: string; blockTime: number | null }`, `findSolFunding(tx, wallet): SolFunding | null`, `tokenDeltas(tx, mint): Map<string, bigint>`, `lamportDelta(tx, address): bigint`, `ownerGainedOtherToken(tx, owner, excludeMint): boolean`, `pumpEvents(tx): PumpEvent[]`.
- Produces (testing): `makeTx(input: MakeTxInput): ParsedTx`, `systemTransfer(from, to, lamports): ParsedInstruction`, `pumpEventIx(data: Uint8Array): ParsedInstruction`, `tokenBal(accountIndex, mint, owner, amount): TokenBalance`.

- [ ] **Step 1: Write chain shapes (types only)**

`packages/core/src/chain.ts`:
```ts
/** Shapes match Solana JSON-RPC with `encoding: "jsonParsed"`. */

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
}

export interface ParsedInstruction {
  programId: string;
  program?: string;
  /** Present when the RPC node knows how to parse the program (System, SPL Token, ...). */
  parsed?: { type: string; info: Record<string, any> };
  /** Present for programs the node cannot parse (pump.fun). `data` is base58. */
  accounts?: string[];
  data?: string;
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface ParsedTx {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown | null;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances: TokenBalance[];
    postTokenBalances: TokenBalance[];
    innerInstructions: { index: number; instructions: ParsedInstruction[] }[];
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[];
      instructions: ParsedInstruction[];
    };
  };
}

export interface AccountData {
  address: string;
  owner: string;
  data: Uint8Array;
}

export interface TokenHolding {
  mint: string;
  /** Raw amount summed across all token accounts of this mint. */
  amount: string;
}

export interface ChainSource {
  /** Newest first. */
  getSignatures(address: string, opts: { before?: string; limit: number }): Promise<SignatureInfo[]>;
  getTransaction(signature: string): Promise<ParsedTx | null>;
  getAccount(address: string): Promise<AccountData | null>;
  getAccounts(addresses: string[]): Promise<(AccountData | null)[]>;
  /** Balances across both SPL Token and Token-2022 programs. */
  getTokenHoldings(owner: string): Promise<TokenHolding[]>;
}
```

- [ ] **Step 2: Write test helpers**

`packages/core/src/testing/tx.ts`:
```ts
import type { ParsedInstruction, ParsedTx, TokenBalance } from "../chain";
import { PUMP_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../pump/constants";
import { toBase58 } from "./encode";

export interface MakeTxInput {
  signature: string;
  blockTime?: number | null;
  err?: unknown;
  accountKeys?: string[];
  instructions?: ParsedInstruction[];
  inner?: ParsedInstruction[];
  preBalances?: number[];
  postBalances?: number[];
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
}

export function makeTx(i: MakeTxInput): ParsedTx {
  return {
    slot: 1,
    blockTime: i.blockTime === undefined ? 1_700_000_000 : i.blockTime,
    meta: {
      err: i.err ?? null,
      preBalances: i.preBalances ?? [],
      postBalances: i.postBalances ?? [],
      preTokenBalances: i.preTokenBalances ?? [],
      postTokenBalances: i.postTokenBalances ?? [],
      innerInstructions: i.inner?.length ? [{ index: 0, instructions: i.inner }] : [],
    },
    transaction: {
      signatures: [i.signature],
      message: {
        accountKeys: (i.accountKeys ?? []).map((pubkey, idx) => ({ pubkey, signer: idx === 0, writable: true })),
        instructions: i.instructions ?? [],
      },
    },
  };
}

export function systemTransfer(from: string, to: string, lamports: number): ParsedInstruction {
  return {
    programId: SYSTEM_PROGRAM_ID,
    program: "system",
    parsed: { type: "transfer", info: { source: from, destination: to, lamports } },
  };
}

export function pumpEventIx(data: Uint8Array): ParsedInstruction {
  return { programId: PUMP_PROGRAM_ID, accounts: [], data: toBase58(data) };
}

export function tokenBal(accountIndex: number, mint: string, owner: string, amount: bigint | number): TokenBalance {
  return { accountIndex, mint, owner, uiTokenAmount: { amount: String(amount), decimals: 6 } };
}
```

Replace `packages/core/src/testing/index.ts` with:
```ts
export * from "./encode";
export * from "./tx";
```

- [ ] **Step 3: Write the failing test**

`packages/core/test/tx.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { findSolFunding, lamportDelta, ownerGainedOtherToken, pumpEvents, tokenDeltas } from "../src/tx";
import { SYSTEM_PROGRAM_ID } from "../src/pump/constants";
import { addr, encodeCreateEvent, encodeTradeEvent, makeTx, pumpEventIx, systemTransfer, tokenBal } from "../src/testing";

const W = addr(1);
const F = addr(2);
const MINT = addr(3);

describe("findSolFunding", () => {
  it("finds an outer System transfer into the wallet", () => {
    const tx = makeTx({ signature: "s1", blockTime: 100, instructions: [systemTransfer(F, W, 5)] });
    expect(findSolFunding(tx, W)).toEqual({ from: F, lamports: 5n, signature: "s1", blockTime: 100 });
  });

  it("finds a transfer inside inner instructions", () => {
    const tx = makeTx({ signature: "s2", inner: [systemTransfer(F, W, 7)] });
    expect(findSolFunding(tx, W)?.from).toBe(F);
  });

  it("finds createAccount funding", () => {
    const tx = makeTx({
      signature: "s3",
      instructions: [{ programId: SYSTEM_PROGRAM_ID, parsed: { type: "createAccount", info: { source: F, newAccount: W, lamports: 9 } } }],
    });
    expect(findSolFunding(tx, W)?.lamports).toBe(9n);
  });

  it("ignores self transfers, zero amounts, other destinations and failed txs", () => {
    expect(findSolFunding(makeTx({ signature: "a", instructions: [systemTransfer(W, W, 5)] }), W)).toBeNull();
    expect(findSolFunding(makeTx({ signature: "b", instructions: [systemTransfer(F, W, 0)] }), W)).toBeNull();
    expect(findSolFunding(makeTx({ signature: "c", instructions: [systemTransfer(F, addr(9), 5)] }), W)).toBeNull();
    expect(findSolFunding(makeTx({ signature: "d", err: { x: 1 }, instructions: [systemTransfer(F, W, 5)] }), W)).toBeNull();
  });
});

describe("balance helpers", () => {
  const tx = makeTx({
    signature: "t",
    accountKeys: [W, F],
    preBalances: [1000, 50],
    postBalances: [400, 650],
    preTokenBalances: [tokenBal(2, MINT, W, 100), tokenBal(5, addr(8), F, 0)],
    postTokenBalances: [tokenBal(2, MINT, W, 40), tokenBal(3, MINT, F, 60), tokenBal(5, addr(8), F, 10)],
  });

  it("computes token deltas per owner, treating a missing pre balance as 0", () => {
    expect(tokenDeltas(tx, MINT)).toEqual(new Map([[W, -60n], [F, 60n]]));
  });

  it("computes lamport deltas", () => {
    expect(lamportDelta(tx, W)).toBe(-600n);
    expect(lamportDelta(tx, F)).toBe(600n);
    expect(lamportDelta(tx, addr(9))).toBe(0n);
  });

  it("detects an owner gaining a different token", () => {
    expect(ownerGainedOtherToken(tx, F, MINT)).toBe(true);
    expect(ownerGainedOtherToken(tx, W, MINT)).toBe(false);
  });
});

describe("pumpEvents", () => {
  it("extracts create and trade events from inner instructions", () => {
    const tx = makeTx({
      signature: "c",
      inner: [
        pumpEventIx(encodeCreateEvent({ name: "A", symbol: "A", uri: "u", mint: MINT, bondingCurve: addr(4), user: W, creator: W, timestamp: 5 })),
        systemTransfer(W, F, 1),
        pumpEventIx(encodeTradeEvent({ mint: MINT, solAmount: 1n, tokenAmount: 10n, isBuy: true, user: W, timestamp: 5 })),
      ],
    });
    expect(pumpEvents(tx).map((e) => e.kind)).toEqual(["create", "trade"]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @pumpfun/core test -- tx`
Expected: FAIL (cannot resolve `../src/tx`).

- [ ] **Step 5: Implement**

`packages/core/src/tx.ts`:
```ts
import { getBase58Encoder } from "@solana/kit";
import type { ParsedInstruction, ParsedTx, TokenBalance } from "./chain";
import { PUMP_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "./pump/constants";
import { decodePumpEventData, type PumpEvent } from "./pump/events";

const b58 = getBase58Encoder();

export function allInstructions(tx: ParsedTx): ParsedInstruction[] {
  const inner = tx.meta?.innerInstructions.flatMap((g) => g.instructions) ?? [];
  return [...tx.transaction.message.instructions, ...inner];
}

export function accountKeys(tx: ParsedTx): string[] {
  return tx.transaction.message.accountKeys.map((k) => k.pubkey);
}

export function txSignature(tx: ParsedTx): string {
  return tx.transaction.signatures[0] ?? "";
}

export interface SolFunding {
  from: string;
  lamports: bigint;
  signature: string;
  blockTime: number | null;
}

/** First System Program transfer (incl. createAccount) that sends SOL from another wallet into `wallet`. */
export function findSolFunding(tx: ParsedTx, wallet: string): SolFunding | null {
  if (!tx.meta || tx.meta.err) return null;
  for (const ix of allInstructions(tx)) {
    if (ix.programId !== SYSTEM_PROGRAM_ID || !ix.parsed) continue;
    const { type, info } = ix.parsed;
    let to: string | undefined;
    if (type === "transfer" || type === "transferWithSeed") to = info.destination;
    else if (type === "createAccount" || type === "createAccountWithSeed") to = info.newAccount;
    else continue;
    const from: string | undefined = info.source;
    const lamports = BigInt(info.lamports ?? 0);
    if (to === wallet && from && from !== wallet && lamports > 0n) {
      return { from, lamports, signature: txSignature(tx), blockTime: tx.blockTime };
    }
  }
  return null;
}

/** Net change of `mint` per owner within this transaction. */
export function tokenDeltas(tx: ParsedTx, mint: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  if (!tx.meta) return out;
  const add = (b: TokenBalance, sign: bigint) => {
    if (b.mint !== mint || !b.owner) return;
    out.set(b.owner, (out.get(b.owner) ?? 0n) + sign * BigInt(b.uiTokenAmount.amount));
  };
  for (const b of tx.meta.preTokenBalances) add(b, -1n);
  for (const b of tx.meta.postTokenBalances) add(b, 1n);
  return out;
}

export function lamportDelta(tx: ParsedTx, address: string): bigint {
  if (!tx.meta) return 0n;
  const i = accountKeys(tx).indexOf(address);
  if (i < 0) return 0n;
  return BigInt(tx.meta.postBalances[i] ?? 0) - BigInt(tx.meta.preBalances[i] ?? 0);
}

/** True when `owner` received any token other than `excludeMint` (e.g. WSOL or USDC from a swap). */
export function ownerGainedOtherToken(tx: ParsedTx, owner: string, excludeMint: string): boolean {
  if (!tx.meta) return false;
  const mints = new Set(
    [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances].map((b) => b.mint).filter((m) => m !== excludeMint),
  );
  for (const m of mints) if ((tokenDeltas(tx, m).get(owner) ?? 0n) > 0n) return true;
  return false;
}

export function pumpEvents(tx: ParsedTx): PumpEvent[] {
  const out: PumpEvent[] = [];
  for (const ix of allInstructions(tx)) {
    if (ix.programId !== PUMP_PROGRAM_ID || !ix.data) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(b58.encode(ix.data));
    } catch {
      continue;
    }
    const ev = decodePumpEventData(bytes);
    if (ev) out.push(ev);
  }
  return out;
}
```

Replace `packages/core/src/index.ts` with:
```ts
export * from "./chain";
export * from "./tx";
export * from "./pump/constants";
export * from "./pump/borsh";
export * from "./pump/bondingCurve";
export * from "./pump/events";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @pumpfun/core test` → PASS.
Run: `pnpm --filter @pumpfun/core typecheck` → no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): parsed transaction helpers"
```

---

### Task 4: Store interface, tx cache, and token resolution

**Files:**
- Create: `packages/core/src/store.ts`, `src/config.ts`, `src/abort.ts`, `src/pda.ts`, `src/signatures.ts`, `src/cachedChain.ts`, `src/trace/resolveToken.ts`
- Create: `packages/core/src/testing/fakeChain.ts`, `src/testing/memoryStore.ts`
- Modify: `packages/core/src/testing/index.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/resolveToken.test.ts`

**Interfaces:**
- Consumes: `ChainSource`, `ParsedTx`, `pumpEvents`, `decodeBondingCurve`, `PUMP_PROGRAM_ID` (Tasks 2–3); `TokenInfo`, `Crosslink` from `@pumpfun/shared`.
- Produces:
  - `interface WalletRecord { address: string; funderResolved: boolean; funder: string | null; fundingSignature: string | null; fundingAmountLamports: string | null; fundedAt: number | null; terminal: "high_activity" | "unknown_origin" | null; fetchedAt: number }`
  - `interface TaintedFunder { wallet: string; deadCount: number }`
  - `interface Store { getWallet(address): WalletRecord | null; putWallet(r): void; getTx(sig): ParsedTx | null; putTx(sig, tx): void; findCrosslinks(wallets: string[], excludeMint: string): Crosslink[]; findTaintedFunders(wallets: string[], excludeMint: string): TaintedFunder[] }`
  - `interface TraceConfig { pageSize; mintMaxPages; walletMaxPages; oldestTxScan; maxHops; devTxScan }`, `DEFAULT_CONFIG = { pageSize: 1000, mintMaxPages: 20, walletMaxPages: 5, oldestTxScan: 10, maxHops: 5, devTxScan: 60 }`
  - `isAbortError(e: unknown): boolean`
  - `bondingCurvePda(mint: string): Promise<string>`
  - `collectSignatures(chain, address, maxPages, pageSize): Promise<{ sigs: SignatureInfo[]; complete: boolean }>`
  - `withTxCache(chain, store): ChainSource`
  - `class NotPumpTokenError extends Error`, `resolveToken(mint, chain, cfg): Promise<{ info: TokenInfo; curve: BondingCurveState }>`
  - testing: `class FakeChain implements ChainSource` (fields `sigs`, `txs`, `accounts`, `holdings`, `calls: string[]`, `failTx: Set<string>`; method `setHistory(address, entries)`), `class MemoryStore implements Store` (fields `wallets`, `txs`, `crosslinks: Crosslink[]`, `tainted: TaintedFunder[]`).

- [ ] **Step 1: Interfaces, config, small helpers**

`packages/core/src/store.ts`:
```ts
import type { Crosslink } from "@pumpfun/shared";
import type { ParsedTx } from "./chain";

export interface WalletRecord {
  address: string;
  funderResolved: boolean;
  funder: string | null;
  fundingSignature: string | null;
  fundingAmountLamports: string | null;
  fundedAt: number | null;
  terminal: "high_activity" | "unknown_origin" | null;
  fetchedAt: number;
}

export interface TaintedFunder {
  wallet: string;
  deadCount: number;
}

export interface Store {
  getWallet(address: string): WalletRecord | null;
  putWallet(record: WalletRecord): void;
  getTx(signature: string): ParsedTx | null;
  putTx(signature: string, tx: ParsedTx): void;
  /** Other traced tokens in which any of `wallets` appeared. */
  findCrosslinks(wallets: string[], excludeMint: string): Crosslink[];
  /** For each wallet: how many "dead, dev exited" tokens it is linked to (as funder of their dev, or as their dev). */
  findTaintedFunders(wallets: string[], excludeMint: string): TaintedFunder[];
}
```

`packages/core/src/config.ts`:
```ts
export interface TraceConfig {
  /** Signatures per getSignaturesForAddress page (RPC max 1000). */
  pageSize: number;
  /** Pages to walk back on the mint to find its creation tx. */
  mintMaxPages: number;
  /** Pages to walk back on a wallet before calling it high-activity. */
  walletMaxPages: number;
  /** Oldest transactions inspected when looking for a wallet's first SOL funding. */
  oldestTxScan: number;
  maxHops: number;
  /** Most recent dev transactions inspected for history and sell/transfer activity. */
  devTxScan: number;
}

export const DEFAULT_CONFIG: TraceConfig = {
  pageSize: 1000,
  mintMaxPages: 20,
  walletMaxPages: 5,
  oldestTxScan: 10,
  maxHops: 5,
  devTxScan: 60,
};
```

`packages/core/src/abort.ts`:
```ts
export function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === "AbortError";
}
```

`packages/core/src/pda.ts`:
```ts
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { PUMP_PROGRAM_ID } from "./pump/constants";

export async function bondingCurvePda(mint: string): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(PUMP_PROGRAM_ID),
    seeds: ["bonding-curve", getAddressEncoder().encode(address(mint))],
  });
  return pda;
}
```

`packages/core/src/signatures.ts`:
```ts
import type { ChainSource, SignatureInfo } from "./chain";

/** Walks history backwards. `complete` is false when `maxPages` ran out before the oldest signature. */
export async function collectSignatures(
  chain: ChainSource,
  address: string,
  maxPages: number,
  pageSize: number,
): Promise<{ sigs: SignatureInfo[]; complete: boolean }> {
  const sigs: SignatureInfo[] = [];
  let before: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const batch = await chain.getSignatures(address, { before, limit: pageSize });
    sigs.push(...batch);
    if (batch.length < pageSize) return { sigs, complete: true };
    before = batch[batch.length - 1]!.signature;
  }
  return { sigs, complete: false };
}
```

`packages/core/src/cachedChain.ts`:
```ts
import type { ChainSource } from "./chain";
import type { Store } from "./store";

/** Finalized transactions never change, so they are cached forever. */
export function withTxCache(chain: ChainSource, store: Pick<Store, "getTx" | "putTx">): ChainSource {
  return {
    getSignatures: (a, o) => chain.getSignatures(a, o),
    getAccount: (a) => chain.getAccount(a),
    getAccounts: (a) => chain.getAccounts(a),
    getTokenHoldings: (o) => chain.getTokenHoldings(o),
    async getTransaction(signature) {
      const cached = store.getTx(signature);
      if (cached) return cached;
      const tx = await chain.getTransaction(signature);
      if (tx) store.putTx(signature, tx);
      return tx;
    },
  };
}
```

- [ ] **Step 2: Test doubles**

`packages/core/src/testing/fakeChain.ts`:
```ts
import type { AccountData, ChainSource, ParsedTx, SignatureInfo, TokenHolding } from "../chain";

export interface HistoryEntry {
  signature: string;
  blockTime?: number;
  err?: unknown;
  tx?: ParsedTx;
}

export class FakeChain implements ChainSource {
  /** Newest first, like the RPC. */
  readonly sigs = new Map<string, SignatureInfo[]>();
  readonly txs = new Map<string, ParsedTx>();
  readonly accounts = new Map<string, AccountData>();
  readonly holdings = new Map<string, TokenHolding[]>();
  readonly failTx = new Set<string>();
  readonly calls: string[] = [];

  /** `entries` are oldest first. */
  setHistory(address: string, entries: HistoryEntry[]): void {
    const sigs = entries.map((e) => ({
      signature: e.signature,
      slot: 1,
      blockTime: e.blockTime ?? e.tx?.blockTime ?? null,
      err: e.err ?? null,
    }));
    this.sigs.set(address, sigs.reverse());
    for (const e of entries) if (e.tx) this.txs.set(e.signature, e.tx);
  }

  async getSignatures(address: string, opts: { before?: string; limit: number }): Promise<SignatureInfo[]> {
    this.calls.push(`sigs:${address}`);
    const list = this.sigs.get(address) ?? [];
    let start = 0;
    if (opts.before) {
      const idx = list.findIndex((s) => s.signature === opts.before);
      if (idx < 0) return [];
      start = idx + 1;
    }
    return list.slice(start, start + opts.limit);
  }

  async getTransaction(signature: string): Promise<ParsedTx | null> {
    this.calls.push(`tx:${signature}`);
    if (this.failTx.has(signature)) throw new Error("rpc down");
    return this.txs.get(signature) ?? null;
  }

  async getAccount(address: string): Promise<AccountData | null> {
    this.calls.push(`account:${address}`);
    return this.accounts.get(address) ?? null;
  }

  async getAccounts(addresses: string[]): Promise<(AccountData | null)[]> {
    this.calls.push(`accounts:${addresses.length}`);
    return addresses.map((a) => this.accounts.get(a) ?? null);
  }

  async getTokenHoldings(owner: string): Promise<TokenHolding[]> {
    this.calls.push(`holdings:${owner}`);
    return this.holdings.get(owner) ?? [];
  }
}
```

`packages/core/src/testing/memoryStore.ts`:
```ts
import type { Crosslink } from "@pumpfun/shared";
import type { ParsedTx } from "../chain";
import type { Store, TaintedFunder, WalletRecord } from "../store";

export class MemoryStore implements Store {
  readonly wallets = new Map<string, WalletRecord>();
  readonly txs = new Map<string, ParsedTx>();
  crosslinks: Crosslink[] = [];
  tainted: TaintedFunder[] = [];

  getWallet(address: string): WalletRecord | null {
    return this.wallets.get(address) ?? null;
  }
  putWallet(record: WalletRecord): void {
    this.wallets.set(record.address, record);
  }
  getTx(signature: string): ParsedTx | null {
    return this.txs.get(signature) ?? null;
  }
  putTx(signature: string, tx: ParsedTx): void {
    this.txs.set(signature, tx);
  }
  findCrosslinks(wallets: string[], excludeMint: string): Crosslink[] {
    return this.crosslinks.filter((c) => wallets.includes(c.wallet) && c.otherMint !== excludeMint);
  }
  findTaintedFunders(wallets: string[]): TaintedFunder[] {
    return this.tainted.filter((t) => wallets.includes(t.wallet));
  }
}
```

Replace `packages/core/src/testing/index.ts` with:
```ts
export * from "./encode";
export * from "./tx";
export * from "./fakeChain";
export * from "./memoryStore";
```

- [ ] **Step 3: Write the failing test**

`packages/core/test/resolveToken.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config";
import { bondingCurvePda } from "../src/pda";
import { PUMP_PROGRAM_ID } from "../src/pump/constants";
import { NotPumpTokenError, resolveToken } from "../src/trace/resolveToken";
import { withTxCache } from "../src/cachedChain";
import {
  FakeChain,
  MemoryStore,
  addr,
  encodeBondingCurve,
  encodeCreateEvent,
  encodeTradeEvent,
  makeTx,
  pumpEventIx,
} from "../src/testing";

const MINT = addr(20);
const DEV = addr(10);
const NEW_CREATOR = addr(12);

async function world(opts: { creator?: string; extraSigs?: number } = {}) {
  const chain = new FakeChain();
  const curve = await bondingCurvePda(MINT);
  chain.accounts.set(curve, {
    address: curve,
    owner: PUMP_PROGRAM_ID,
    data: encodeBondingCurve({ complete: false, creator: opts.creator ?? DEV, isMayhemMode: true }),
  });
  const createTx = makeTx({
    signature: "create",
    blockTime: 1000,
    inner: [
      pumpEventIx(encodeCreateEvent({ name: "Coin", symbol: "CN", uri: "https://u", mint: MINT, bondingCurve: curve, user: DEV, creator: DEV, timestamp: 1000 })),
      pumpEventIx(encodeTradeEvent({ mint: MINT, solAmount: 1n, tokenAmount: 777n, isBuy: true, user: DEV, timestamp: 1000 })),
    ],
  });
  const trades = Array.from({ length: opts.extraSigs ?? 2 }, (_, i) => ({ signature: `trade-${i}` }));
  chain.setHistory(MINT, [{ signature: "create", tx: createTx }, ...trades]);
  return chain;
}

describe("resolveToken", () => {
  it("finds the creation tx, deployer and initial buy", async () => {
    const chain = await world();
    const { info } = await resolveToken(MINT, chain, DEFAULT_CONFIG);
    expect(info).toMatchObject({
      mint: MINT,
      name: "Coin",
      symbol: "CN",
      uri: "https://u",
      deployer: DEV,
      creatorCurrent: DEV,
      creatorOriginal: DEV,
      createdAt: 1000,
      createSignature: "create",
      complete: false,
      isMayhemMode: true,
      devInitialBuy: "777",
      createTxFound: true,
    });
  });

  it("keeps the deployer when creator rights were moved", async () => {
    const chain = await world({ creator: NEW_CREATOR });
    const { info } = await resolveToken(MINT, chain, DEFAULT_CONFIG);
    expect(info.deployer).toBe(DEV);
    expect(info.creatorCurrent).toBe(NEW_CREATOR);
  });

  it("falls back to the curve creator when history is too long", async () => {
    const chain = await world({ creator: NEW_CREATOR, extraSigs: 5 });
    const { info } = await resolveToken(MINT, chain, { ...DEFAULT_CONFIG, pageSize: 2, mintMaxPages: 2 });
    expect(info.createTxFound).toBe(false);
    expect(info.deployer).toBe(NEW_CREATOR);
    expect(info.devInitialBuy).toBeNull();
  });

  it("rejects tokens without a pump.fun bonding curve", async () => {
    await expect(resolveToken(addr(99), new FakeChain(), DEFAULT_CONFIG)).rejects.toBeInstanceOf(NotPumpTokenError);
  });

  it("rejects strings that are not addresses", async () => {
    await expect(resolveToken("not-an-address", new FakeChain(), DEFAULT_CONFIG)).rejects.toBeInstanceOf(NotPumpTokenError);
  });
});

describe("withTxCache", () => {
  it("fetches a transaction once", async () => {
    const chain = await world();
    const cached = withTxCache(chain, new MemoryStore());
    await cached.getTransaction("create");
    await cached.getTransaction("create");
    expect(chain.calls.filter((c) => c === "tx:create")).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @pumpfun/core test -- resolveToken`
Expected: FAIL (cannot resolve `../src/trace/resolveToken`).

- [ ] **Step 5: Implement**

`packages/core/src/trace/resolveToken.ts`:
```ts
import { isAddress } from "@solana/kit";
import type { TokenInfo } from "@pumpfun/shared";
import type { ChainSource } from "../chain";
import type { TraceConfig } from "../config";
import { bondingCurvePda } from "../pda";
import { decodeBondingCurve, type BondingCurveState } from "../pump/bondingCurve";
import { PUMP_PROGRAM_ID } from "../pump/constants";
import type { CreateEvent } from "../pump/events";
import { collectSignatures } from "../signatures";
import { pumpEvents } from "../tx";

export class NotPumpTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotPumpTokenError";
  }
}

export interface ResolvedToken {
  info: TokenInfo;
  curve: BondingCurveState;
}

export async function resolveToken(mint: string, chain: ChainSource, cfg: TraceConfig): Promise<ResolvedToken> {
  if (!isAddress(mint)) throw new NotPumpTokenError("That is not a valid Solana address.");
  const curveAddress = await bondingCurvePda(mint);
  const account = await chain.getAccount(curveAddress);
  if (!account || account.owner !== PUMP_PROGRAM_ID) {
    throw new NotPumpTokenError("This is not a pump.fun token (no bonding curve found).");
  }
  const curve = decodeBondingCurve(account.data);

  let create: CreateEvent | null = null;
  let createSignature: string | null = null;
  let createBlockTime: number | null = null;
  let initialBuy: bigint | null = null;

  const { sigs, complete } = await collectSignatures(chain, mint, cfg.mintMaxPages, cfg.pageSize);
  if (complete) {
    // The creation tx is the oldest one. Check the 3 oldest in case the very first failed.
    for (let i = sigs.length - 1; i >= 0 && i >= sigs.length - 3; i--) {
      const sig = sigs[i]!;
      if (sig.err) continue;
      const tx = await chain.getTransaction(sig.signature);
      if (!tx) continue;
      const events = pumpEvents(tx);
      const found = events.find((e) => e.kind === "create" && e.event.mint === mint);
      if (!found || found.kind !== "create") continue;
      create = found.event;
      createSignature = sig.signature;
      createBlockTime = tx.blockTime;
      const user = found.event.user;
      const buy = events.find((e) => e.kind === "trade" && e.event.mint === mint && e.event.user === user && e.event.isBuy);
      initialBuy = buy && buy.kind === "trade" ? buy.event.tokenAmount : 0n;
      break;
    }
  }

  const deployer = create?.user ?? curve.creator;
  if (!deployer) throw new NotPumpTokenError("Could not determine who deployed this token.");

  const info: TokenInfo = {
    mint,
    name: create?.name ?? null,
    symbol: create?.symbol ?? null,
    uri: create?.uri ?? null,
    tokenProgram: create?.tokenProgram ?? null,
    quoteMint: curve.quoteMint,
    deployer,
    creatorCurrent: curve.creator,
    creatorOriginal: create?.creator ?? null,
    createdAt: create?.timestamp ?? createBlockTime,
    createSignature,
    complete: curve.complete,
    isMayhemMode: curve.isMayhemMode || (create?.isMayhemMode ?? false),
    devInitialBuy: initialBuy === null ? null : initialBuy.toString(),
    createTxFound: create !== null,
  };
  return { info, curve };
}
```

Replace `packages/core/src/index.ts` with:
```ts
export * from "./chain";
export * from "./store";
export * from "./config";
export * from "./abort";
export * from "./pda";
export * from "./signatures";
export * from "./cachedChain";
export * from "./tx";
export * from "./pump/constants";
export * from "./pump/borsh";
export * from "./pump/bondingCurve";
export * from "./pump/events";
export * from "./trace/resolveToken";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @pumpfun/core test` → PASS.
Run: `pnpm --filter @pumpfun/core typecheck` → no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): resolve token deployer from creation tx"
```

---
### Task 5: Funding chain trace

**Files:**
- Create: `packages/core/src/trace/funders.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/funders.test.ts`

**Interfaces:**
- Consumes: `ChainSource`, `Store`, `WalletRecord`, `TraceConfig`, `collectSignatures`, `findSolFunding`, `isAbortError` (Tasks 3–4); `ChainNode`, `NodeRole` from `@pumpfun/shared`.
- Produces:
  - `resolveWallet(address: string, chain: ChainSource, store: Store, cfg: TraceConfig, now: number): Promise<WalletRecord>`
  - `traceChain(start: string, role: "deployer" | "creator", chain: ChainSource, store: Store, cfg: TraceConfig, now: number, onNode: (n: ChainNode) => void, signal?: AbortSignal): Promise<ChainNode[]>`
  - Node `depth` is 0 for `start`, then 1..`maxHops` for funders. `chainRoot` = `start`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/funders.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ChainNode } from "@pumpfun/shared";
import { DEFAULT_CONFIG, type TraceConfig } from "../src/config";
import { traceChain } from "../src/trace/funders";
import { FakeChain, MemoryStore, addr, makeTx, systemTransfer } from "../src/testing";

const A = addr(1);
const B = addr(2);
const C = addr(3);
const D = addr(4);
const NOW = 2_000_000_000;
const cfg: TraceConfig = { ...DEFAULT_CONFIG, pageSize: 2, walletMaxPages: 2 };

/** `wallet` first received SOL from `funder` in tx `sig`, then did one more (unfetched) tx. */
function funded(chain: FakeChain, wallet: string, funder: string, sig: string, inner = false) {
  const ix = systemTransfer(funder, wallet, 1_000_000_000);
  const tx = makeTx({ signature: sig, blockTime: 100, ...(inner ? { inner: [ix] } : { instructions: [ix] }) });
  chain.setHistory(wallet, [{ signature: sig, tx }, { signature: `${sig}-later` }]);
}

function busy(chain: FakeChain, wallet: string) {
  chain.setHistory(wallet, Array.from({ length: 5 }, (_, i) => ({ signature: `busy-${i}` })));
}

async function run(chain: FakeChain, store = new MemoryStore(), c = cfg, signal?: AbortSignal) {
  const nodes: ChainNode[] = [];
  await traceChain(A, "deployer", chain, store, c, NOW, (n) => nodes.push(n), signal);
  return nodes;
}

const shape = (nodes: ChainNode[]) => nodes.map((n) => [n.address, n.depth, n.role, n.fundedBy, n.terminal]);

describe("traceChain", () => {
  it("follows first SOL funding up to a high-activity wallet", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    funded(chain, B, C, "fb", true);
    busy(chain, C);
    const nodes = await run(chain);
    expect(shape(nodes)).toEqual([
      [A, 0, "deployer", B, null],
      [B, 1, "funder", C, null],
      [C, 2, "funder", null, "high_activity"],
    ]);
    expect(nodes[0]).toMatchObject({ chainRoot: A, fundingAmountLamports: "1000000000", fundingSignature: "fa", fundedAt: 100 });
  });

  it("stops with unknown_origin when no SOL transfer funded the wallet", async () => {
    const chain = new FakeChain();
    chain.setHistory(A, [{ signature: "x", tx: makeTx({ signature: "x", instructions: [systemTransfer(A, D, 5)] }) }]);
    expect(shape(await run(chain))).toEqual([[A, 0, "deployer", null, "unknown_origin"]]);
  });

  it("stops on a funding loop", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    funded(chain, B, A, "fb");
    expect(shape(await run(chain))).toEqual([
      [A, 0, "deployer", B, null],
      [B, 1, "funder", A, "loop"],
    ]);
  });

  it("stops at maxHops", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    funded(chain, B, C, "fb");
    expect(shape(await run(chain, new MemoryStore(), { ...cfg, maxHops: 1 }))).toEqual([
      [A, 0, "deployer", B, null],
      [B, 1, "funder", C, "max_depth"],
    ]);
  });

  it("serves repeat traces from the store without RPC calls", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    funded(chain, B, C, "fb");
    busy(chain, C);
    const store = new MemoryStore();
    await run(chain, store);
    const before = chain.calls.length;
    await run(chain, store);
    expect(chain.calls.length).toBe(before);
  });

  it("marks a node incomplete on RPC failure and does not cache it", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    chain.failTx.add("fa");
    const store = new MemoryStore();
    expect(shape(await run(chain, store))).toEqual([[A, 0, "deployer", null, "incomplete"]]);
    expect(store.getWallet(A)).toBeNull();
  });

  it("rethrows aborts", async () => {
    const chain = new FakeChain();
    funded(chain, A, B, "fa");
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(run(chain, new MemoryStore(), cfg, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pumpfun/core test -- funders`
Expected: FAIL (cannot resolve `../src/trace/funders`).

- [ ] **Step 3: Implement**

`packages/core/src/trace/funders.ts`:
```ts
import type { ChainNode } from "@pumpfun/shared";
import { isAbortError } from "../abort";
import type { ChainSource } from "../chain";
import type { TraceConfig } from "../config";
import { collectSignatures } from "../signatures";
import type { Store, WalletRecord } from "../store";
import { findSolFunding } from "../tx";

const HIGH_ACTIVITY_RECHECK_SEC = 30 * 86_400;

/** Finds who sent this wallet its first SOL. Results are cached in the store. */
export async function resolveWallet(
  address: string,
  chain: ChainSource,
  store: Store,
  cfg: TraceConfig,
  now: number,
): Promise<WalletRecord> {
  const cached = store.getWallet(address);
  if (cached) {
    const stale = cached.terminal === "high_activity" && now - cached.fetchedAt > HIGH_ACTIVITY_RECHECK_SEC;
    if (!stale) return cached;
  }

  const base: WalletRecord = {
    address,
    funderResolved: false,
    funder: null,
    fundingSignature: null,
    fundingAmountLamports: null,
    fundedAt: null,
    terminal: null,
    fetchedAt: now,
  };

  const { sigs, complete } = await collectSignatures(chain, address, cfg.walletMaxPages, cfg.pageSize);
  let record: WalletRecord;
  if (!complete) {
    record = { ...base, terminal: "high_activity" };
  } else {
    const oldestFirst = sigs.slice(-cfg.oldestTxScan).reverse().filter((s) => !s.err);
    record = { ...base, terminal: "unknown_origin" };
    for (const sig of oldestFirst) {
      const tx = await chain.getTransaction(sig.signature);
      if (!tx) continue;
      const funding = findSolFunding(tx, address);
      if (!funding) continue;
      record = {
        ...base,
        funderResolved: true,
        funder: funding.from,
        fundingSignature: funding.signature,
        fundingAmountLamports: funding.lamports.toString(),
        fundedAt: funding.blockTime,
      };
      break;
    }
  }
  store.putWallet(record);
  return record;
}

export async function traceChain(
  start: string,
  role: "deployer" | "creator",
  chain: ChainSource,
  store: Store,
  cfg: TraceConfig,
  now: number,
  onNode: (node: ChainNode) => void,
  signal?: AbortSignal,
): Promise<ChainNode[]> {
  const nodes: ChainNode[] = [];
  const seen = new Set<string>();
  let current = start;
  let depth = 0;

  for (;;) {
    signal?.throwIfAborted();
    seen.add(current);

    let record: WalletRecord | null = null;
    try {
      record = await resolveWallet(current, chain, store, cfg, now);
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
    }

    const node: ChainNode = {
      address: current,
      depth,
      role: depth === 0 ? role : "funder",
      chainRoot: start,
      fundedBy: record?.funder ?? null,
      fundingAmountLamports: record?.fundingAmountLamports ?? null,
      fundedAt: record?.fundedAt ?? null,
      fundingSignature: record?.fundingSignature ?? null,
      terminal: record ? record.terminal : "incomplete",
    };
    if (record?.funder && !node.terminal) {
      if (depth >= cfg.maxHops) node.terminal = "max_depth";
      else if (seen.has(record.funder)) node.terminal = "loop";
    }

    nodes.push(node);
    onNode(node);
    if (node.terminal || !record?.funder) return nodes;
    current = record.funder;
    depth++;
  }
}
```

Add to `packages/core/src/index.ts` (after the `resolveToken` line):
```ts
export * from "./trace/funders";
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @pumpfun/core test` → PASS.
Run: `pnpm --filter @pumpfun/core typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): trace dev funding chain"
```

---

### Task 6: Dev history and dev status

**Files:**
- Create: `packages/core/src/trace/devActivity.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/devActivity.test.ts`

**Interfaces:**
- Consumes: `ChainSource`, `TraceConfig`, `pumpEvents`, `tokenDeltas`, `lamportDelta`, `ownerGainedOtherToken`, `bondingCurvePda`, `decodeBondingCurve` (Tasks 2–4); `TokenInfo`, `DevToken`, `DevStatus` from `@pumpfun/shared`.
- Produces: `interface DevActivity { history: DevToken[]; historyPartial: boolean; status: DevStatus }`, `analyzeDev(token: TokenInfo, chain: ChainSource, cfg: TraceConfig, now: number): Promise<DevActivity>`.
- Rules: history = other tokens whose `CreateEvent.user` is the deployer, found in the deployer's `cfg.devTxScan` most recent transactions, newest first. Status `migrated` if curve `complete`; `dead_dev_exited` if older than 24 h and dev balance < 1% of initial buy (or 0 when initial buy is 0); else `alive`. Dev status: per transaction after creation, dev's token balance down + dev gained SOL or another token = sell; down + other owners gained the mint = transfer-out; up = buy.

- [ ] **Step 1: Write the failing test**

`packages/core/test/devActivity.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { TokenInfo } from "@pumpfun/shared";
import { DEFAULT_CONFIG } from "../src/config";
import { bondingCurvePda } from "../src/pda";
import { PUMP_PROGRAM_ID } from "../src/pump/constants";
import { analyzeDev } from "../src/trace/devActivity";
import {
  FakeChain,
  addr,
  encodeBondingCurve,
  encodeCreateEvent,
  encodeTradeEvent,
  makeTx,
  pumpEventIx,
  tokenBal,
} from "../src/testing";

const DEV = addr(10);
const MINT = addr(20);
const OLD_DEAD = addr(21);
const OLD_MIGRATED = addr(22);
const YOUNG = addr(23);
const FRIEND = addr(30);
const NOW = 1_800_000_000;
const CREATED = NOW - 7200;
const DAY = 86_400;

function createTx(sig: string, mint: string, ts: number, buy: bigint) {
  return makeTx({
    signature: sig,
    blockTime: ts,
    inner: [
      pumpEventIx(encodeCreateEvent({ name: `Name ${sig}`, symbol: sig.toUpperCase(), uri: "u", mint, bondingCurve: addr(99), user: DEV, creator: DEV, timestamp: ts })),
      pumpEventIx(encodeTradeEvent({ mint, solAmount: 1n, tokenAmount: buy, isBuy: true, user: DEV, timestamp: ts })),
    ],
  });
}

async function world() {
  const chain = new FakeChain();
  for (const [mint, complete] of [[OLD_DEAD, false], [OLD_MIGRATED, true], [YOUNG, false]] as const) {
    const pda = await bondingCurvePda(mint);
    chain.accounts.set(pda, { address: pda, owner: PUMP_PROGRAM_ID, data: encodeBondingCurve({ complete, creator: DEV }) });
  }
  chain.setHistory(DEV, [
    { signature: "c21", tx: createTx("c21", OLD_DEAD, NOW - 10 * DAY, 1000n) },
    { signature: "c22", tx: createTx("c22", OLD_MIGRATED, NOW - 5 * DAY, 500n) },
    { signature: "cMain", tx: createTx("cMain", MINT, CREATED, 1000n) },
    { signature: "c23", tx: createTx("c23", YOUNG, NOW - 3600, 100n) },
    {
      signature: "s1",
      tx: makeTx({
        signature: "s1",
        blockTime: CREATED + 600,
        accountKeys: [DEV, addr(98)],
        preBalances: [1_000_000_000, 0],
        postBalances: [2_000_000_000, 0],
        preTokenBalances: [tokenBal(1, MINT, DEV, 1000)],
        postTokenBalances: [tokenBal(1, MINT, DEV, 600)],
      }),
    },
    {
      signature: "x1",
      tx: makeTx({
        signature: "x1",
        blockTime: CREATED + 900,
        accountKeys: [DEV, FRIEND],
        preBalances: [2_000_000_000, 0],
        postBalances: [1_990_000_000, 2_000_000],
        preTokenBalances: [tokenBal(1, MINT, DEV, 600)],
        postTokenBalances: [tokenBal(1, MINT, DEV, 400), tokenBal(2, MINT, FRIEND, 200)],
      }),
    },
    {
      signature: "b1",
      tx: makeTx({
        signature: "b1",
        blockTime: CREATED + 1200,
        accountKeys: [DEV],
        preBalances: [1_990_000_000],
        postBalances: [1_900_000_000],
        preTokenBalances: [tokenBal(1, MINT, DEV, 400)],
        postTokenBalances: [tokenBal(1, MINT, DEV, 450)],
      }),
    },
  ]);
  chain.holdings.set(DEV, [
    { mint: MINT, amount: "450" },
    { mint: OLD_DEAD, amount: "5" },
    { mint: YOUNG, amount: "100" },
  ]);
  return chain;
}

const token: TokenInfo = {
  mint: MINT,
  name: "Main",
  symbol: "MAIN",
  uri: null,
  tokenProgram: null,
  quoteMint: null,
  deployer: DEV,
  creatorCurrent: DEV,
  creatorOriginal: DEV,
  createdAt: CREATED,
  createSignature: "cMain",
  complete: false,
  isMayhemMode: false,
  devInitialBuy: "1000",
  createTxFound: true,
};

describe("analyzeDev", () => {
  it("lists the dev's other launches with status, newest first", async () => {
    const { history, historyPartial } = await analyzeDev(token, await world(), DEFAULT_CONFIG, NOW);
    expect(history.map((t) => [t.mint, t.status, t.initialBuy, t.devBalance])).toEqual([
      [YOUNG, "alive", "100", "100"],
      [OLD_MIGRATED, "migrated", "500", "0"],
      [OLD_DEAD, "dead_dev_exited", "1000", "5"],
    ]);
    expect(history[0]).toMatchObject({ symbol: "C23", createdAt: NOW - 3600, complete: false });
    expect(historyPartial).toBe(false);
  });

  it("classifies sells, transfer-outs and buys after launch", async () => {
    const { status } = await analyzeDev(token, await world(), DEFAULT_CONFIG, NOW);
    expect(status).toEqual({
      initialBuy: "1000",
      bought: "50",
      sold: "400",
      transferredOut: "200",
      balance: "450",
      releasedPct: 57.14,
      transfers: [{ to: FRIEND, amount: "200", signature: "x1" }],
      partial: false,
    });
  });

  it("flags partial results when the scan does not reach the launch", async () => {
    const { history, historyPartial, status } = await analyzeDev(token, await world(), { ...DEFAULT_CONFIG, devTxScan: 2 }, NOW);
    expect(history).toEqual([]);
    expect(historyPartial).toBe(true);
    expect(status.partial).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pumpfun/core test -- devActivity`
Expected: FAIL (cannot resolve `../src/trace/devActivity`).

- [ ] **Step 3: Implement**

`packages/core/src/trace/devActivity.ts`:
```ts
import type { DevStatus, DevToken, TokenInfo } from "@pumpfun/shared";
import type { AccountData, ChainSource, ParsedTx, SignatureInfo } from "../chain";
import type { TraceConfig } from "../config";
import { bondingCurvePda } from "../pda";
import { decodeBondingCurve } from "../pump/bondingCurve";
import type { CreateEvent } from "../pump/events";
import { lamportDelta, ownerGainedOtherToken, pumpEvents, tokenDeltas } from "../tx";

export interface DevActivity {
  history: DevToken[];
  historyPartial: boolean;
  status: DevStatus;
}

interface DevTx {
  sig: SignatureInfo;
  tx: ParsedTx;
}

const DAY = 86_400;

export async function analyzeDev(token: TokenInfo, chain: ChainSource, cfg: TraceConfig, now: number): Promise<DevActivity> {
  const sigs = await chain.getSignatures(token.deployer, { limit: cfg.devTxScan });
  const txs: DevTx[] = [];
  for (const sig of sigs) {
    if (sig.err) continue;
    const tx = await chain.getTransaction(sig.signature);
    if (tx) txs.push({ sig, tx });
  }
  const holdings = await chain.getTokenHoldings(token.deployer);
  const balances = new Map(holdings.map((h) => [h.mint, BigInt(h.amount)]));
  const scannedAll = sigs.length < cfg.devTxScan;

  return {
    history: await buildHistory(token, txs, balances, chain, now),
    historyPartial: !scannedAll,
    status: buildStatus(token, txs, balances, scannedAll),
  };
}

async function buildHistory(
  token: TokenInfo,
  txs: DevTx[],
  balances: Map<string, bigint>,
  chain: ChainSource,
  now: number,
): Promise<DevToken[]> {
  const dev = token.deployer;
  const created = new Map<string, { ev: CreateEvent; createdAt: number | null; initialBuy: bigint }>();
  for (const { tx } of txs) {
    const events = pumpEvents(tx);
    for (const e of events) {
      if (e.kind !== "create" || e.event.user !== dev || e.event.mint === token.mint) continue;
      const mint = e.event.mint;
      const buy = events.find((t) => t.kind === "trade" && t.event.mint === mint && t.event.user === dev && t.event.isBuy);
      created.set(mint, {
        ev: e.event,
        createdAt: e.event.timestamp ?? tx.blockTime,
        initialBuy: buy && buy.kind === "trade" ? buy.event.tokenAmount : 0n,
      });
    }
  }

  const mints = [...created.keys()];
  const pdas = await Promise.all(mints.map((m) => bondingCurvePda(m)));
  const accounts: (AccountData | null)[] = [];
  for (let i = 0; i < pdas.length; i += 100) accounts.push(...(await chain.getAccounts(pdas.slice(i, i + 100))));

  return mints
    .map((mint, i): DevToken => {
      const { ev, createdAt, initialBuy } = created.get(mint)!;
      const account = accounts[i];
      const complete = account ? decodeBondingCurve(account.data).complete : false;
      const balance = balances.get(mint) ?? 0n;
      const age = createdAt === null ? 0 : now - createdAt;
      const exited = initialBuy > 0n ? balance * 100n < initialBuy : balance === 0n;
      const status: DevToken["status"] = complete ? "migrated" : age > DAY && exited ? "dead_dev_exited" : "alive";
      return {
        mint,
        name: ev.name,
        symbol: ev.symbol,
        createdAt,
        complete,
        devBalance: balance.toString(),
        initialBuy: initialBuy.toString(),
        status,
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function buildStatus(token: TokenInfo, txs: DevTx[], balances: Map<string, bigint>, scannedAll: boolean): DevStatus {
  const dev = token.deployer;
  let sold = 0n;
  let transferredOut = 0n;
  let bought = 0n;
  const transfers: DevStatus["transfers"] = [];
  let reachedLaunch = scannedAll || token.createdAt === null;

  for (const { sig, tx } of txs) {
    const time = sig.blockTime ?? tx.blockTime ?? 0;
    if (token.createdAt !== null && time <= token.createdAt) reachedLaunch = true;
    if (sig.signature === token.createSignature) continue;
    if (token.createdAt !== null && time < token.createdAt) continue;

    const deltas = tokenDeltas(tx, token.mint);
    const d = deltas.get(dev) ?? 0n;
    if (d > 0n) bought += d;
    if (d >= 0n) continue;

    if (lamportDelta(tx, dev) > 0n || ownerGainedOtherToken(tx, dev, token.mint)) {
      sold += -d;
      continue;
    }
    const receivers = [...deltas].filter(([owner, v]) => owner !== dev && v > 0n);
    if (receivers.length === 0) {
      sold += -d;
      continue;
    }
    transferredOut += -d;
    for (const [to, amount] of receivers) transfers.push({ to, amount: amount.toString(), signature: sig.signature });
  }

  const initialBuy = token.devInitialBuy === null ? null : BigInt(token.devInitialBuy);
  const base = (initialBuy ?? 0n) + bought;
  const released = sold + transferredOut;
  return {
    initialBuy: initialBuy === null ? null : initialBuy.toString(),
    bought: bought.toString(),
    sold: sold.toString(),
    transferredOut: transferredOut.toString(),
    balance: (balances.get(token.mint) ?? 0n).toString(),
    releasedPct: base > 0n ? Number((released * 10_000n) / base) / 100 : null,
    transfers,
    partial: !reachedLaunch,
  };
}
```

Add to `packages/core/src/index.ts`:
```ts
export * from "./trace/devActivity";
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @pumpfun/core test` → PASS.
Run: `pnpm --filter @pumpfun/core typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): dev launch history and sell/transfer status"
```

---

### Task 7: Risk score

**Files:**
- Create: `packages/core/src/score.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/score.test.ts`

**Interfaces:**
- Consumes: `TaintedFunder` (Task 4); `TokenInfo`, `ChainNode`, `DevToken`, `DevStatus`, `RiskScore`, `RiskFactor`, `formatTokenAmount`, `shortAddress` from `@pumpfun/shared`.
- Produces: `RISK_WEIGHTS = { serialDeadDev: 30, devReleased: 25, devTransferOut: 15, freshFunding: 10, taintedFunder: 20 }`, `interface ScoreInput { token: TokenInfo; nodes: ChainNode[]; devHistory: DevToken[]; devStatus: DevStatus | null; taintedFunders: TaintedFunder[]; incomplete: boolean }`, `riskLevel(score: number): RiskLevel`, `computeScore(input: ScoreInput): RiskScore`. Factor ids (in this order): `serialDeadDev`, `devReleased`, `devTransferOut`, `freshFunding`, `taintedFunder`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/score.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ChainNode, DevStatus, DevToken, TokenInfo } from "@pumpfun/shared";
import { computeScore, riskLevel, type ScoreInput } from "../src/score";

const token: TokenInfo = {
  mint: "MINT",
  name: null,
  symbol: null,
  uri: null,
  tokenProgram: null,
  quoteMint: null,
  deployer: "DEV",
  creatorCurrent: "DEV",
  creatorOriginal: "DEV",
  createdAt: 10_000,
  createSignature: "c",
  complete: false,
  isMayhemMode: false,
  devInitialBuy: "1000",
  createTxFound: true,
};

const base: ScoreInput = { token, nodes: [], devHistory: [], devStatus: null, taintedFunders: [], incomplete: false };

const devToken = (status: DevToken["status"]): DevToken => ({
  mint: Math.random().toString(),
  name: null,
  symbol: null,
  createdAt: 1,
  complete: status === "migrated",
  devBalance: "0",
  initialBuy: "1",
  status,
});

const devStatus = (over: Partial<DevStatus>): DevStatus => ({
  initialBuy: "1000",
  bought: "0",
  sold: "0",
  transferredOut: "0",
  balance: "1000",
  releasedPct: 0,
  transfers: [],
  partial: false,
  ...over,
});

const deployerNode = (fundedAt: number): ChainNode => ({
  address: "DEV",
  depth: 0,
  role: "deployer",
  chainRoot: "DEV",
  fundedBy: "F",
  fundingAmountLamports: "1",
  fundedAt,
  fundingSignature: "s",
  terminal: null,
});

describe("riskLevel", () => {
  it("maps score bands", () => {
    expect([riskLevel(0), riskLevel(29), riskLevel(30), riskLevel(59), riskLevel(60)]).toEqual(["low", "low", "medium", "medium", "high"]);
  });
});

describe("computeScore", () => {
  it("is zero with no red flags", () => {
    expect(computeScore(base)).toEqual({ score: 0, level: "low", factors: [], incomplete: false });
  });

  it("flags a serial dev whose launches mostly died", () => {
    const s = computeScore({ ...base, devHistory: [devToken("dead_dev_exited"), devToken("dead_dev_exited"), devToken("alive"), devToken("migrated")] });
    expect(s.factors).toEqual([{ id: "serialDeadDev", points: 30, reason: "Dev launched 4 other tokens; 2 died with the dev exiting." }]);
    expect(s.level).toBe("medium");
  });

  it("needs at least 3 previous launches for the serial flag", () => {
    expect(computeScore({ ...base, devHistory: [devToken("dead_dev_exited"), devToken("dead_dev_exited")] }).factors).toEqual([]);
  });

  it("flags released supply and transfer-outs", () => {
    const s = computeScore({
      ...base,
      devStatus: devStatus({
        releasedPct: 70,
        transferredOut: "100000000",
        transfers: [
          { to: "W1", amount: "60000000", signature: "a" },
          { to: "W1", amount: "40000000", signature: "b" },
        ],
      }),
    });
    expect(s.factors.map((f) => f.reason)).toEqual([
      "Dev has sold or moved 70% of their tokens.",
      "Dev moved 100 tokens to 1 other wallet.",
    ]);
    expect(s.score).toBe(40);
  });

  it("flags a dev wallet funded less than an hour before launch", () => {
    const s = computeScore({ ...base, nodes: [deployerNode(10_000 - 720)] });
    expect(s.factors).toEqual([{ id: "freshFunding", points: 10, reason: "Dev wallet was funded 12 minutes before launch." }]);
  });

  it("ignores funding older than an hour", () => {
    expect(computeScore({ ...base, nodes: [deployerNode(10_000 - 4000)] }).factors).toEqual([]);
  });

  it("flags funders linked to dead tokens", () => {
    const s = computeScore({
      ...base,
      taintedFunders: [
        { wallet: "OtherWallet22222", deadCount: 1 },
        { wallet: "FunderWallet1111", deadCount: 3 },
      ],
    });
    expect(s.factors).toEqual([
      { id: "taintedFunder", points: 20, reason: "Funder Fund…1111 is linked to 3 dead tokens (+1 more flagged funder)." },
    ]);
  });

  it("caps at 100 and carries the incomplete flag", () => {
    const s = computeScore({
      token,
      nodes: [deployerNode(10_000 - 60)],
      devHistory: [devToken("dead_dev_exited"), devToken("dead_dev_exited"), devToken("dead_dev_exited")],
      devStatus: devStatus({ releasedPct: 100, transferredOut: "5", transfers: [{ to: "W", amount: "5", signature: "x" }] }),
      taintedFunders: [{ wallet: "F", deadCount: 1 }],
      incomplete: true,
    });
    expect(s).toMatchObject({ score: 100, level: "high", incomplete: true });
    expect(s.factors.map((f) => f.id)).toEqual(["serialDeadDev", "devReleased", "devTransferOut", "freshFunding", "taintedFunder"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pumpfun/core test -- score`
Expected: FAIL (cannot resolve `../src/score`).

- [ ] **Step 3: Implement**

`packages/core/src/score.ts`:
```ts
import {
  formatTokenAmount,
  shortAddress,
  type ChainNode,
  type DevStatus,
  type DevToken,
  type RiskFactor,
  type RiskLevel,
  type RiskScore,
  type TokenInfo,
} from "@pumpfun/shared";
import type { TaintedFunder } from "./store";

/** Calibrate here. Spec section 6.6. */
export const RISK_WEIGHTS = {
  serialDeadDev: 30,
  devReleased: 25,
  devTransferOut: 15,
  freshFunding: 10,
  taintedFunder: 20,
} as const;

export interface ScoreInput {
  token: TokenInfo;
  nodes: ChainNode[];
  devHistory: DevToken[];
  devStatus: DevStatus | null;
  taintedFunders: TaintedFunder[];
  incomplete: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function riskLevel(score: number): RiskLevel {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function computeScore(input: ScoreInput): RiskScore {
  const { token, nodes, devHistory, devStatus, taintedFunders } = input;
  const factors: RiskFactor[] = [];

  const dead = devHistory.filter((t) => t.status === "dead_dev_exited").length;
  if (devHistory.length >= 3 && dead / devHistory.length >= 0.5) {
    factors.push({
      id: "serialDeadDev",
      points: RISK_WEIGHTS.serialDeadDev,
      reason: `Dev launched ${plural(devHistory.length, "other token")}; ${dead} died with the dev exiting.`,
    });
  }

  if (devStatus?.releasedPct != null && devStatus.releasedPct >= 50) {
    factors.push({
      id: "devReleased",
      points: RISK_WEIGHTS.devReleased,
      reason: `Dev has sold or moved ${Math.round(devStatus.releasedPct)}% of their tokens.`,
    });
  }

  if (devStatus && BigInt(devStatus.transferredOut) > 0n) {
    const receivers = new Set(devStatus.transfers.map((t) => t.to)).size;
    factors.push({
      id: "devTransferOut",
      points: RISK_WEIGHTS.devTransferOut,
      reason: `Dev moved ${formatTokenAmount(devStatus.transferredOut)} tokens to ${plural(receivers, "other wallet")}.`,
    });
  }

  const deployer = nodes.find((n) => n.role === "deployer");
  if (deployer?.fundedAt != null && token.createdAt != null) {
    const gap = token.createdAt - deployer.fundedAt;
    if (gap >= 0 && gap < 3600) {
      factors.push({
        id: "freshFunding",
        points: RISK_WEIGHTS.freshFunding,
        reason: `Dev wallet was funded ${plural(Math.max(1, Math.round(gap / 60)), "minute")} before launch.`,
      });
    }
  }

  if (taintedFunders.length > 0) {
    const worst = [...taintedFunders].sort((a, b) => b.deadCount - a.deadCount)[0]!;
    const extra = taintedFunders.length - 1;
    const more = extra > 0 ? ` (+${extra} more flagged funder${extra === 1 ? "" : "s"})` : "";
    factors.push({
      id: "taintedFunder",
      points: RISK_WEIGHTS.taintedFunder,
      reason: `Funder ${shortAddress(worst.wallet)} is linked to ${plural(worst.deadCount, "dead token")}${more}.`,
    });
  }

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  return { score, level: riskLevel(score), factors, incomplete: input.incomplete };
}
```

Add to `packages/core/src/index.ts`:
```ts
export * from "./score";
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @pumpfun/core test` → PASS.
Run: `pnpm --filter @pumpfun/core typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): heuristic risk score"
```

---

### Task 8: Trace orchestrator + shared test scenario

**Files:**
- Create: `packages/core/src/runTrace.ts`, `packages/core/src/testing/scenario.ts`
- Modify: `packages/core/src/testing/index.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/runTrace.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces:
  - `interface TraceDeps { chain: ChainSource; store: Store; emit: (e: TraceEvent) => void; now?: () => number; signal?: AbortSignal; config?: Partial<TraceConfig> }`
  - `runTrace(mint: string, deps: TraceDeps): Promise<TraceResult>`. Throws `NotPumpTokenError` (or the RPC error) when the token step fails; every later step failure is caught, emitted as `step … incomplete`, and sets `partial`. Event order: `step token running`, `token`, `step token done`, then per step `step running`, payload events, `step done|incomplete`; then `score`; last event `done`.
  - testing: `interface Scenario { chain: FakeChain; mint; deployer; funder; insider: string; now: number; createdAt: number }`, `createScenario(): Promise<Scenario>`. Expected result for the scenario: score 50 (`devReleased`, `devTransferOut`, `freshFunding`), deployer funded by funder, funder `unknown_origin`, dev sold 600 and moved 100 of 1000.

- [ ] **Step 1: Write the scenario helper**

`packages/core/src/testing/scenario.ts`:
```ts
import { bondingCurvePda } from "../pda";
import { PUMP_PROGRAM_ID } from "../pump/constants";
import { addr, encodeBondingCurve, encodeCreateEvent, encodeTradeEvent } from "./encode";
import { FakeChain } from "./fakeChain";
import { makeTx, pumpEventIx, systemTransfer, tokenBal } from "./tx";

export interface Scenario {
  chain: FakeChain;
  mint: string;
  deployer: string;
  funder: string;
  insider: string;
  now: number;
  createdAt: number;
}

/**
 * One token, deployed by a wallet funded 10 minutes before launch.
 * The dev bought 1000, sold 600, moved 100 to an insider, holds 300.
 */
export async function createScenario(): Promise<Scenario> {
  const chain = new FakeChain();
  const mint = addr(20);
  const deployer = addr(10);
  const funder = addr(11);
  const insider = addr(30);
  const now = 1_800_000_000;
  const createdAt = now - 7200;
  const curve = await bondingCurvePda(mint);

  chain.accounts.set(curve, { address: curve, owner: PUMP_PROGRAM_ID, data: encodeBondingCurve({ complete: false, creator: deployer }) });

  const createTx = makeTx({
    signature: "create-main",
    blockTime: createdAt,
    accountKeys: [deployer],
    inner: [
      pumpEventIx(encodeCreateEvent({ name: "Test Coin", symbol: "TEST", uri: "https://example.com/meta.json", mint, bondingCurve: curve, user: deployer, creator: deployer, timestamp: createdAt })),
      pumpEventIx(encodeTradeEvent({ mint, solAmount: 1_000_000_000n, tokenAmount: 1000n, isBuy: true, user: deployer, timestamp: createdAt })),
    ],
  });
  chain.setHistory(mint, [{ signature: "create-main", tx: createTx }]);

  const fundTx = makeTx({ signature: "fund-dev", blockTime: createdAt - 600, instructions: [systemTransfer(funder, deployer, 2_000_000_000)] });
  const sellTx = makeTx({
    signature: "sell-1",
    blockTime: createdAt + 600,
    accountKeys: [deployer, curve],
    preBalances: [1_000_000_000, 0],
    postBalances: [1_500_000_000, 0],
    preTokenBalances: [tokenBal(1, mint, deployer, 1000)],
    postTokenBalances: [tokenBal(1, mint, deployer, 400)],
  });
  const moveTx = makeTx({
    signature: "move-1",
    blockTime: createdAt + 900,
    accountKeys: [deployer, insider],
    preBalances: [1_500_000_000, 0],
    postBalances: [1_490_000_000, 2_000_000],
    preTokenBalances: [tokenBal(2, mint, deployer, 400)],
    postTokenBalances: [tokenBal(2, mint, deployer, 300), tokenBal(3, mint, insider, 100)],
  });
  chain.setHistory(deployer, [
    { signature: "fund-dev", tx: fundTx },
    { signature: "create-main", tx: createTx },
    { signature: "sell-1", tx: sellTx },
    { signature: "move-1", tx: moveTx },
  ]);

  const funderTx = makeTx({ signature: "funder-own", blockTime: createdAt - 86_400, instructions: [systemTransfer(funder, addr(40), 1_000_000)] });
  chain.setHistory(funder, [{ signature: "funder-own", tx: funderTx }]);

  chain.holdings.set(deployer, [{ mint, amount: "300" }]);
  return { chain, mint, deployer, funder, insider, now, createdAt };
}
```

Replace `packages/core/src/testing/index.ts` with:
```ts
export * from "./encode";
export * from "./tx";
export * from "./fakeChain";
export * from "./memoryStore";
export * from "./scenario";
```

- [ ] **Step 2: Write the failing test**

`packages/core/test/runTrace.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@pumpfun/shared";
import { runTrace } from "../src/runTrace";
import { NotPumpTokenError } from "../src/trace/resolveToken";
import { MemoryStore, addr, createScenario } from "../src/testing";

async function trace(opts: { store?: MemoryStore; signal?: AbortSignal; mutate?: (s: Awaited<ReturnType<typeof createScenario>>) => void } = {}) {
  const s = await createScenario();
  opts.mutate?.(s);
  const store = opts.store ?? new MemoryStore();
  const events: TraceEvent[] = [];
  const result = await runTrace(s.mint, { chain: s.chain, store, emit: (e) => events.push(e), now: () => s.now, signal: opts.signal });
  return { s, store, events, result };
}

describe("runTrace", () => {
  it("streams events and returns a scored result", async () => {
    const store = new MemoryStore();
    const s0 = await createScenario();
    store.crosslinks = [{ wallet: s0.funder, role: "funder", otherMint: addr(77), otherSymbol: "OTHER" }];
    const { s, events, result } = await trace({ store });

    expect(result.token.deployer).toBe(s.deployer);
    expect(result.nodes.map((n) => [n.address, n.role, n.terminal])).toEqual([
      [s.deployer, "deployer", null],
      [s.funder, "funder", "unknown_origin"],
    ]);
    expect(result.devStatus).toMatchObject({ sold: "600", transferredOut: "100", releasedPct: 70, partial: false });
    expect(result.crosslinks).toEqual(store.crosslinks);
    expect(result.score).toMatchObject({ score: 50, level: "medium", incomplete: false });
    expect(result.score.factors.map((f) => f.id)).toEqual(["devReleased", "devTransferOut", "freshFunding"]);
    expect(result.partial).toBe(false);

    const types = events.map((e) => e.type);
    expect(events[0]).toEqual({ type: "step", data: { step: "token", state: "running" } });
    expect(types.filter((t) => t === "node")).toHaveLength(2);
    expect(types.indexOf("token")).toBeLessThan(types.indexOf("node"));
    expect(types.indexOf("score")).toBeLessThan(types.indexOf("done"));
    expect(events.at(-1)).toEqual({ type: "done", data: { partial: false } });
  });

  it("adds the tainted-funder factor from the store", async () => {
    const s0 = await createScenario();
    const store = new MemoryStore();
    store.tainted = [{ wallet: s0.funder, deadCount: 2 }];
    const { result } = await trace({ store });
    expect(result.score.factors.map((f) => f.id)).toContain("taintedFunder");
    expect(result.score).toMatchObject({ score: 70, level: "high" });
  });

  it("marks a failed step incomplete and keeps going", async () => {
    const { events, result } = await trace({ mutate: (s) => s.chain.failTx.add("sell-1") });
    expect(events).toContainEqual({ type: "step", data: { step: "devActivity", state: "incomplete" } });
    expect(result.devStatus).toBeNull();
    expect(result.partial).toBe(true);
    expect(result.score.incomplete).toBe(true);
    expect(result.nodes).toHaveLength(2);
  });

  it("returns a partial result when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { events, result } = await trace({ signal: ctrl.signal });
    expect(result.partial).toBe(true);
    expect(result.nodes).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "done", data: { partial: true } });
  });

  it("rejects tokens that are not pump.fun tokens", async () => {
    const s = await createScenario();
    await expect(
      runTrace(addr(99), { chain: s.chain, store: new MemoryStore(), emit: () => {}, now: () => s.now }),
    ).rejects.toBeInstanceOf(NotPumpTokenError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @pumpfun/core test -- runTrace`
Expected: FAIL (cannot resolve `../src/runTrace`).

- [ ] **Step 4: Implement**

`packages/core/src/runTrace.ts`:
```ts
import type { ChainNode, Crosslink, StepName, TraceEvent, TraceResult } from "@pumpfun/shared";
import { withTxCache } from "./cachedChain";
import type { ChainSource } from "./chain";
import { DEFAULT_CONFIG, type TraceConfig } from "./config";
import { computeScore } from "./score";
import type { Store } from "./store";
import { analyzeDev, type DevActivity } from "./trace/devActivity";
import { traceChain } from "./trace/funders";
import { resolveToken } from "./trace/resolveToken";

export interface TraceDeps {
  chain: ChainSource;
  store: Store;
  emit: (event: TraceEvent) => void;
  now?: () => number;
  signal?: AbortSignal;
  config?: Partial<TraceConfig>;
}

export async function runTrace(mint: string, deps: TraceDeps): Promise<TraceResult> {
  const cfg: TraceConfig = { ...DEFAULT_CONFIG, ...deps.config };
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const { emit, store, signal } = deps;
  const chain = withTxCache(deps.chain, store);
  let partial = false;

  const mark = (step: StepName, state: "running" | "done" | "incomplete") => emit({ type: "step", data: { step, state } });

  async function step<T>(name: StepName, fallback: T, fn: () => Promise<T> | T): Promise<T> {
    if (signal?.aborted) {
      partial = true;
      mark(name, "incomplete");
      return fallback;
    }
    mark(name, "running");
    try {
      const value = await fn();
      mark(name, "done");
      return value;
    } catch {
      partial = true;
      mark(name, "incomplete");
      return fallback;
    }
  }

  mark("token", "running");
  const { info: token } = await resolveToken(mint, chain, cfg);
  emit({ type: "token", data: token });
  mark("token", "done");

  const nodes: ChainNode[] = [];
  const onNode = (node: ChainNode) => {
    nodes.push(node);
    emit({ type: "node", data: node });
  };
  await step("funders", undefined, async () => {
    await traceChain(token.deployer, "deployer", chain, store, cfg, now(), onNode, signal);
    if (token.creatorCurrent && token.creatorCurrent !== token.deployer) {
      await traceChain(token.creatorCurrent, "creator", chain, store, cfg, now(), onNode, signal);
    }
  });

  const dev = await step<DevActivity | null>("devActivity", null, () => analyzeDev(token, chain, cfg, now()));
  const devHistory = dev?.history ?? [];
  const devHistoryPartial = dev ? dev.historyPartial : true;
  const devStatus = dev?.status ?? null;
  emit({ type: "devHistory", data: { tokens: devHistory, partial: devHistoryPartial } });
  if (devStatus) emit({ type: "devStatus", data: devStatus });

  // Exchange-like wallets link everything to everything, so they never count as links.
  const linkable = nodes.filter((n) => n.terminal !== "high_activity").map((n) => n.address);
  const insiders = devStatus?.transfers.map((t) => t.to) ?? [];
  const crosslinks = await step<Crosslink[]>("crosslinks", [], () =>
    store.findCrosslinks([...new Set([...linkable, ...insiders])], mint),
  );
  emit({ type: "crosslinks", data: crosslinks });

  mark("score", "running");
  const funders = nodes.filter((n) => n.role === "funder" && n.terminal !== "high_activity").map((n) => n.address);
  let taintedFunders: ReturnType<Store["findTaintedFunders"]> = [];
  try {
    taintedFunders = funders.length ? store.findTaintedFunders(funders, mint) : [];
  } catch {
    partial = true;
  }
  const score = computeScore({
    token,
    nodes,
    devHistory,
    devStatus,
    taintedFunders,
    incomplete:
      partial || !token.createTxFound || (devStatus?.partial ?? true) || nodes.some((n) => n.terminal === "incomplete"),
  });
  emit({ type: "score", data: score });
  mark("score", "done");

  const result: TraceResult = {
    token,
    nodes,
    devHistory,
    devHistoryPartial,
    devStatus,
    crosslinks,
    score,
    partial,
    finishedAt: now(),
  };
  emit({ type: "done", data: { partial } });
  return result;
}
```

Add to `packages/core/src/index.ts`:
```ts
export * from "./runTrace";
```

- [ ] **Step 5: Run the whole core suite**

Run: `pnpm --filter @pumpfun/core test` → all PASS.
Run: `pnpm --filter @pumpfun/core typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): trace orchestrator with streamed events"
```

---
### Task 9: Rate-limited RPC client (`packages/solana`)

**Files:**
- Create: `packages/solana/package.json`, `packages/solana/tsconfig.json`
- Create: `packages/solana/src/tokenBucket.ts`, `src/rpcPool.ts`, `src/rpcChainSource.ts`, `src/index.ts`
- Test: `packages/solana/test/tokenBucket.test.ts`, `test/rpcPool.test.ts`, `test/rpcChainSource.test.ts`

**Interfaces:**
- Consumes: `ChainSource`, `AccountData`, `ParsedTx`, `SignatureInfo`, `TokenHolding`, `TOKEN_PROGRAM_ID`, `TOKEN_2022_PROGRAM_ID` from `@pumpfun/core`.
- Produces:
  - `class TokenBucket(ratePerSec, capacity, clock?)` with `waitMs(): number`, `take(): void`
  - `interface EndpointConfig { url: string; rps: number; methodRps: number }`
  - `class RpcError extends Error { retryable: boolean; status?: number; code?: number }`
  - `class RpcPool(endpoints: EndpointConfig[], opts?: { fetch?; sleep?; clock?; maxRetries?; cooldownMs?; timeoutMs?; random? })` with `call<T>(method: string, params: unknown[]): Promise<T>`
  - `parseEndpoints(spec: string, defaultRps: number, defaultMethodRps: number): EndpointConfig[]` — spec is comma-separated, each item `url` or `url|rps|methodRps`
  - `class RpcChainSource(pool: RpcPool) implements ChainSource`

- [ ] **Step 1: Package skeleton**

`packages/solana/package.json`:
```json
{
  "name": "@pumpfun/solana",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

`packages/solana/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm --filter @pumpfun/solana add "@pumpfun/core@workspace:*"`

- [ ] **Step 2: Write the failing tests**

`packages/solana/test/tokenBucket.test.ts`:
```ts
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
```

`packages/solana/test/rpcPool.test.ts`:
```ts
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
```

`packages/solana/test/rpcChainSource.test.ts`:
```ts
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

  it("requests jsonParsed transactions with v0 support", async () => {
    const { chain, seen } = source({ getTransaction: () => null });
    expect(await chain.getTransaction("sig")).toBeNull();
    expect(seen[0]!.params).toEqual(["sig", { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }]);
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @pumpfun/solana test`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement**

`packages/solana/src/tokenBucket.ts`:
```ts
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity: number,
    private readonly clock: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = clock();
  }

  private refill(): void {
    const t = this.clock();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.ratePerSec);
    this.last = t;
  }

  /** Milliseconds until one token is available (0 = now). Does not consume. */
  waitMs(): number {
    this.refill();
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000);
  }

  take(): void {
    this.refill();
    this.tokens -= 1;
  }
}
```

`packages/solana/src/rpcPool.ts`:
```ts
import { TokenBucket } from "./tokenBucket";

export interface EndpointConfig {
  url: string;
  rps: number;
  methodRps: number;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface PoolOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  maxRetries?: number;
  cooldownMs?: number;
  timeoutMs?: number;
  random?: () => number;
}

interface Endpoint {
  cfg: EndpointConfig;
  global: TokenBucket;
  methods: Map<string, TokenBucket>;
  strikes: number;
  cooldownUntil: number;
}

/** -32004 block not available, -32005 node behind, -32014 status not available yet, 429 rate limit. */
const RETRYABLE_RPC_CODES = new Set([-32004, -32005, -32014, 429]);

export class RpcPool {
  private readonly endpoints: Endpoint[];
  private next = 0;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private readonly maxRetries: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly random: () => number;

  constructor(endpoints: EndpointConfig[], opts: PoolOptions = {}) {
    if (endpoints.length === 0) throw new Error("RpcPool needs at least one endpoint");
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.clock = opts.clock ?? Date.now;
    this.maxRetries = opts.maxRetries ?? 4;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.random = opts.random ?? Math.random;
    this.endpoints = endpoints.map((cfg) => ({
      cfg,
      global: new TokenBucket(cfg.rps, Math.max(1, cfg.rps), this.clock),
      methods: new Map(),
      strikes: 0,
      cooldownUntil: 0,
    }));
  }

  private methodBucket(ep: Endpoint, method: string): TokenBucket {
    let bucket = ep.methods.get(method);
    if (!bucket) {
      bucket = new TokenBucket(ep.cfg.methodRps, Math.max(1, ep.cfg.methodRps), this.clock);
      ep.methods.set(method, bucket);
    }
    return bucket;
  }

  /** Round-robin over endpoints that are not cooling down and have budget for this method. */
  private async acquire(method: string): Promise<Endpoint> {
    for (;;) {
      const now = this.clock();
      let wait = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.endpoints.length; i++) {
        const idx = (this.next + i) % this.endpoints.length;
        const ep = this.endpoints[idx]!;
        if (ep.cooldownUntil > now) {
          wait = Math.min(wait, ep.cooldownUntil - now);
          continue;
        }
        const mb = this.methodBucket(ep, method);
        const w = Math.max(ep.global.waitMs(), mb.waitMs());
        if (w === 0) {
          ep.global.take();
          mb.take();
          this.next = (idx + 1) % this.endpoints.length;
          return ep;
        }
        wait = Math.min(wait, w);
      }
      await this.sleep(Math.max(wait, 5));
    }
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ep = await this.acquire(method);
      try {
        const result = await this.send<T>(ep, method, params);
        ep.strikes = 0;
        return result;
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
        if (err instanceof RpcError && (err.status === 429 || err.status === 403)) {
          ep.strikes++;
          if (ep.strikes >= 2) {
            ep.cooldownUntil = this.clock() + this.cooldownMs;
            ep.strikes = 0;
          }
        }
        if (attempt < this.maxRetries) await this.sleep(500 * 2 ** attempt + Math.floor(this.random() * 250));
      }
    }
    throw lastError;
  }

  private async send<T>(ep: Endpoint, method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchFn(ep.cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 429 || res.status === 403 || res.status >= 500) {
      throw new RpcError(`HTTP ${res.status} from ${method}`, true, res.status);
    }
    if (!res.ok) throw new RpcError(`HTTP ${res.status} from ${method}`, false, res.status);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) {
      throw new RpcError(`${method}: ${body.error.message}`, RETRYABLE_RPC_CODES.has(body.error.code), undefined, body.error.code);
    }
    return body.result as T;
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof RpcError) return err.retryable;
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "TypeError" || name === "AbortError";
}

export function parseEndpoints(spec: string, defaultRps: number, defaultMethodRps: number): EndpointConfig[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const [url, rps, methodRps] = item.split("|");
      return {
        url: url!,
        rps: rps ? Number(rps) : defaultRps,
        methodRps: methodRps ? Number(methodRps) : defaultMethodRps,
      };
    });
}
```

`packages/solana/src/rpcChainSource.ts`:
```ts
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type AccountData,
  type ChainSource,
  type ParsedTx,
  type SignatureInfo,
  type TokenHolding,
} from "@pumpfun/core";
import type { RpcPool } from "./rpcPool";

interface RawAccount {
  data: [string, string];
  owner: string;
}

interface RawTokenAccount {
  account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string } } } } };
}

function toAccount(address: string, raw: RawAccount | null): AccountData | null {
  if (!raw) return null;
  return { address, owner: raw.owner, data: new Uint8Array(Buffer.from(raw.data[0], "base64")) };
}

export class RpcChainSource implements ChainSource {
  constructor(private readonly pool: RpcPool) {}

  async getSignatures(address: string, opts: { before?: string; limit: number }): Promise<SignatureInfo[]> {
    const rows = await this.pool.call<{ signature: string; slot: number; blockTime: number | null; err: unknown }[]>(
      "getSignaturesForAddress",
      [address, { limit: opts.limit, before: opts.before, commitment: "finalized" }],
    );
    return rows.map((r) => ({ signature: r.signature, slot: r.slot, blockTime: r.blockTime ?? null, err: r.err ?? null }));
  }

  getTransaction(signature: string): Promise<ParsedTx | null> {
    return this.pool.call<ParsedTx | null>("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" },
    ]);
  }

  async getAccount(address: string): Promise<AccountData | null> {
    const r = await this.pool.call<{ value: RawAccount | null }>("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]);
    return toAccount(address, r.value);
  }

  async getAccounts(addresses: string[]): Promise<(AccountData | null)[]> {
    if (addresses.length === 0) return [];
    const r = await this.pool.call<{ value: (RawAccount | null)[] }>("getMultipleAccounts", [
      addresses,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    return r.value.map((v, i) => toAccount(addresses[i]!, v));
  }

  async getTokenHoldings(owner: string): Promise<TokenHolding[]> {
    const totals = new Map<string, bigint>();
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const r = await this.pool.call<{ value: RawTokenAccount[] }>("getTokenAccountsByOwner", [
        owner,
        { programId },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]);
      for (const row of r.value) {
        const { mint, tokenAmount } = row.account.data.parsed.info;
        totals.set(mint, (totals.get(mint) ?? 0n) + BigInt(tokenAmount.amount));
      }
    }
    return [...totals].map(([mint, amount]) => ({ mint, amount: amount.toString() }));
  }
}
```

`packages/solana/src/index.ts`:
```ts
export * from "./tokenBucket";
export * from "./rpcPool";
export * from "./rpcChainSource";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @pumpfun/solana test` → PASS.
Run: `pnpm --filter @pumpfun/solana typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(solana): rate-limited RPC pool and chain source"
```

---

### Task 10: SQLite store (`packages/db`)

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`
- Create: `packages/db/src/schema.ts`, `src/sqliteStore.ts`, `src/index.ts`
- Test: `packages/db/test/sqliteStore.test.ts`

**Interfaces:**
- Consumes: `Store`, `WalletRecord`, `TaintedFunder`, `ParsedTx` from `@pumpfun/core`; `TraceResult`, `TraceEvent`, `Crosslink`, `ChainNode`, `RecentTrace`, `WalletView`, `JobState` from `@pumpfun/shared`.
- Produces: `interface JobRow { id: string; mint: string; state: JobState; partial: boolean }`; `class SqliteStore implements Store` with constructor `(path: string)` (use `":memory:"` in tests) and, beyond `Store`: `close()`, `createJob(id, mint, startedAtMs)`, `finishJob(id, state, partial, finishedAtMs)`, `getJob(id): JobRow | null`, `markRunningJobsInterrupted(nowMs): number`, `appendEvent(jobId, seq, event)`, `listEvents(jobId): { seq: number; event: TraceEvent }[]`, `saveResult(result: TraceResult)`, `getResult(mint): { result: TraceResult; finishedAt: number } | null`, `recent(limit): RecentTrace[]`, `walletView(address): WalletView`.

- [ ] **Step 1: Package skeleton**

`packages/db/package.json`:
```json
{
  "name": "@pumpfun/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

`packages/db/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run:
```bash
pnpm --filter @pumpfun/db add better-sqlite3 "@pumpfun/core@workspace:*" "@pumpfun/shared@workspace:*"
pnpm --filter @pumpfun/db add -D @types/better-sqlite3
```

- [ ] **Step 2: Write the failing test**

`packages/db/test/sqliteStore.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChainNode, DevToken, TraceResult } from "@pumpfun/shared";
import type { WalletRecord } from "@pumpfun/core";
import { SqliteStore } from "../src/index";

let store: SqliteStore;
beforeEach(() => {
  store = new SqliteStore(":memory:");
});
afterEach(() => store.close());

const node = (address: string, depth: number, chainRoot: string, over: Partial<ChainNode> = {}): ChainNode => ({
  address,
  depth,
  role: depth === 0 ? "deployer" : "funder",
  chainRoot,
  fundedBy: null,
  fundingAmountLamports: null,
  fundedAt: null,
  fundingSignature: null,
  terminal: null,
  ...over,
});

const dead = (mint: string): DevToken => ({
  mint,
  name: `dead ${mint}`,
  symbol: mint,
  createdAt: 1,
  complete: false,
  devBalance: "0",
  initialBuy: "10",
  status: "dead_dev_exited",
});

function result(mint: string, deployer: string, funders: string[], over: Partial<TraceResult> = {}): TraceResult {
  return {
    token: {
      mint,
      name: `Name ${mint}`,
      symbol: mint.slice(0, 3),
      uri: null,
      tokenProgram: null,
      quoteMint: null,
      deployer,
      creatorCurrent: deployer,
      creatorOriginal: deployer,
      createdAt: 100,
      createSignature: "c",
      complete: false,
      isMayhemMode: false,
      devInitialBuy: "10",
      createTxFound: true,
    },
    nodes: [node(deployer, 0, deployer), ...funders.map((f, i) => node(f, i + 1, deployer))],
    devHistory: [],
    devHistoryPartial: false,
    devStatus: null,
    crosslinks: [],
    score: { score: 42, level: "medium", factors: [], incomplete: false },
    partial: false,
    finishedAt: 1000,
    ...over,
  };
}

const wallet = (address: string, over: Partial<WalletRecord> = {}): WalletRecord => ({
  address,
  funderResolved: false,
  funder: null,
  fundingSignature: null,
  fundingAmountLamports: null,
  fundedAt: null,
  terminal: "unknown_origin",
  fetchedAt: 5,
  ...over,
});

describe("SqliteStore cache", () => {
  it("round-trips wallets and upserts", () => {
    store.putWallet(wallet("W", { terminal: "high_activity" }));
    store.putWallet(wallet("W", { funderResolved: true, funder: "F", fundingAmountLamports: "9", fundedAt: 3, fundingSignature: "s", terminal: null }));
    expect(store.getWallet("W")).toEqual(wallet("W", { funderResolved: true, funder: "F", fundingAmountLamports: "9", fundedAt: 3, fundingSignature: "s", terminal: null }));
    expect(store.getWallet("missing")).toBeNull();
  });

  it("caches transactions", () => {
    const tx = { slot: 1, blockTime: 2, meta: null, transaction: { signatures: ["s"], message: { accountKeys: [], instructions: [] } } };
    store.putTx("s", tx);
    store.putTx("s", tx);
    expect(store.getTx("s")).toEqual(tx);
    expect(store.getTx("none")).toBeNull();
  });
});

describe("SqliteStore results", () => {
  it("saves, reads back and lists recent results", () => {
    store.saveResult(result("MINTA", "DEVA", ["F1"]));
    expect(store.getResult("MINTA")).toMatchObject({ finishedAt: 1000, result: { token: { mint: "MINTA" } } });
    expect(store.recent(10)).toEqual([{ mint: "MINTA", name: "Name MINTA", symbol: "MIN", score: 42, level: "medium", finishedAt: 1000 }]);
  });

  it("finds wallets shared with other traces, ignoring high-activity wallets", () => {
    store.saveResult(
      result("MINTA", "DEVA", ["F1"], {
        nodes: [node("DEVA", 0, "DEVA"), node("F1", 1, "DEVA"), node("CEX", 2, "DEVA", { terminal: "high_activity" })],
      }),
    );
    expect(store.findCrosslinks(["F1", "CEX", "X"], "MINTB")).toEqual([{ wallet: "F1", role: "funder", otherMint: "MINTA", otherSymbol: "MIN" }]);
    expect(store.findCrosslinks(["F1"], "MINTA")).toEqual([]);
    expect(store.findCrosslinks([], "MINTB")).toEqual([]);
  });

  it("records dev transfer recipients as insiders", () => {
    store.saveResult(
      result("MINTA", "DEVA", [], {
        devStatus: { initialBuy: "1", bought: "0", sold: "0", transferredOut: "1", balance: "0", releasedPct: 100, transfers: [{ to: "INS", amount: "1", signature: "x" }], partial: false },
      }),
    );
    expect(store.findCrosslinks(["INS"], "MINTB")).toEqual([{ wallet: "INS", role: "insider", otherMint: "MINTA", otherSymbol: "MIN" }]);
  });

  it("counts dead tokens linked to a funder or deployer", () => {
    store.saveResult(result("MINTA", "DEVA", ["F1"], { devHistory: [dead("D1"), dead("D2")] }));
    expect(store.findTaintedFunders(["F1", "DEVA", "NOBODY"], "MINTB")).toEqual(
      expect.arrayContaining([
        { wallet: "F1", deadCount: 2 },
        { wallet: "DEVA", deadCount: 2 },
      ]),
    );
    expect(store.findTaintedFunders(["F1"], "MINTA")).toEqual([]);
  });
});

describe("SqliteStore jobs", () => {
  it("stores events in order and tracks job state", () => {
    store.createJob("j1", "MINTA", 10);
    store.appendEvent("j1", 1, { type: "done", data: { partial: false } });
    store.appendEvent("j1", 0, { type: "step", data: { step: "token", state: "running" } });
    expect(store.listEvents("j1").map((e) => e.seq)).toEqual([0, 1]);
    expect(store.getJob("j1")).toEqual({ id: "j1", mint: "MINTA", state: "running", partial: false });
    store.finishJob("j1", "done", true, 20);
    expect(store.getJob("j1")).toEqual({ id: "j1", mint: "MINTA", state: "done", partial: true });
  });

  it("marks running jobs interrupted on startup", () => {
    store.createJob("j1", "A", 1);
    store.createJob("j2", "B", 1);
    store.finishJob("j2", "done", false, 2);
    expect(store.markRunningJobsInterrupted(3)).toBe(1);
    expect(store.getJob("j1")?.state).toBe("interrupted");
  });
});

describe("SqliteStore walletView", () => {
  it("walks the cached funding chain and lists launches and appearances", () => {
    store.putWallet(wallet("DEVA", { funderResolved: true, funder: "F1", terminal: null, fundedAt: 50 }));
    store.putWallet(wallet("F1"));
    store.saveResult(result("MINTA", "DEVA", ["F1"]));
    const view = store.walletView("DEVA");
    expect(view.known).toBe(true);
    expect(view.chain.map((n) => [n.address, n.depth, n.fundedBy, n.terminal])).toEqual([
      ["DEVA", 0, "F1", null],
      ["F1", 1, null, "unknown_origin"],
    ]);
    expect(view.deployed.map((d) => d.mint)).toEqual(["MINTA"]);
    expect(view.appearances).toEqual([{ mint: "MINTA", symbol: "MIN", role: "deployer" }]);
  });

  it("reports unknown wallets", () => {
    expect(store.walletView("NEW")).toEqual({ address: "NEW", known: false, chain: [], deployed: [], appearances: [] });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @pumpfun/db test`
Expected: FAIL (cannot resolve `../src/index`).

- [ ] **Step 4: Implement**

`packages/db/src/schema.ts`:
```ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  funder_resolved INTEGER NOT NULL,
  funder TEXT,
  funding_signature TEXT,
  funding_amount_lamports TEXT,
  funded_at INTEGER,
  terminal TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tx_cache (
  signature TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  deployer TEXT NOT NULL,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS tokens_deployer ON tokens(deployer);
CREATE TABLE IF NOT EXISTS dev_tokens (
  deployer TEXT NOT NULL,
  mint TEXT NOT NULL,
  status TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (deployer, mint)
);
CREATE TABLE IF NOT EXISTS trace_wallets (
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  role TEXT NOT NULL,
  depth INTEGER NOT NULL,
  PRIMARY KEY (mint, wallet, role)
);
CREATE INDEX IF NOT EXISTS trace_wallets_wallet ON trace_wallets(wallet);
CREATE TABLE IF NOT EXISTS trace_results (
  mint TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  score INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trace_results_finished ON trace_results(finished_at);
CREATE TABLE IF NOT EXISTS trace_jobs (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  state TEXT NOT NULL,
  partial INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS trace_events (
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
);
`;
```

`packages/db/src/sqliteStore.ts`:
```ts
import Database from "better-sqlite3";
import type { ParsedTx, Store, TaintedFunder, WalletRecord } from "@pumpfun/core";
import type { ChainNode, Crosslink, JobState, RecentTrace, TraceEvent, TraceResult, WalletView } from "@pumpfun/shared";
import { SCHEMA } from "./schema";

export interface JobRow {
  id: string;
  mint: string;
  state: JobState;
  partial: boolean;
}

interface WalletRow {
  address: string;
  funder_resolved: number;
  funder: string | null;
  funding_signature: string | null;
  funding_amount_lamports: string | null;
  funded_at: number | null;
  terminal: WalletRecord["terminal"];
  fetched_at: number;
}

const rowToWallet = (r: WalletRow): WalletRecord => ({
  address: r.address,
  funderResolved: r.funder_resolved === 1,
  funder: r.funder,
  fundingSignature: r.funding_signature,
  fundingAmountLamports: r.funding_amount_lamports,
  fundedAt: r.funded_at,
  terminal: r.terminal,
  fetchedAt: r.fetched_at,
});

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");
const MAX_WALLET_CHAIN = 6;

export class SqliteStore implements Store {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- Store (trace cache) ----

  getWallet(address: string): WalletRecord | null {
    const row = this.db.prepare("SELECT * FROM wallets WHERE address = ?").get(address) as WalletRow | undefined;
    return row ? rowToWallet(row) : null;
  }

  putWallet(w: WalletRecord): void {
    this.db
      .prepare(
        `INSERT INTO wallets (address, funder_resolved, funder, funding_signature, funding_amount_lamports, funded_at, terminal, fetched_at)
         VALUES (@address, @funderResolved, @funder, @fundingSignature, @fundingAmountLamports, @fundedAt, @terminal, @fetchedAt)
         ON CONFLICT(address) DO UPDATE SET
           funder_resolved = excluded.funder_resolved, funder = excluded.funder,
           funding_signature = excluded.funding_signature, funding_amount_lamports = excluded.funding_amount_lamports,
           funded_at = excluded.funded_at, terminal = excluded.terminal, fetched_at = excluded.fetched_at`,
      )
      .run({
        address: w.address,
        funderResolved: w.funderResolved ? 1 : 0,
        funder: w.funder,
        fundingSignature: w.fundingSignature,
        fundingAmountLamports: w.fundingAmountLamports,
        fundedAt: w.fundedAt,
        terminal: w.terminal,
        fetchedAt: w.fetchedAt,
      });
  }

  getTx(signature: string): ParsedTx | null {
    const row = this.db.prepare("SELECT json FROM tx_cache WHERE signature = ?").get(signature) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as ParsedTx) : null;
  }

  putTx(signature: string, tx: ParsedTx): void {
    this.db.prepare("INSERT OR IGNORE INTO tx_cache (signature, json) VALUES (?, ?)").run(signature, JSON.stringify(tx));
  }

  findCrosslinks(wallets: string[], excludeMint: string): Crosslink[] {
    if (wallets.length === 0) return [];
    return this.db
      .prepare(
        `SELECT tw.wallet AS wallet, tw.role AS role, tw.mint AS otherMint, t.symbol AS otherSymbol
         FROM trace_wallets tw LEFT JOIN tokens t ON t.mint = tw.mint
         WHERE tw.wallet IN (${placeholders(wallets.length)}) AND tw.mint != ?
         ORDER BY tw.mint LIMIT 50`,
      )
      .all(...wallets, excludeMint) as Crosslink[];
  }

  findTaintedFunders(wallets: string[], excludeMint: string): TaintedFunder[] {
    if (wallets.length === 0) return [];
    const ph = placeholders(wallets.length);
    const viaTraces = this.db
      .prepare(
        `SELECT tw.wallet AS wallet, COUNT(DISTINCT dt.mint) AS deadCount
         FROM trace_wallets tw
         JOIN tokens t ON t.mint = tw.mint
         JOIN dev_tokens dt ON dt.deployer = t.deployer AND dt.status = 'dead_dev_exited'
         WHERE tw.wallet IN (${ph}) AND tw.role = 'funder' AND tw.mint != ?
         GROUP BY tw.wallet`,
      )
      .all(...wallets, excludeMint) as TaintedFunder[];
    const asDeployer = this.db
      .prepare(
        `SELECT deployer AS wallet, COUNT(*) AS deadCount FROM dev_tokens
         WHERE deployer IN (${ph}) AND status = 'dead_dev_exited' AND mint != ?
         GROUP BY deployer`,
      )
      .all(...wallets, excludeMint) as TaintedFunder[];
    const totals = new Map<string, number>();
    for (const row of [...viaTraces, ...asDeployer]) totals.set(row.wallet, (totals.get(row.wallet) ?? 0) + row.deadCount);
    return [...totals].map(([wallet, deadCount]) => ({ wallet, deadCount }));
  }

  // ---- Jobs and events ----

  createJob(id: string, mint: string, startedAtMs: number): void {
    this.db.prepare("INSERT INTO trace_jobs (id, mint, state, partial, started_at) VALUES (?, ?, 'running', 0, ?)").run(id, mint, startedAtMs);
  }

  finishJob(id: string, state: JobState, partial: boolean, finishedAtMs: number): void {
    this.db.prepare("UPDATE trace_jobs SET state = ?, partial = ?, finished_at = ? WHERE id = ?").run(state, partial ? 1 : 0, finishedAtMs, id);
  }

  getJob(id: string): JobRow | null {
    const row = this.db.prepare("SELECT id, mint, state, partial FROM trace_jobs WHERE id = ?").get(id) as
      | { id: string; mint: string; state: JobState; partial: number }
      | undefined;
    return row ? { id: row.id, mint: row.mint, state: row.state, partial: row.partial === 1 } : null;
  }

  markRunningJobsInterrupted(nowMs: number): number {
    return this.db.prepare("UPDATE trace_jobs SET state = 'interrupted', partial = 1, finished_at = ? WHERE state = 'running'").run(nowMs).changes;
  }

  appendEvent(jobId: string, seq: number, event: TraceEvent): void {
    this.db.prepare("INSERT INTO trace_events (job_id, seq, json) VALUES (?, ?, ?)").run(jobId, seq, JSON.stringify(event));
  }

  listEvents(jobId: string): { seq: number; event: TraceEvent }[] {
    const rows = this.db.prepare("SELECT seq, json FROM trace_events WHERE job_id = ? ORDER BY seq").all(jobId) as { seq: number; json: string }[];
    return rows.map((r) => ({ seq: r.seq, event: JSON.parse(r.json) as TraceEvent }));
  }

  // ---- Results ----

  saveResult(r: TraceResult): void {
    const save = this.db.transaction((res: TraceResult) => {
      const { token } = res;
      this.db
        .prepare(
          `INSERT INTO trace_results (mint, json, score, finished_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(mint) DO UPDATE SET json = excluded.json, score = excluded.score, finished_at = excluded.finished_at`,
        )
        .run(token.mint, JSON.stringify(res), res.score.score, res.finishedAt);

      const upsertToken = this.db.prepare(
        `INSERT INTO tokens (mint, name, symbol, deployer, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(mint) DO UPDATE SET name = COALESCE(excluded.name, tokens.name), symbol = COALESCE(excluded.symbol, tokens.symbol),
           deployer = excluded.deployer, created_at = COALESCE(excluded.created_at, tokens.created_at)`,
      );
      upsertToken.run(token.mint, token.name, token.symbol, token.deployer, token.createdAt);

      const upsertDevToken = this.db.prepare(
        `INSERT INTO dev_tokens (deployer, mint, status, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(deployer, mint) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at`,
      );
      for (const t of res.devHistory) {
        upsertToken.run(t.mint, t.name, t.symbol, token.deployer, t.createdAt);
        upsertDevToken.run(token.deployer, t.mint, t.status, res.finishedAt);
      }

      this.db.prepare("DELETE FROM trace_wallets WHERE mint = ?").run(token.mint);
      const addWallet = this.db.prepare("INSERT OR IGNORE INTO trace_wallets (mint, wallet, role, depth) VALUES (?, ?, ?, ?)");
      for (const n of res.nodes) {
        if (n.terminal === "high_activity") continue;
        addWallet.run(token.mint, n.address, n.role, n.depth);
      }
      for (const t of res.devStatus?.transfers ?? []) addWallet.run(token.mint, t.to, "insider", 0);
    });
    save(r);
  }

  getResult(mint: string): { result: TraceResult; finishedAt: number } | null {
    const row = this.db.prepare("SELECT json, finished_at FROM trace_results WHERE mint = ?").get(mint) as
      | { json: string; finished_at: number }
      | undefined;
    return row ? { result: JSON.parse(row.json) as TraceResult, finishedAt: row.finished_at } : null;
  }

  recent(limit: number): RecentTrace[] {
    const rows = this.db.prepare("SELECT json FROM trace_results ORDER BY finished_at DESC LIMIT ?").all(limit) as { json: string }[];
    return rows.map((row) => {
      const r = JSON.parse(row.json) as TraceResult;
      return { mint: r.token.mint, name: r.token.name, symbol: r.token.symbol, score: r.score.score, level: r.score.level, finishedAt: r.finishedAt };
    });
  }

  walletView(address: string): WalletView {
    const deployed = this.db
      .prepare(
        `SELECT t.mint AS mint, t.name AS name, t.symbol AS symbol, t.created_at AS createdAt, dt.status AS status
         FROM tokens t LEFT JOIN dev_tokens dt ON dt.mint = t.mint AND dt.deployer = t.deployer
         WHERE t.deployer = ? ORDER BY t.created_at DESC LIMIT 100`,
      )
      .all(address) as WalletView["deployed"];
    const appearances = this.db
      .prepare(
        `SELECT tw.mint AS mint, t.symbol AS symbol, tw.role AS role
         FROM trace_wallets tw LEFT JOIN tokens t ON t.mint = tw.mint
         WHERE tw.wallet = ? ORDER BY tw.mint LIMIT 100`,
      )
      .all(address) as WalletView["appearances"];

    const chain: ChainNode[] = [];
    const seen = new Set<string>();
    let current: string | null = address;
    for (let depth = 0; current && depth < MAX_WALLET_CHAIN && !seen.has(current); depth++) {
      seen.add(current);
      const w = this.getWallet(current);
      if (!w) {
        if (depth > 0) chain.push({ ...emptyNode(current, depth, address), terminal: "incomplete" });
        break;
      }
      chain.push({
        address: current,
        depth,
        role: depth === 0 && deployed.length > 0 ? "deployer" : "funder",
        chainRoot: address,
        fundedBy: w.funder,
        fundingAmountLamports: w.fundingAmountLamports,
        fundedAt: w.fundedAt,
        fundingSignature: w.fundingSignature,
        terminal: w.terminal,
      });
      current = w.funder;
    }

    const known = chain.length > 0 || deployed.length > 0 || appearances.length > 0;
    return { address, known, chain, deployed, appearances };
  }
}

function emptyNode(address: string, depth: number, chainRoot: string): ChainNode {
  return {
    address,
    depth,
    role: "funder",
    chainRoot,
    fundedBy: null,
    fundingAmountLamports: null,
    fundedAt: null,
    fundingSignature: null,
    terminal: null,
  };
}
```

`packages/db/src/index.ts`:
```ts
export * from "./sqliteStore";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @pumpfun/db test` → PASS.
Run: `pnpm --filter @pumpfun/db typecheck` → no errors.

If `better-sqlite3` fails to load ("Could not locate the bindings file"), run `pnpm rebuild better-sqlite3` and retry.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): sqlite store for cache, jobs and results"
```

---

### Task 11: API (jobs, routes, SSE)

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`
- Create: `apps/api/src/config.ts`, `src/jobs.ts`, `src/app.ts`
- Test: `apps/api/test/config.test.ts`, `apps/api/test/app.test.ts`

**Interfaces:**
- Consumes: `runTrace`, `NotPumpTokenError`, `ChainSource`, `TraceConfig` (core); `createScenario`, `addr` (core/testing); `SqliteStore` (db); `parseEndpoints`, `EndpointConfig` (solana); `TraceRequest`, `TraceEvent` (shared).
- Produces:
  - `interface ApiConfig { port; dbPath; endpoints: EndpointConfig[]; jobConcurrency; jobTimeoutMs; traceRateLimitPerMin; freshResultSec }`, `loadConfig(env): ApiConfig`
  - `class JobManager({ store, chain, concurrency, timeoutMs, now?, traceConfig?, log? })` with `start(mint): string`, `subscribe(jobId, (seq, event) => void): (() => void) | null`, `whenIdle(): Promise<void>`
  - `buildApp({ store, jobs, config, logger?, now? }): Promise<FastifyInstance>`
  - HTTP: `POST /api/trace` `{ mint }` → `{ jobId }` or `{ cached: true, result }` (400 on bad address, rate limited); `GET /api/trace/:jobId/stream` (SSE, `data: <TraceEvent JSON>`, ends after `done`/`error`); `GET /api/token/:mint` (404 if never traced); `GET /api/wallet/:address`; `GET /api/recent`.

- [ ] **Step 1: Package skeleton**

`apps/api/package.json`:
```json
{
  "name": "@pumpfun/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "smoke": "tsx scripts/smoke.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/api/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

Run:
```bash
pnpm --filter @pumpfun/api add fastify @fastify/rate-limit tsx "@pumpfun/core@workspace:*" "@pumpfun/db@workspace:*" "@pumpfun/solana@workspace:*" "@pumpfun/shared@workspace:*"
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("has working defaults", () => {
    expect(loadConfig({})).toEqual({
      port: 3001,
      dbPath: "./pumpfun.db",
      endpoints: [{ url: "https://api.mainnet.solana.com", rps: 8, methodRps: 3.5 }],
      jobConcurrency: 2,
      jobTimeoutMs: 300_000,
      traceRateLimitPerMin: 10,
      freshResultSec: 300,
    });
  });

  it("reads overrides", () => {
    const cfg = loadConfig({ PORT: "4000", RPC_URLS: "https://a|10|4,https://b", RPC_RPS: "5", RPC_METHOD_RPS: "2" });
    expect(cfg.port).toBe(4000);
    expect(cfg.endpoints).toEqual([
      { url: "https://a", rps: 10, methodRps: 4 },
      { url: "https://b", rps: 5, methodRps: 2 },
    ]);
  });
});
```

`apps/api/test/app.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SqliteStore } from "@pumpfun/db";
import { addr, createScenario, type Scenario } from "@pumpfun/core/testing";
import { buildApp } from "../src/app";
import { JobManager } from "../src/jobs";

let s: Scenario;
let store: SqliteStore;
let jobs: JobManager;
let app: FastifyInstance;

beforeEach(async () => {
  s = await createScenario();
  store = new SqliteStore(":memory:");
  jobs = new JobManager({ store, chain: s.chain, concurrency: 1, timeoutMs: 10_000, now: () => s.now });
  app = await buildApp({ store, jobs, config: { traceRateLimitPerMin: 100, freshResultSec: 300 }, now: () => s.now + 10 });
});

afterEach(async () => {
  await app.close();
  store.close();
});

const startTrace = (mint: string) => app.inject({ method: "POST", url: "/api/trace", payload: { mint } });

describe("API", () => {
  it("rejects malformed addresses", async () => {
    const res = await startTrace("not a mint");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid token address" });
  });

  it("runs a trace, streams it, and serves the stored result", async () => {
    const res = await startTrace(s.mint);
    expect(res.statusCode).toBe(200);
    const { jobId } = res.json() as { jobId: string };
    expect(jobId).toEqual(expect.any(String));
    await jobs.whenIdle();

    const stream = await app.inject({ method: "GET", url: `/api/trace/${jobId}/stream` });
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    const events = stream.body
      .split("\n\n")
      .filter((chunk) => chunk.includes("data: "))
      .map((chunk) => JSON.parse(chunk.slice(chunk.indexOf("data: ") + 6)));
    expect(events[0]).toEqual({ type: "step", data: { step: "token", state: "running" } });
    expect(events.at(-1)).toEqual({ type: "done", data: { partial: false } });

    const again = await startTrace(s.mint);
    expect(again.json()).toMatchObject({ cached: true, result: { score: { score: 50 } } });

    const token = await app.inject({ method: "GET", url: `/api/token/${s.mint}` });
    expect(token.json()).toMatchObject({ token: { deployer: s.deployer }, score: { level: "medium" } });

    const recent = await app.inject({ method: "GET", url: "/api/recent" });
    expect(recent.json()).toHaveLength(1);

    const wallet = (await app.inject({ method: "GET", url: `/api/wallet/${s.deployer}` })).json();
    expect(wallet.known).toBe(true);
    expect(wallet.chain[0]).toMatchObject({ address: s.deployer, fundedBy: s.funder });
  });

  it("deduplicates concurrent traces of the same mint", async () => {
    const a = (await startTrace(s.mint)).json() as { jobId: string };
    const b = (await startTrace(s.mint)).json() as { jobId: string };
    expect(b.jobId).toBe(a.jobId);
    await jobs.whenIdle();
  });

  it("streams an error for tokens that are not pump.fun tokens", async () => {
    const { jobId } = (await startTrace(addr(99))).json() as { jobId: string };
    await jobs.whenIdle();
    const stream = await app.inject({ method: "GET", url: `/api/trace/${jobId}/stream` });
    expect(stream.body).toContain('"type":"error"');
    expect(stream.body).toContain("not a pump.fun token");
  });

  it("returns 404 for unknown jobs and untraced tokens", async () => {
    expect((await app.inject({ method: "GET", url: "/api/trace/nope/stream" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/token/${addr(5)}` })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @pumpfun/api test`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement**

`apps/api/src/config.ts`:
```ts
import { parseEndpoints, type EndpointConfig } from "@pumpfun/solana";

export interface ApiConfig {
  port: number;
  dbPath: string;
  endpoints: EndpointConfig[];
  jobConcurrency: number;
  jobTimeoutMs: number;
  traceRateLimitPerMin: number;
  freshResultSec: number;
}

export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  const num = (key: string, fallback: number) => (env[key] ? Number(env[key]) : fallback);
  return {
    port: num("PORT", 3001),
    dbPath: env.DB_PATH ?? "./pumpfun.db",
    endpoints: parseEndpoints(env.RPC_URLS ?? "https://api.mainnet.solana.com", num("RPC_RPS", 8), num("RPC_METHOD_RPS", 3.5)),
    jobConcurrency: num("JOB_CONCURRENCY", 2),
    jobTimeoutMs: num("JOB_TIMEOUT_MS", 300_000),
    traceRateLimitPerMin: num("TRACE_RATE_LIMIT", 10),
    freshResultSec: num("FRESH_RESULT_SEC", 300),
  };
}
```

`apps/api/src/jobs.ts`:
```ts
import { randomUUID } from "node:crypto";
import { NotPumpTokenError, runTrace, type ChainSource, type TraceConfig } from "@pumpfun/core";
import type { SqliteStore } from "@pumpfun/db";
import type { TraceEvent } from "@pumpfun/shared";

export type JobListener = (seq: number, event: TraceEvent) => void;

interface Job {
  id: string;
  mint: string;
  seq: number;
  listeners: Set<JobListener>;
}

export interface JobManagerDeps {
  store: SqliteStore;
  chain: ChainSource;
  concurrency: number;
  timeoutMs: number;
  now?: () => number;
  traceConfig?: Partial<TraceConfig>;
  log?: (message: string, err?: unknown) => void;
}

/** In-process queue. One job per mint at a time; events are persisted so streams can replay. */
export class JobManager {
  private readonly byMint = new Map<string, Job>();
  private readonly byId = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private running = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly deps: JobManagerDeps) {}

  start(mint: string): string {
    const existing = this.byMint.get(mint);
    if (existing) return existing.id;
    const job: Job = { id: randomUUID(), mint, seq: 0, listeners: new Set() };
    this.byMint.set(mint, job);
    this.byId.set(job.id, job);
    this.deps.store.createJob(job.id, mint, Date.now());
    this.queue.push(job);
    this.pump();
    return job.id;
  }

  /** Returns null when the job is not running (finished or unknown); replay from the store instead. */
  subscribe(jobId: string, listener: JobListener): (() => void) | null {
    const job = this.byId.get(jobId);
    if (!job) return null;
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  whenIdle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running < this.deps.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.pump();
        if (this.running === 0 && this.queue.length === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          for (const resolve of waiters) resolve();
        }
      });
    }
  }

  private emit(job: Job, event: TraceEvent): void {
    const seq = job.seq++;
    this.deps.store.appendEvent(job.id, seq, event);
    for (const listener of job.listeners) listener(seq, event);
  }

  private async run(job: Job): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs);
    try {
      const result = await runTrace(job.mint, {
        chain: this.deps.chain,
        store: this.deps.store,
        emit: (e) => this.emit(job, e),
        signal: controller.signal,
        now: this.deps.now,
        config: this.deps.traceConfig,
      });
      this.deps.store.saveResult(result);
      this.deps.store.finishJob(job.id, "done", result.partial, Date.now());
    } catch (err) {
      const known = err instanceof NotPumpTokenError;
      if (!known) this.deps.log?.(`trace failed for ${job.mint}`, err);
      this.emit(job, { type: "error", data: { message: known ? err.message : "Trace failed. Please try again." } });
      this.deps.store.finishJob(job.id, "error", true, Date.now());
    } finally {
      clearTimeout(timer);
      this.byMint.delete(job.mint);
      this.byId.delete(job.id);
      job.listeners.clear();
    }
  }
}
```

`apps/api/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { SqliteStore } from "@pumpfun/db";
import { TraceRequest, type TraceEvent } from "@pumpfun/shared";
import type { ApiConfig } from "./config";
import type { JobManager } from "./jobs";

export interface AppDeps {
  store: SqliteStore;
  jobs: JobManager;
  config: Pick<ApiConfig, "traceRateLimitPerMin" | "freshResultSec">;
  logger?: boolean;
  now?: () => number;
}

const PING_MS = 15_000;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { store, jobs, config } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });
  await app.register(rateLimit, { global: false });

  app.post(
    "/api/trace",
    { config: { rateLimit: { max: config.traceRateLimitPerMin, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = TraceRequest.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid token address" });
      const { mint } = parsed.data;
      const cached = store.getResult(mint);
      if (cached && now() - cached.finishedAt < config.freshResultSec) return { cached: true, result: cached.result };
      return { jobId: jobs.start(mint) };
    },
  );

  app.get<{ Params: { jobId: string } }>("/api/trace/:jobId/stream", (req, reply) => {
    const job = store.getJob(req.params.jobId);
    if (!job) {
      reply.code(404).send({ error: "Job not found" });
      return;
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    let lastSeq = -1;
    let closed = false;
    let replaying = true;
    const buffered: [number, TraceEvent][] = [];

    // Subscribe before replaying so nothing emitted in between is lost; `lastSeq` drops duplicates.
    const unsubscribe = jobs.subscribe(job.id, (seq, event) => {
      if (replaying) buffered.push([seq, event]);
      else send(seq, event);
    });
    const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);

    function finish(): void {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsubscribe?.();
      res.end();
    }

    function send(seq: number, event: TraceEvent): void {
      if (closed || seq <= lastSeq) return;
      lastSeq = seq;
      res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
      if (event.type === "done" || event.type === "error") finish();
    }

    for (const { seq, event } of store.listEvents(job.id)) send(seq, event);
    replaying = false;
    for (const [seq, event] of buffered) send(seq, event);
    if (!unsubscribe) finish();
    req.raw.on("close", finish);
  });

  app.get<{ Params: { mint: string } }>("/api/token/:mint", async (req, reply) => {
    const found = store.getResult(req.params.mint);
    if (!found) return reply.code(404).send({ error: "Not traced yet" });
    return found.result;
  });

  app.get<{ Params: { address: string } }>("/api/wallet/:address", async (req) => store.walletView(req.params.address));

  app.get("/api/recent", async () => store.recent(20));

  return app;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @pumpfun/api test` → PASS.
Run: `pnpm --filter @pumpfun/api typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): trace jobs, SSE stream and read endpoints"
```

---

### Task 12: API server entry + live smoke test (spike)

**Files:**
- Create: `apps/api/src/server.ts`, `apps/api/scripts/smoke.ts`, `.env.example`
- Create: `docs/spikes/2026-10-20-live-rpc.md`

**Interfaces:**
- Consumes: `loadConfig`, `JobManager`, `buildApp` (Task 11); `SqliteStore` (Task 10); `RpcPool`, `RpcChainSource` (Task 9); `runTrace` (Task 8).
- Produces: runnable API (`pnpm dev:api`), `pnpm --filter @pumpfun/api smoke <MINT>` printing timed events against live RPC.

This task verifies the assumptions from spec section 11 against mainnet. No unit test; the smoke run is the check.

- [ ] **Step 1: Server entry**

`apps/api/src/server.ts`:
```ts
import { SqliteStore } from "@pumpfun/db";
import { RpcChainSource, RpcPool } from "@pumpfun/solana";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { JobManager } from "./jobs";

const config = loadConfig(process.env);
const store = new SqliteStore(config.dbPath);
const interrupted = store.markRunningJobsInterrupted(Date.now());
const chain = new RpcChainSource(new RpcPool(config.endpoints));
const jobs = new JobManager({
  store,
  chain,
  concurrency: config.jobConcurrency,
  timeoutMs: config.jobTimeoutMs,
  log: (message, err) => console.error(message, err),
});
const app = await buildApp({ store, jobs, config, logger: true });

if (interrupted > 0) app.log.warn(`${interrupted} trace job(s) were interrupted by the last shutdown`);

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
```

`.env.example`:
```
# Comma-separated RPC endpoints. Optional per-endpoint limits: url|requestsPerSecond|perMethodPerSecond
RPC_URLS=https://api.mainnet.solana.com
RPC_RPS=8
RPC_METHOD_RPS=3.5
PORT=3001
DB_PATH=./pumpfun.db
JOB_CONCURRENCY=2
JOB_TIMEOUT_MS=300000
TRACE_RATE_LIMIT=10
FRESH_RESULT_SEC=300
```

- [ ] **Step 2: Smoke script**

`apps/api/scripts/smoke.ts`:
```ts
import { runTrace } from "@pumpfun/core";
import { SqliteStore } from "@pumpfun/db";
import { RpcChainSource, RpcPool } from "@pumpfun/solana";
import { loadConfig } from "../src/config";

const mint = process.argv[2];
if (!mint) {
  console.error("usage: pnpm --filter @pumpfun/api smoke <MINT>");
  process.exit(1);
}

const config = loadConfig(process.env);
const store = new SqliteStore(process.env.DB_PATH ?? "./smoke.db");
const chain = new RpcChainSource(new RpcPool(config.endpoints));
const started = Date.now();
const stamp = () => `[${((Date.now() - started) / 1000).toFixed(1)}s]`;

try {
  const result = await runTrace(mint, {
    chain,
    store,
    emit: (e) => console.log(stamp(), e.type, JSON.stringify(e.data).slice(0, 240)),
  });
  console.log(stamp(), "score", JSON.stringify(result.score, null, 2));
} finally {
  store.close();
}
```

- [ ] **Step 3: Start the API and check it answers**

Run: `pnpm dev:api` (leave running), then in another terminal:
```bash
curl -s http://localhost:3001/api/recent
```
Expected: `[]`. Stop the server.

- [ ] **Step 4: Run the smoke test against three real tokens**

Pick from https://pump.fun (mint addresses end in `pump`):
1. a token launched in the last hour (likely `create_v2`),
2. a token that has migrated ("graduated") to PumpSwap,
3. a token older than 6 months.

For each:
```bash
pnpm --filter @pumpfun/api smoke <MINT>
```

Check and write down:
- `token` event has the right name/symbol and a deployer. If `createTxFound` is false for a fresh token, the event decoder is wrong: compare the inner-instruction data of the creation tx on Solscan with `EVENT_IX_TAG` + discriminator.
- `node` events: does the funding chain look plausible on Solscan? Does it reach a `high_activity` or `unknown_origin` terminal?
- For the old token: did old `getTransaction` calls succeed? If they return `null`, old wallets will show `unknown_origin`; note it.
- Total time and whether any `step … incomplete` appeared (429s).

Repeat one trace: the second run should be much faster (cache).

- [ ] **Step 5: Record findings**

`docs/spikes/2026-10-20-live-rpc.md` (fill in the observed values):
```markdown
# Live RPC smoke test (2026-10-20)

Endpoint: https://api.mainnet.solana.com, 8 rps / 3.5 rps per method.

| Token | Mint | createTxFound | Hops | Terminal | Cold time | Warm time | Incomplete steps |
|---|---|---|---|---|---|---|---|
| fresh (create_v2) | | | | | | | |
| migrated | | | | | | | |
| old (>6 months) | | | | | | | |

## Findings
- Event decoder on real txs:
- Old transactions available on public RPC:
- Rate limiting observed:

## Spec changes needed
- (none / list)
```

If a finding contradicts the spec, update the spec in the same commit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): server entry and live RPC smoke test"
```

---
### Task 13: Web scaffold, client state, and API client

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/index.css`
- Create: `apps/web/src/lib/format.ts`, `src/lib/risk.ts`, `src/lib/api.ts`, `src/lib/traceState.ts`, `src/lib/useTrace.ts`, `src/lib/useMediaQuery.ts`
- Test: `apps/web/src/lib/format.test.ts`, `apps/web/src/lib/traceState.test.ts`

**Interfaces:**
- Consumes: shared types and formatters from `@pumpfun/shared`; HTTP API from Task 11.
- Produces:
  - `relTime(unixSec: number, nowSec?: number): string`, `roleLabel(node: ChainNode): string`
  - `levelTone: Record<RiskLevel, "safe" | "warn" | "danger">`, `toneText: Record<Tone, string>`, `terminalLabel: Record<TerminalReason, string>`, `terminalShort: Record<TerminalReason, string>`
  - `startTrace(mint): Promise<StartTraceResponse>` where `StartTraceResponse = { cached: true; result: TraceResult } | { jobId: string }`; `streamTrace(jobId, onEvent): () => void`; `fetchRecent(): Promise<RecentTrace[]>`; `fetchWallet(address): Promise<WalletView>`
  - `interface TraceView { token; nodes; devHistory: DevToken[] | null; devHistoryPartial; devStatus; crosslinks: Crosslink[] | null; score; steps: Partial<Record<StepName, StepState>>; done; partial; error: string | null }`, `emptyView`, `type TraceAction = { kind: "reset" } | { kind: "result"; result: TraceResult } | { kind: "event"; event: TraceEvent }`, `traceReducer`, `applyEvent`, `viewFromResult`
  - `useTrace(mint): { view: TraceView; retry: () => void }`, `useMediaQuery(query): boolean`

- [ ] **Step 1: Package and config files**

`apps/web/package.json`:
```json
{
  "name": "@pumpfun/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  }
}
```

Run:
```bash
pnpm --filter @pumpfun/web add react react-dom @tanstack/react-router @tanstack/react-query @xyflow/react motion "@pumpfun/shared@workspace:*"
pnpm --filter @pumpfun/web add -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react @types/react-dom @playwright/test
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"]
  },
  "include": ["src", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": "http://localhost:3001" } },
  test: { include: ["src/**/*.test.ts"] },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>pumpfun.dev · who funded the dev?</title>
    <meta name="description" content="Trace who funded a pump.fun token's dev wallet, check the dev's past launches, and spot common rug patterns." />
    <meta name="theme-color" content="#0a0d0c" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/index.css`:
```css
@import "tailwindcss";

@theme {
  --color-bg: #0a0d0c;
  --color-surface: #111614;
  --color-surface-2: #182019;
  --color-line: #243029;
  --color-text: #e6ede8;
  --color-muted: #8fa096;
  --color-safe: #3ddc84;
  --color-warn: #f5c542;
  --color-danger: #ff6b6b;
  --color-accent: #7cf5b4;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

html,
body {
  background: var(--color-bg);
  color: var(--color-text);
}

body {
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
```

Colors: `--color-muted` on `--color-bg` and `--color-surface` is above 4.5:1; keep any new text colors at WCAG AA too.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/format.test.ts`:
```ts
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
```

`apps/web/src/lib/traceState.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ChainNode, TraceResult } from "@pumpfun/shared";
import { applyEvent, emptyView, traceReducer, viewFromResult } from "./traceState";

const node = (address: string, chainRoot = "DEV"): ChainNode => ({
  address,
  depth: 0,
  role: "deployer",
  chainRoot,
  fundedBy: null,
  fundingAmountLamports: null,
  fundedAt: null,
  fundingSignature: null,
  terminal: null,
});

describe("applyEvent", () => {
  it("records step progress", () => {
    const v = applyEvent(emptyView, { type: "step", data: { step: "funders", state: "running" } });
    expect(v.steps).toEqual({ funders: "running" });
  });

  it("adds each node once per chain", () => {
    let v = applyEvent(emptyView, { type: "node", data: node("A") });
    v = applyEvent(v, { type: "node", data: node("A") });
    v = applyEvent(v, { type: "node", data: node("A", "CREATOR") });
    expect(v.nodes).toHaveLength(2);
  });

  it("finishes on done or error", () => {
    expect(applyEvent(emptyView, { type: "done", data: { partial: true } })).toMatchObject({ done: true, partial: true });
    expect(applyEvent(emptyView, { type: "error", data: { message: "boom" } })).toMatchObject({ done: true, error: "boom" });
  });
});

describe("traceReducer", () => {
  it("builds a finished view from a cached result", () => {
    const result = {
      token: { mint: "M" },
      nodes: [node("A")],
      devHistory: [],
      devHistoryPartial: false,
      devStatus: null,
      crosslinks: [],
      score: { score: 10, level: "low", factors: [], incomplete: false },
      partial: false,
      finishedAt: 1,
    } as unknown as TraceResult;
    const v = traceReducer(emptyView, { kind: "result", result });
    expect(v).toMatchObject({ done: true, nodes: [node("A")], score: { score: 10 } });
    expect(v.steps).toEqual({ token: "done", funders: "done", devActivity: "done", crosslinks: "done", score: "done" });
    expect(viewFromResult(result)).toEqual(v);
  });

  it("resets", () => {
    const busy = applyEvent(emptyView, { type: "node", data: node("A") });
    expect(traceReducer(busy, { kind: "reset" })).toBe(emptyView);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @pumpfun/web test`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement the lib files**

`apps/web/src/lib/format.ts`:
```ts
import type { ChainNode } from "@pumpfun/shared";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

export function relTime(unixSec: number, nowSec = Date.now() / 1000): string {
  const diff = Math.round(unixSec - nowSec);
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), "day");
  if (abs < 86_400 * 365) return rtf.format(Math.round(diff / (86_400 * 30)), "month");
  return rtf.format(Math.round(diff / (86_400 * 365)), "year");
}

export function roleLabel(node: ChainNode): string {
  if (node.role === "deployer") return "Dev (deployer)";
  if (node.role === "creator") return "Current creator";
  return `Funder · hop ${node.depth}`;
}
```

`apps/web/src/lib/risk.ts`:
```ts
import type { RiskLevel, TerminalReason } from "@pumpfun/shared";

export type Tone = "safe" | "warn" | "danger" | "neutral";

export const levelTone: Record<RiskLevel, Exclude<Tone, "neutral">> = { low: "safe", medium: "warn", high: "danger" };

export const toneText: Record<Tone, string> = {
  safe: "text-safe",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-muted",
};

export const terminalLabel: Record<TerminalReason, string> = {
  high_activity: "High-activity wallet (likely an exchange or service). Trace stops here.",
  unknown_origin: "Not funded by a plain SOL transfer (swap, bridge, or too old). Trace stops here.",
  max_depth: "Trace depth limit reached.",
  loop: "Funding loops back to a wallet already in this chain.",
  incomplete: "Could not be fetched (RPC error).",
};

export const terminalShort: Record<TerminalReason, string> = {
  high_activity: "Likely exchange",
  unknown_origin: "Origin unknown",
  max_depth: "Depth limit",
  loop: "Loop",
  incomplete: "Fetch failed",
};
```

`apps/web/src/lib/api.ts`:
```ts
import type { RecentTrace, TraceEvent, TraceResult, WalletView } from "@pumpfun/shared";

export type StartTraceResponse = { cached: true; result: TraceResult } | { jobId: string };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function startTrace(mint: string): Promise<StartTraceResponse> {
  return json(
    await fetch("/api/trace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mint }),
    }),
  );
}

/** Opens the SSE stream. Returns a function that closes it. */
export function streamTrace(jobId: string, onEvent: (event: TraceEvent) => void): () => void {
  const source = new EventSource(`/api/trace/${encodeURIComponent(jobId)}/stream`);
  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as TraceEvent;
    onEvent(event);
    if (event.type === "done" || event.type === "error") source.close();
  };
  return () => source.close();
}

export async function fetchRecent(): Promise<RecentTrace[]> {
  return json(await fetch("/api/recent"));
}

export async function fetchWallet(address: string): Promise<WalletView> {
  return json(await fetch(`/api/wallet/${encodeURIComponent(address)}`));
}
```

`apps/web/src/lib/traceState.ts`:
```ts
import type {
  ChainNode,
  Crosslink,
  DevStatus,
  DevToken,
  RiskScore,
  StepName,
  StepState,
  TokenInfo,
  TraceEvent,
  TraceResult,
} from "@pumpfun/shared";

export interface TraceView {
  token: TokenInfo | null;
  nodes: ChainNode[];
  devHistory: DevToken[] | null;
  devHistoryPartial: boolean;
  devStatus: DevStatus | null;
  crosslinks: Crosslink[] | null;
  score: RiskScore | null;
  steps: Partial<Record<StepName, StepState>>;
  done: boolean;
  partial: boolean;
  error: string | null;
}

export const emptyView: TraceView = {
  token: null,
  nodes: [],
  devHistory: null,
  devHistoryPartial: false,
  devStatus: null,
  crosslinks: null,
  score: null,
  steps: {},
  done: false,
  partial: false,
  error: null,
};

export type TraceAction = { kind: "reset" } | { kind: "result"; result: TraceResult } | { kind: "event"; event: TraceEvent };

const nodeKey = (n: ChainNode) => `${n.chainRoot}:${n.address}`;

export function applyEvent(v: TraceView, e: TraceEvent): TraceView {
  switch (e.type) {
    case "step":
      return { ...v, steps: { ...v.steps, [e.data.step]: e.data.state } };
    case "token":
      return { ...v, token: e.data };
    case "node":
      if (v.nodes.some((n) => nodeKey(n) === nodeKey(e.data))) return v;
      return { ...v, nodes: [...v.nodes, e.data] };
    case "devHistory":
      return { ...v, devHistory: e.data.tokens, devHistoryPartial: e.data.partial };
    case "devStatus":
      return { ...v, devStatus: e.data };
    case "crosslinks":
      return { ...v, crosslinks: e.data };
    case "score":
      return { ...v, score: e.data };
    case "done":
      return { ...v, done: true, partial: e.data.partial };
    case "error":
      return { ...v, done: true, error: e.data.message };
  }
}

export function viewFromResult(r: TraceResult): TraceView {
  return {
    token: r.token,
    nodes: r.nodes,
    devHistory: r.devHistory,
    devHistoryPartial: r.devHistoryPartial,
    devStatus: r.devStatus,
    crosslinks: r.crosslinks,
    score: r.score,
    steps: { token: "done", funders: "done", devActivity: "done", crosslinks: "done", score: "done" },
    done: true,
    partial: r.partial,
    error: null,
  };
}

export function traceReducer(v: TraceView, a: TraceAction): TraceView {
  switch (a.kind) {
    case "reset":
      return emptyView;
    case "result":
      return viewFromResult(a.result);
    case "event":
      return applyEvent(v, a.event);
  }
}
```

`apps/web/src/lib/useTrace.ts`:
```ts
import { useEffect, useReducer, useState } from "react";
import { startTrace, streamTrace } from "./api";
import { emptyView, traceReducer, type TraceView } from "./traceState";

export function useTrace(mint: string): { view: TraceView; retry: () => void } {
  const [view, dispatch] = useReducer(traceReducer, emptyView);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    dispatch({ kind: "reset" });
    startTrace(mint)
      .then((res) => {
        if (cancelled) return;
        if ("cached" in res) dispatch({ kind: "result", result: res.result });
        else stop = streamTrace(res.jobId, (event) => dispatch({ kind: "event", event }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Request failed";
        dispatch({ kind: "event", event: { type: "error", data: { message } } });
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [mint, attempt]);

  return { view, retry: () => setAttempt((a) => a + 1) };
}
```

`apps/web/src/lib/useMediaQuery.ts`:
```ts
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @pumpfun/web test` → PASS.
Run: `pnpm --filter @pumpfun/web typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): scaffold, trace state reducer and API client"
```

---

### Task 14: Web pages and components

**Files:**
- Create: `apps/web/src/main.tsx`, `apps/web/src/router.tsx`
- Create: `apps/web/src/components/ui.tsx`, `Layout.tsx`, `SearchBox.tsx`, `TokenHeader.tsx`, `RiskCard.tsx`, `StepProgress.tsx`, `FunderGraph.tsx`, `FunderTimeline.tsx`, `NodeDetail.tsx`, `DevStatusCard.tsx`, `DevHistoryTable.tsx`, `CrosslinksList.tsx`
- Create: `apps/web/src/pages/HomePage.tsx`, `TokenPage.tsx`, `WalletPage.tsx`

**Interfaces:**
- Consumes: everything from Task 13.
- Produces: routes `/`, `/token/$mint`, `/wallet/$address`. Accessible names used by Task 15: input labelled "Token contract address", button "Trace", node role labels from `roleLabel`, risk factor reason text, the score number.

UI rules (from the spec): dark theme, green = safe, yellow = medium, red = danger; skeletons while streaming; graph on ≥768 px, vertical timeline below; copy and share buttons; Solscan links; disclaimer in the footer; visible keyboard focus.

- [ ] **Step 1: Shared UI pieces**

`apps/web/src/components/ui.tsx`:
```tsx
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { shortAddress } from "@pumpfun/shared";
import type { Tone } from "../lib/risk";

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const badgeTones: Record<Tone, string> = {
  neutral: "border-line text-muted",
  safe: "border-safe/40 text-safe",
  warn: "border-warn/40 text-warn",
  danger: "border-danger/40 text-danger",
};

export function Badge({ tone = "neutral", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="rounded px-1.5 py-0.5 text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function Address({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Link to="/wallet/$address" params={{ address: value }} className="font-mono text-sm hover:text-accent">
        {shortAddress(value)}
      </Link>
      <CopyButton value={value} />
    </span>
  );
}
```

`apps/web/src/components/Layout.tsx`:
```tsx
import { Link, Outlet } from "@tanstack/react-router";

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="font-mono font-semibold text-accent">
            pumpfun.dev
          </Link>
          <span className="text-xs text-muted">dev wallet screener</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted">
          Heuristic on-chain analysis. Not financial advice. Data from public Solana RPC.
        </div>
      </footer>
    </div>
  );
}
```

`apps/web/src/components/SearchBox.tsx`:
```tsx
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { TraceRequest } from "@pumpfun/shared";

export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(raw: string) {
    const parsed = TraceRequest.safeParse({ mint: raw });
    if (!parsed.success) {
      setError("That doesn't look like a Solana token address.");
      return;
    }
    setError(null);
    void navigate({ to: "/token/$mint", params: { mint: parsed.data.mint } });
  }

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <label htmlFor="ca" className="sr-only">
        Token contract address
      </label>
      <div className="flex gap-2">
        <input
          id="ca"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            e.preventDefault();
            setValue(text);
            submit(text);
          }}
          placeholder="Paste a pump.fun token address"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "ca-error" : undefined}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 py-3 font-mono text-sm placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Trace
        </button>
      </div>
      {error && (
        <p id="ca-error" role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Token page components**

`apps/web/src/components/TokenHeader.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { shortAddress, type TokenInfo } from "@pumpfun/shared";
import { Badge, CopyButton, Skeleton } from "./ui";

const toHttp = (uri: string) => (uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri);

export function TokenHeader({ token, mint }: { token: TokenInfo | null; mint: string }) {
  const meta = useQuery({
    queryKey: ["token-meta", token?.uri],
    enabled: Boolean(token?.uri),
    queryFn: async () => (await (await fetch(toHttp(token!.uri!))).json()) as { image?: string },
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  });

  if (!token) {
    return (
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
    );
  }

  const image = meta.data?.image ? toHttp(meta.data.image) : null;
  return (
    <div className="flex flex-wrap items-center gap-4">
      {image ? (
        <img src={image} alt="" className="size-14 rounded-xl object-cover" />
      ) : (
        <div className="grid size-14 place-items-center rounded-xl bg-surface-2 font-mono text-muted">{(token.symbol ?? "?").slice(0, 2)}</div>
      )}
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">
          {token.name ?? "Unknown token"} {token.symbol && <span className="text-muted">${token.symbol}</span>}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="font-mono">{shortAddress(mint)}</span>
          <CopyButton value={mint} />
          <CopyButton value={typeof window === "undefined" ? mint : window.location.href} label="Share" />
          <a href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer" className="hover:text-text">
            pump.fun ↗
          </a>
          <a href={`https://solscan.io/token/${mint}`} target="_blank" rel="noreferrer" className="hover:text-text">
            Solscan ↗
          </a>
          {token.complete && <Badge tone="safe">Migrated</Badge>}
          {token.isMayhemMode && (
            <Badge tone="warn" title="pump.fun's AI agent trades this coin during its first 24 hours, so early volume is not purely organic.">
              Mayhem mode
            </Badge>
          )}
          {token.quoteMint && <Badge>Quote {shortAddress(token.quoteMint)}</Badge>}
          {token.creatorCurrent && token.creatorCurrent !== token.deployer && (
            <Badge tone="warn" title="Creator rights were moved away from the deploying wallet. Both wallets are traced.">
              Creator rights moved
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
```

`apps/web/src/components/RiskCard.tsx`:
```tsx
import type { RiskLevel, RiskScore } from "@pumpfun/shared";
import { levelTone, toneText } from "../lib/risk";
import { Card, Skeleton } from "./ui";

export function RiskCard({ score, done }: { score: RiskScore | null; done: boolean }) {
  if (!score) {
    return (
      <Card title="Risk">
        <Skeleton className="h-14 w-28" />
        <p className="mt-3 text-sm text-muted">{done ? "Score unavailable." : "Scoring once the trace finishes…"}</p>
      </Card>
    );
  }
  return (
    <Card title="Risk">
      <div className="flex items-end gap-3">
        <span className={`text-5xl font-semibold tabular-nums ${toneText[levelTone[score.level]]}`}>{score.score}</span>
        <span className="pb-2 text-sm text-muted">/ 100 · {score.level} risk</span>
      </div>
      {score.incomplete && <p className="mt-2 text-xs text-warn">Some data could not be fetched, so the score may be understated.</p>}
      {score.factors.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {score.factors.map((f) => (
            <li key={f.id} className="flex gap-3 text-sm">
              <span className="mt-0.5 h-fit shrink-0 rounded bg-danger/15 px-1.5 text-xs font-semibold tabular-nums text-danger">+{f.points}</span>
              <span>{f.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">None of our checks found a red flag. That is not a guarantee.</p>
      )}
    </Card>
  );
}

export function ScorePill({ score, level }: { score: number; level: RiskLevel }) {
  return <span className={`font-mono text-sm tabular-nums ${toneText[levelTone[level]]}`}>{score}</span>;
}
```

`apps/web/src/components/StepProgress.tsx`:
```tsx
import type { StepName, StepState } from "@pumpfun/shared";

const STEPS: { id: StepName; label: string }[] = [
  { id: "token", label: "Token" },
  { id: "funders", label: "Funding chain" },
  { id: "devActivity", label: "Dev activity" },
  { id: "crosslinks", label: "Cross-links" },
  { id: "score", label: "Score" },
];

const stateClass: Record<StepState | "pending", string> = {
  pending: "border-line text-muted",
  running: "animate-pulse border-accent text-accent",
  done: "border-safe/40 text-safe",
  incomplete: "border-warn/40 text-warn",
};

export function StepProgress({ steps, done }: { steps: Partial<Record<StepName, StepState>>; done: boolean }) {
  if (done) return null;
  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label="Trace progress">
      {STEPS.map((s) => (
        <li key={s.id} className={`rounded-full border px-2.5 py-1 ${stateClass[steps[s.id] ?? "pending"]}`}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}
```

`apps/web/src/components/FunderGraph.tsx`:
```tsx
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion } from "motion/react";
import { formatSol, shortAddress, type ChainNode } from "@pumpfun/shared";
import { relTime, roleLabel } from "../lib/format";
import { terminalShort } from "../lib/risk";

type WalletNodeData = { node: ChainNode; selected: boolean };
type WalletFlowNode = Node<WalletNodeData, "wallet">;

function WalletNode({ data }: NodeProps<WalletFlowNode>) {
  const n = data.node;
  const border = data.selected ? "border-accent" : n.terminal && n.terminal !== "max_depth" ? "border-warn/50" : "border-line";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`w-56 rounded-lg border bg-surface px-3 py-2 text-left ${border}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted">
        <span>{roleLabel(n)}</span>
        {n.fundedAt && <span>{relTime(n.fundedAt)}</span>}
      </div>
      <div className="font-mono text-sm text-text">{shortAddress(n.address)}</div>
      {n.fundingAmountLamports && <div className="text-xs text-muted">received {formatSol(n.fundingAmountLamports)}</div>}
      {n.terminal && <div className="mt-1 text-xs text-warn">{terminalShort[n.terminal]}</div>}
      <Handle type="source" position={Position.Bottom} />
    </motion.div>
  );
}

const nodeTypes = { wallet: WalletNode };
const id = (n: ChainNode) => `${n.chainRoot}:${n.address}`;

export function FunderGraph({ nodes, selected, onSelect }: { nodes: ChainNode[]; selected: string | null; onSelect: (address: string) => void }) {
  const roots = [...new Set(nodes.map((n) => n.chainRoot))];
  // Funders sit above the wallet they funded; arrows point down, in the direction SOL moved.
  const flowNodes: WalletFlowNode[] = nodes.map((n) => ({
    id: id(n),
    type: "wallet",
    position: { x: roots.indexOf(n.chainRoot) * 280, y: -n.depth * 130 },
    data: { node: n, selected: selected === n.address },
    draggable: false,
  }));
  const edges: Edge[] = nodes
    .filter((n) => n.fundedBy && nodes.some((m) => m.chainRoot === n.chainRoot && m.address === n.fundedBy))
    .map((n) => ({
      id: `${n.chainRoot}:${n.fundedBy}->${n.address}`,
      source: `${n.chainRoot}:${n.fundedBy}`,
      target: id(n),
      animated: true,
      style: { stroke: "var(--color-accent)" },
    }));

  return (
    <div className="h-[520px]" aria-label="Funding chain graph">
      <ReactFlow
        key={flowNodes.length}
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        colorMode="dark"
        nodesConnectable={false}
        onNodeClick={(_, node) => onSelect(node.data.node.address)}
      >
        <Background color="#1f2a24" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
```

`apps/web/src/components/FunderTimeline.tsx`:
```tsx
import { formatSol, shortAddress, type ChainNode } from "@pumpfun/shared";
import { relTime, roleLabel } from "../lib/format";
import { terminalLabel } from "../lib/risk";

export function FunderTimeline({ nodes, selected, onSelect }: { nodes: ChainNode[]; selected: string | null; onSelect: (address: string) => void }) {
  const roots = [...new Set(nodes.map((n) => n.chainRoot))];
  return (
    <div className="space-y-6">
      {roots.map((root) => (
        <ol key={root} className="space-y-3 border-l border-line pl-4">
          {nodes
            .filter((n) => n.chainRoot === root)
            .sort((a, b) => a.depth - b.depth)
            .map((n) => (
              <li key={n.address}>
                <button
                  type="button"
                  onClick={() => onSelect(n.address)}
                  className={`w-full rounded-lg border bg-surface px-3 py-2 text-left hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${selected === n.address ? "border-accent" : "border-line"}`}
                >
                  <div className="text-[11px] uppercase tracking-wide text-muted">{roleLabel(n)}</div>
                  <div className="font-mono text-sm">{shortAddress(n.address)}</div>
                  {n.fundingAmountLamports && (
                    <div className="text-xs text-muted">
                      received {formatSol(n.fundingAmountLamports)} from the wallet below{n.fundedAt ? ` · ${relTime(n.fundedAt)}` : ""}
                    </div>
                  )}
                  {n.terminal && <div className="mt-1 text-xs text-warn">{terminalLabel[n.terminal]}</div>}
                </button>
              </li>
            ))}
        </ol>
      ))}
    </div>
  );
}
```

`apps/web/src/components/NodeDetail.tsx`:
```tsx
import { Link } from "@tanstack/react-router";
import { formatSol, type ChainNode } from "@pumpfun/shared";
import { roleLabel } from "../lib/format";
import { terminalLabel } from "../lib/risk";
import { Card, CopyButton } from "./ui";

export function NodeDetail({ node, onClose }: { node: ChainNode | null; onClose: () => void }) {
  if (!node) return null;
  return (
    <Card
      title="Selected wallet"
      action={
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-text">
          Close
        </button>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Address</dt>
        <dd className="break-all font-mono text-xs">
          {node.address} <CopyButton value={node.address} />
        </dd>
        <dt className="text-muted">Role</dt>
        <dd>{roleLabel(node)}</dd>
        {node.fundedBy && (
          <>
            <dt className="text-muted">First SOL from</dt>
            <dd className="break-all font-mono text-xs">{node.fundedBy}</dd>
          </>
        )}
        {node.fundingAmountLamports && (
          <>
            <dt className="text-muted">Amount</dt>
            <dd>{formatSol(node.fundingAmountLamports)}</dd>
          </>
        )}
        {node.fundedAt && (
          <>
            <dt className="text-muted">When</dt>
            <dd>{new Date(node.fundedAt * 1000).toLocaleString()}</dd>
          </>
        )}
        {node.terminal && (
          <>
            <dt className="text-muted">Trace stopped</dt>
            <dd className="text-warn">{terminalLabel[node.terminal]}</dd>
          </>
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link to="/wallet/$address" params={{ address: node.address }} className="text-accent hover:underline">
          Wallet page
        </Link>
        <a href={`https://solscan.io/account/${node.address}`} target="_blank" rel="noreferrer" className="text-muted hover:text-text">
          Solscan ↗
        </a>
        {node.fundingSignature && (
          <a href={`https://solscan.io/tx/${node.fundingSignature}`} target="_blank" rel="noreferrer" className="text-muted hover:text-text">
            Funding tx ↗
          </a>
        )}
      </div>
    </Card>
  );
}
```

`apps/web/src/components/DevStatusCard.tsx`:
```tsx
import { Fragment } from "react";
import { formatTokenAmount, type DevStatus } from "@pumpfun/shared";
import { Address, Card, Skeleton } from "./ui";

export function DevStatusCard({ status, loading }: { status: DevStatus | null; loading: boolean }) {
  if (!status) {
    return <Card title="Dev position">{loading ? <Skeleton className="h-24" /> : <p className="text-sm text-muted">Could not load dev activity.</p>}</Card>;
  }
  const rows: [string, string | null][] = [
    ["Initial buy", status.initialBuy],
    ["Bought later", status.bought],
    ["Sold", status.sold],
    ["Moved to other wallets", status.transferredOut],
    ["Holding now", status.balance],
  ];
  const pct = status.releasedPct;
  return (
    <Card title="Dev position">
      {pct !== null && (
        <div className="mb-4">
          <div className="flex justify-between text-sm">
            <span>Released (sold + moved)</span>
            <span className="tabular-nums">{pct.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Share of dev tokens released">
            <div className={`h-2 rounded-full ${pct >= 50 ? "bg-danger" : pct >= 20 ? "bg-warn" : "bg-safe"}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="text-right tabular-nums">{value === null ? "unknown" : formatTokenAmount(value)}</dd>
          </Fragment>
        ))}
      </dl>
      {status.transfers.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs uppercase tracking-wide text-muted">Moved to</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {status.transfers.map((t) => (
              <li key={`${t.signature}-${t.to}`} className="flex items-center justify-between gap-2">
                <Address value={t.to} />
                <span className="tabular-nums">{formatTokenAmount(t.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {status.partial && <p className="mt-3 text-xs text-warn">The dev has many transactions; only the most recent were checked.</p>}
    </Card>
  );
}
```

`apps/web/src/components/DevHistoryTable.tsx`:
```tsx
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { shortAddress, type DevToken } from "@pumpfun/shared";
import { relTime } from "../lib/format";
import { Badge, Card, Skeleton } from "./ui";

const statusBadge: Record<DevToken["status"], ReactNode> = {
  alive: <Badge>Active</Badge>,
  migrated: <Badge tone="safe">Migrated</Badge>,
  dead_dev_exited: <Badge tone="danger">Dead, dev exited</Badge>,
};

export function DevHistoryTable({ tokens, partial, loading }: { tokens: DevToken[] | null; partial: boolean; loading: boolean }) {
  return (
    <Card title="Dev's other launches">
      {tokens === null ? (
        loading ? <Skeleton className="h-24" /> : <p className="text-sm text-muted">Could not load.</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted">No other pump.fun launches found from this dev wallet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Token</th>
                <th className="py-2 pr-4 font-medium">Launched</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tokens.map((t) => (
                <tr key={t.mint}>
                  <td className="py-2 pr-4">
                    <Link to="/token/$mint" params={{ mint: t.mint }} className="hover:text-accent">
                      {t.symbol ? `$${t.symbol}` : shortAddress(t.mint)}
                    </Link>{" "}
                    <span className="text-muted">{t.name}</span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-muted">{t.createdAt ? relTime(t.createdAt) : "unknown"}</td>
                  <td className="py-2">{statusBadge[t.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {partial && <p className="mt-3 text-xs text-warn">Only the dev's most recent transactions were scanned; older launches may be missing.</p>}
    </Card>
  );
}
```

`apps/web/src/components/CrosslinksList.tsx`:
```tsx
import { Link } from "@tanstack/react-router";
import { shortAddress, type Crosslink } from "@pumpfun/shared";
import { Address, Card, Skeleton } from "./ui";

const roleText: Record<Crosslink["role"], string> = {
  deployer: "the dev",
  creator: "the creator",
  funder: "a funder",
  insider: "an insider",
};

export function CrosslinksList({ links, loading }: { links: Crosslink[] | null; loading: boolean }) {
  return (
    <Card title="Seen in other traces">
      {links === null ? (
        loading ? <Skeleton className="h-16" /> : <p className="text-sm text-muted">Could not load.</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted">None of these wallets appear in other traced tokens yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {links.map((l) => (
            <li key={`${l.wallet}-${l.otherMint}-${l.role}`} className="flex flex-wrap items-center gap-x-2">
              <Address value={l.wallet} />
              <span className="text-muted">was {roleText[l.role]} in</span>
              <Link to="/token/$mint" params={{ mint: l.otherMint }} className="text-accent hover:underline">
                {l.otherSymbol ? `$${l.otherSymbol}` : shortAddress(l.otherMint)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Pages**

`apps/web/src/pages/HomePage.tsx`:
```tsx
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { shortAddress } from "@pumpfun/shared";
import { fetchRecent } from "../lib/api";
import { ScorePill } from "../components/RiskCard";
import { SearchBox } from "../components/SearchBox";
import { Skeleton } from "../components/ui";

export function HomePage() {
  const recent = useQuery({ queryKey: ["recent"], queryFn: fetchRecent });
  return (
    <div className="mx-auto max-w-3xl py-10 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Who funded the dev?</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Paste a pump.fun token. We follow the dev wallet's first SOL back through up to five wallets, check the dev's past launches, and flag patterns
        common in rugs.
      </p>
      <div className="mt-8">
        <SearchBox autoFocus />
      </div>
      <section className="mt-12">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Recently traced</h2>
        <div className="mt-3">
          {recent.isPending ? (
            <Skeleton className="h-32" />
          ) : recent.data && recent.data.length > 0 ? (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {recent.data.map((r) => (
                <li key={r.mint}>
                  <Link to="/token/$mint" params={{ mint: r.mint }} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-2">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{r.symbol ? `$${r.symbol}` : shortAddress(r.mint)}</span>
                      <span className="ml-2 text-sm text-muted">{r.name}</span>
                    </span>
                    <ScorePill score={r.score} level={r.level} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing traced yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
```

`apps/web/src/pages/TokenPage.tsx`:
```tsx
import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { CrosslinksList } from "../components/CrosslinksList";
import { DevHistoryTable } from "../components/DevHistoryTable";
import { DevStatusCard } from "../components/DevStatusCard";
import { FunderGraph } from "../components/FunderGraph";
import { FunderTimeline } from "../components/FunderTimeline";
import { NodeDetail } from "../components/NodeDetail";
import { RiskCard } from "../components/RiskCard";
import { StepProgress } from "../components/StepProgress";
import { TokenHeader } from "../components/TokenHeader";
import { Card, Skeleton } from "../components/ui";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useTrace } from "../lib/useTrace";

export function TokenPage() {
  const { mint } = useParams({ from: "/token/$mint" });
  const { view, retry } = useTrace(mint);
  const [selected, setSelected] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 768px)");
  const selectedNode = view.nodes.find((n) => n.address === selected) ?? null;
  const loading = !view.done;

  if (view.error && !view.token) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-xl font-semibold">Couldn't trace this token</h1>
        <p className="mt-2 text-muted">{view.error}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={retry} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-accent">
            Try again
          </button>
          <Link to="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg">
            New search
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TokenHeader token={view.token} mint={mint} />
      <StepProgress steps={view.steps} done={view.done} />
      {view.error && (
        <p role="alert" className="text-sm text-danger">
          {view.error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card title="Funding chain">
            {view.nodes.length === 0 ? (
              <Skeleton className="h-40" />
            ) : wide ? (
              <FunderGraph nodes={view.nodes} selected={selected} onSelect={setSelected} />
            ) : (
              <FunderTimeline nodes={view.nodes} selected={selected} onSelect={setSelected} />
            )}
            <p className="mt-3 text-xs text-muted">Each link is the first SOL transfer the funded wallet ever received.</p>
          </Card>
          <NodeDetail node={selectedNode} onClose={() => setSelected(null)} />
          <DevHistoryTable tokens={view.devHistory} partial={view.devHistoryPartial} loading={loading} />
        </div>
        <div className="space-y-6">
          <RiskCard score={view.score} done={view.done} />
          <DevStatusCard status={view.devStatus} loading={loading} />
          <CrosslinksList links={view.crosslinks} loading={loading} />
        </div>
      </div>
    </div>
  );
}
```

`apps/web/src/pages/WalletPage.tsx`:
```tsx
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { shortAddress } from "@pumpfun/shared";
import { FunderTimeline } from "../components/FunderTimeline";
import { Badge, Card, CopyButton, Skeleton } from "../components/ui";
import { fetchWallet } from "../lib/api";
import { relTime } from "../lib/format";

export function WalletPage() {
  const { address } = useParams({ from: "/wallet/$address" });
  const navigate = useNavigate();
  const wallet = useQuery({ queryKey: ["wallet", address], queryFn: () => fetchWallet(address) });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted">Wallet</p>
        <h1 className="mt-1 break-all font-mono text-lg">
          {address} <CopyButton value={address} />
        </h1>
        <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-text">
          Solscan ↗
        </a>
      </div>
      {wallet.isPending ? (
        <Skeleton className="h-40" />
      ) : wallet.isError ? (
        <p role="alert" className="text-danger">
          {wallet.error.message}
        </p>
      ) : !wallet.data.known ? (
        <Card>
          <p className="text-sm text-muted">This wallet hasn't appeared in any trace yet. Trace a token it launched or funded to fill this in.</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Funding chain">
            {wallet.data.chain.length > 0 ? (
              <FunderTimeline nodes={wallet.data.chain} selected={address} onSelect={(a) => void navigate({ to: "/wallet/$address", params: { address: a } })} />
            ) : (
              <p className="text-sm text-muted">Funding not traced yet.</p>
            )}
          </Card>
          <div className="space-y-6">
            <Card title="Tokens launched">
              {wallet.data.deployed.length === 0 ? (
                <p className="text-sm text-muted">None known.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {wallet.data.deployed.map((t) => (
                    <li key={t.mint} className="flex items-center justify-between gap-2">
                      <Link to="/token/$mint" params={{ mint: t.mint }} className="hover:text-accent">
                        {t.symbol ? `$${t.symbol}` : shortAddress(t.mint)} <span className="text-muted">{t.createdAt ? relTime(t.createdAt) : ""}</span>
                      </Link>
                      {t.status === "dead_dev_exited" && <Badge tone="danger">Dead, dev exited</Badge>}
                      {t.status === "migrated" && <Badge tone="safe">Migrated</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Appears in traces">
              {wallet.data.appearances.length === 0 ? (
                <p className="text-sm text-muted">None.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {wallet.data.appearances.map((a) => (
                    <li key={`${a.mint}-${a.role}`}>
                      <Link to="/token/$mint" params={{ mint: a.mint }} className="text-accent hover:underline">
                        {a.symbol ? `$${a.symbol}` : shortAddress(a.mint)}
                      </Link>{" "}
                      <span className="text-muted">as {a.role}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Router and entry**

`apps/web/src/router.tsx`:
```tsx
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { TokenPage } from "./pages/TokenPage";
import { WalletPage } from "./pages/WalletPage";

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
const tokenRoute = createRoute({ getParentRoute: () => rootRoute, path: "/token/$mint", component: TokenPage });
const walletRoute = createRoute({ getParentRoute: () => rootRoute, path: "/wallet/$address", component: WalletPage });

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, tokenRoute, walletRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 5: Typecheck and build**

Run: `pnpm --filter @pumpfun/web typecheck` → no errors.
Run: `pnpm --filter @pumpfun/web build` → `dist/` created, no errors.

- [ ] **Step 6: Check it in the browser against the real API**

Run `pnpm dev:api` and `pnpm dev:web` in two terminals. Open http://localhost:5173:
- Home renders; pasting an invalid string shows the inline error; Tab reaches the input and button with a visible focus ring.
- Paste a real pump.fun mint: step chips animate, the graph fills node by node, risk card appears at the end.
- Click a node: detail card opens with Solscan links.
- Resize to 375 px wide: graph becomes the timeline, no horizontal page scroll.
- Open the same token again: result appears instantly (cached).
- Click a wallet link: wallet page shows its chain.

Fix anything broken before committing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): home, token and wallet pages"
```

---

### Task 15: End-to-end test

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/fixtures.ts`, `apps/web/e2e/token.spec.ts`

**Interfaces:**
- Consumes: the UI from Task 14 (input label "Token contract address", button "Trace", text "Dev (deployer)", risk reason text). The API is mocked with `page.route`, so no backend runs.

- [ ] **Step 1: Config and fixture**

Run: `pnpm --filter @pumpfun/web exec playwright install chromium`

`apps/web/playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:5173" },
  webServer: {
    command: "pnpm dev --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

`apps/web/e2e/fixtures.ts`:
```ts
import type { TraceResult } from "@pumpfun/shared";

export const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const DEV = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const FUNDER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

export const sampleResult: TraceResult = {
  token: {
    mint: MINT,
    name: "Test Coin",
    symbol: "TEST",
    uri: null,
    tokenProgram: null,
    quoteMint: null,
    deployer: DEV,
    creatorCurrent: DEV,
    creatorOriginal: DEV,
    createdAt: 1_760_000_000,
    createSignature: "create",
    complete: false,
    isMayhemMode: false,
    devInitialBuy: "1000000000",
    createTxFound: true,
  },
  nodes: [
    { address: DEV, depth: 0, role: "deployer", chainRoot: DEV, fundedBy: FUNDER, fundingAmountLamports: "2000000000", fundedAt: 1_759_999_400, fundingSignature: "fund", terminal: null },
    { address: FUNDER, depth: 1, role: "funder", chainRoot: DEV, fundedBy: null, fundingAmountLamports: null, fundedAt: null, fundingSignature: null, terminal: "unknown_origin" },
  ],
  devHistory: [],
  devHistoryPartial: false,
  devStatus: {
    initialBuy: "1000000000",
    bought: "0",
    sold: "600000000",
    transferredOut: "100000000",
    balance: "300000000",
    releasedPct: 70,
    transfers: [{ to: FUNDER, amount: "100000000", signature: "move" }],
    partial: false,
  },
  crosslinks: [],
  score: {
    score: 50,
    level: "medium",
    factors: [
      { id: "devReleased", points: 25, reason: "Dev has sold or moved 70% of their tokens." },
      { id: "devTransferOut", points: 15, reason: "Dev moved 100 tokens to 1 other wallet." },
      { id: "freshFunding", points: 10, reason: "Dev wallet was funded 10 minutes before launch." },
    ],
    incomplete: false,
  },
  partial: false,
  finishedAt: 1_760_000_100,
};
```

- [ ] **Step 2: Write the tests**

`apps/web/e2e/token.spec.ts`:
```ts
import { expect, test, type Page } from "@playwright/test";
import { MINT, sampleResult } from "./fixtures";

async function mockApi(page: Page) {
  await page.route("**/api/recent", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/trace", (route) => route.fulfill({ json: { cached: true, result: sampleResult } }));
}

test("search leads to a scored token page with the funding graph", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByLabel("Token contract address").fill(MINT);
  await page.getByRole("button", { name: "Trace" }).click();

  await expect(page).toHaveURL(new RegExp(`/token/${MINT}$`));
  await expect(page.getByRole("heading", { name: /Test Coin/ })).toBeVisible();
  await expect(page.getByText("50", { exact: true })).toBeVisible();
  await expect(page.getByText("Dev has sold or moved 70% of their tokens.")).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.getByText("Dev (deployer)").first()).toBeVisible();
});

test("rejects an invalid address inline", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByLabel("Token contract address").fill("hello");
  await page.getByRole("button", { name: "Trace" }).click();
  await expect(page.getByRole("alert")).toHaveText("That doesn't look like a Solana token address.");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the timeline instead of the graph", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/token/${MINT}`);
    await expect(page.getByRole("button", { name: /Dev \(deployer\)/ })).toBeVisible();
    await expect(page.locator(".react-flow")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
```

- [ ] **Step 3: Run**

Run: `pnpm --filter @pumpfun/web e2e`
Expected: 3 passed. If a selector fails, fix the component (not the test) unless the test is wrong about the spec.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(web): end-to-end token page checks"
```

---

### Task 16: Deployment (Docker Compose + Caddy) and docs

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `deploy/Caddyfile`, `README.md`
- Modify: `docs/superpowers/specs/2026-10-20-trace-engine-design.md` (append the planning changes)

**Interfaces:**
- Consumes: `@pumpfun/api` `start` script (Task 11–12), `@pumpfun/web` `build` output `apps/web/dist` (Task 14).
- Produces: `docker compose up -d --build` on a VPS serves https://pumpfun.dev.

- [ ] **Step 1: Container files**

`.dockerignore`:
```
node_modules
**/node_modules
**/dist
*.db
*.db-*
.env
.git
test-results
playwright-report
```

`Dockerfile`:
```dockerfile
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pumpfun/web build

FROM node:24-slim AS api
RUN corepack enable
WORKDIR /app
COPY --from=base /app /app
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "--filter", "@pumpfun/api", "start"]

FROM caddy:2 AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=base /app/apps/web/dist /srv
```

`deploy/Caddyfile`:
```
pumpfun.dev {
	encode zstd gzip

	handle /api/* {
		reverse_proxy api:3001 {
			# keep SSE streaming unbuffered
			flush_interval -1
		}
	}

	handle {
		root * /srv
		try_files {path} /index.html
		file_server
	}
}

www.pumpfun.dev {
	redir https://pumpfun.dev{uri} permanent
}
```

`docker-compose.yml`:
```yaml
services:
  api:
    build:
      context: .
      target: api
    restart: unless-stopped
    env_file: .env
    environment:
      DB_PATH: /data/pumpfun.db
      PORT: "3001"
    volumes:
      - data:/data

  web:
    build:
      context: .
      target: web
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - api

volumes:
  data:
  caddy_data:
  caddy_config:
```

- [ ] **Step 2: Build the images locally**

Run: `docker compose build` (requires Docker Desktop on Windows).
Expected: both `api` and `web` images build. If `pnpm install --frozen-lockfile` fails because `pnpm-lock.yaml` is missing or stale, run `pnpm install` locally, commit the lockfile, and rebuild.

- [ ] **Step 3: README with deploy steps**

`README.md`:
````markdown
# pumpfun.dev

Paste a pump.fun token address and see who funded the dev: the dev wallet's first SOL, traced back up to 5 wallets, the dev's other launches, whether the dev sold or moved tokens, links to other traced tokens, and a heuristic risk score.

Not financial advice. All data comes from public Solana RPC.

## Develop

Requires Node 24+ and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm dev:api     # http://localhost:3001
pnpm dev:web     # http://localhost:5173 (proxies /api)
pnpm test        # unit tests, all packages
pnpm --filter @pumpfun/web e2e
pnpm --filter @pumpfun/api smoke <MINT>   # one trace against live RPC
```

## Layout

- `packages/core`: trace logic (pure, tested with recorded data)
- `packages/solana`: rate-limited Solana RPC client
- `packages/db`: SQLite cache, jobs and results
- `packages/shared`: types shared by API and web
- `apps/api`: Fastify API with SSE streaming
- `apps/web`: React SPA

## Deploy (one VPS)

1. Point DNS for `pumpfun.dev` and `www.pumpfun.dev` (A/AAAA records) at the VPS. `.dev` domains require HTTPS; Caddy gets certificates automatically once DNS resolves.
2. Install Docker and the Compose plugin on the VPS. Open ports 80 and 443.
3. On the VPS:
   ```bash
   git clone <repo> pumpfun.dev && cd pumpfun.dev
   cp .env.example .env    # add extra free RPC endpoints to RPC_URLS if you have them
   docker compose up -d --build
   ```
4. Check: `curl https://pumpfun.dev/api/recent` returns `[]`.

Update: `git pull && docker compose up -d --build`. The SQLite database lives in the `data` volume and survives rebuilds. Back it up with `docker compose cp api:/data/pumpfun.db ./backup.db`.

## Capacity

Public RPC allows about 4 transaction lookups per second per IP. A trace with nothing cached takes roughly 30–70 seconds; cached wallets make repeat traces fast. To go faster, register free-tier keys with RPC providers and append them to `RPC_URLS` (format `url|rps|perMethodRps`).
````

- [ ] **Step 4: Record planning changes in the spec**

Append to `docs/superpowers/specs/2026-10-20-trace-engine-design.md`:
```markdown

## 14. Revisi setelah perencanaan (2026-10-20)

Disepakati saat menyusun rencana implementasi; tidak mengubah apa yang dilihat user.

1. Transport RPC memakai pool `fetch` sendiri (rate limit, rotasi, retry di satu kelas). `@solana/kit` tetap dipakai untuk validasi alamat, PDA, dan base58.
2. Tanpa Drizzle: tabelnya sedikit, cukup `better-sqlite3` langsung.
3. Tanpa CLI shadcn: beberapa komponen Tailwind kecil ditulis sendiri.
4. Transaksi create dicari dari signature tertua milik mint (maksimal 20 halaman). Jalur cepat lewat riwayat creator dihapus karena butuh satu `getTransaction` per signature.
5. Riwayat token dev diambil dari 60 transaksi terbaru dev (dipakai bersama untuk status dev lewat cache transaksi). Jalur cepat `getProgramAccounts` dihapus: akun `BondingCurve` tidak menyimpan mint, dan RPC publik cenderung menolak query itu.
6. Decoder event pump.fun ada di `packages/core`.
7. SSE tidak punya event `edge` terpisah (setiap `node` membawa `fundedBy`); ada event `step` untuk progres.
8. Halaman wallet hanya menampilkan data yang sudah ada di cache.
9. Tabel DB final: `wallets`, `tx_cache`, `tokens`, `dev_tokens`, `trace_wallets`, `trace_results`, `trace_jobs`, `trace_events`. Status dev dan transfer insider disimpan di dalam JSON hasil trace.
```

- [ ] **Step 5: Final verification**

Run: `pnpm test` → all packages PASS.
Run: `pnpm typecheck` → no errors.
Run: `pnpm --filter @pumpfun/web e2e` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: docker compose deploy with caddy, readme, spec revisions"
```
