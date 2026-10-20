# Holder analysis on mainnet (2026-10-21)

Endpoint: https://api.mainnet.solana.com.

## RPC capabilities checked before designing

| Call | Result |
|---|---|
| `getTokenLargestAccounts` | Always 429 "Too many requests for a specific RPC call", even after waiting. Unusable on public RPC. |
| `getProgramAccounts` (token program, `memcmp` mint at 0, `dataSlice` 32..72) | Bonding-curve token: 309 accounts, 86 KB, 0.5 s. Fartcoin (migrated): 578,406 accounts, 160 MB, 12 s. |
| `getBlock` (`transactionDetails: "accounts"`, jsonParsed, v1) | ~1,000–1,500 txs, ~5 MB, ~0.5 s per block, with per-owner token balances. |
| publicnode.com `getTokenLargestAccounts` | Requires a personal token. |

Decision: holder analysis only for tokens still on the bonding curve.

## Traces

| Token | State | Holders | Early buyers | Clusters | Holder step cold / warm | Notes |
|---|---|---|---|---|---|---|
| Duke Nukem `3ovf…pump` | migrated | skipped | – | – | 0 s | trace total 5.7 s |
| Axis Robotics `5X76…pump` | bonding curve | 18–19 | none (launch block held only the create tx) | none | 111 s / 3.4 s | 12 of top 20 are fresh wallets; dev funding chain is 5 hops of ~5 SOL each; score 60 |

## Findings

- **Busy funders are real.** Two Axis holders were funded by the same wallet, which has a full 1,000-signature first page (an exchange-like wallet). Not clustering them was correct; without the busy check they would have been reported as one owner.
- **Launch block check verified by hand.** The creation slot of Axis contains exactly one transaction touching the mint (the create + dev buy); the next two slots contain none. "No early buyers" was correct.
- **Cold cost is holder funders.** ~110 s of the holder step is `resolveWallet` for ~19 holders under the per-method rate limit. Repeat traces take seconds.
- **Job timeout.** A cold trace with a 5-hop funder chain plus holders exceeded the old 5-minute job limit and lost the holder step. The default is now 8 minutes, and step failures are logged (`onStepError`) instead of silently swallowed.
- **Dev server note.** Rewriting `vite.config.ts` while Vite runs restarted it without the `/api` proxy (404s); restart the dev server after touching it.
