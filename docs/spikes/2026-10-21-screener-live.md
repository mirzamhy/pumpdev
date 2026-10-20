# Screener live notes (2026-10-21)

Measured against mainnet with public RPC and PumpPortal's free websocket.

## PumpPortal

- `subscribeNewToken` + `subscribeMigration` work without a key. Trade subscriptions need a key funded with ≥ 0.02 SOL, so the screener does not use them.
- Rate seen: 30–36 creates per 30–75 s window at peak, about 0.3–1 per second over longer runs.
- The create stream also carries letsbonk tokens (`pool: "bonk"`) with `bondingCurveKey: null` and different fields. Filtered out by `pool === "pump"`.
- Migration events: `{signature, mint, txType: "migrate", pool: "pump-amm"}`.

## Curves

- Global account: initial virtual tokens 1,073,000,000, virtual SOL 30, initial real tokens 793,100,000, supply 1,000,000,000.
- `virtual_token_reserves − real_token_reserves` is 279,900,000 tokens for every curve, mayhem included, so token-based progress works everywhere. Mayhem curves keep SOL reserves off the normal curve (real SOL tiny relative to virtual), which is why traction is measured by progress and not SOL.
- Some tokens finish the whole curve inside the create transaction (reserves read back as zero, `complete = true`).
- Market cap from the curve matched PumpPortal's `marketCapSol` when no trades happened in between (PEOPLE: 31.8 vs 31.8 SOL).
- In one 75 s sample, 3 of 31 new tokens had ≥ 2 SOL in the curve and 1 had ≥ 10 SOL.

## Findings that changed the design

- **Commitment.** The first auto-trace ran ~30 s after launch and missed the creation transaction: history reads used `finalized`. Everything now reads at `confirmed`.
- **Stale scores.** That token (HUMANOIDS) reached 77% of its curve, was traced at about 40%, then fell to 0% within ten minutes; its score stayed "low". The feed now stores peak progress and shows a `dumped` flag when a curve gives back 60% or more of a peak of at least 20%.
- **Copycats are common.** Within two minutes one ticker (FRIEND) had 12 launches; HUMANOIDS had 6 and Dickachu had 3.

## Auto-trace

- Threshold 40% progress within 15 minutes, 20 per hour, one background trace at a time, at most 2 queued.
- RPC cost of polling: one `getMultipleAccounts` per 100 young tokens every 20 s (about 0.1–0.3 requests per second).
