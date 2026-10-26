# Developer cluster page, bundle analysis and bubble map

Date: 2026-10-26. Part A was approved by the user ("ya"). Part B answers "technical features are still weak, e.g. bubble map, bundler": technical choices are Claude's.

## Part A: developer cluster page (`/wallet/$address`)

Everything comes from the database (traces, wallet cache, live feed). No new RPC calls.

### Data (`WalletView` additions)

- `cluster.siblings`: other wallets whose cached first funder equals this wallet's funder (one owner, many dev wallets). Skipped when that funder is a high-activity wallet (exchange). Each with launches known and dead launches. Max 20.
- `cluster.funded`: wallets this address funded first (it may be a funder, not a dev). Each with launches known. Max 20.
- `cluster.repeatBuyers`: wallets that bought within two blocks of launch in 2+ of this dev's tokens, with the count. Max 20.
- `cluster.insiders`: wallets the dev sent tokens to, across this dev's traced tokens, with the count. Max 20.
- `feedLaunches`: this creator's tokens from the live feed (traced or not), with progress, peak, migration, recycled socials, quick score and trace score.
- `firstSeenAt`: the wallet's oldest activity when cached.
- `archetype`: `{ kind: "runner" | "recycler" | "rugger" | "unclear", evidence: string[] }` from `classifyDev` in core.

### Classification (`packages/core/src/devArchetype.ts`, pure)

Inputs: launches (union of traced and feed, by mint), dead (dev exited), migrated, dumped curves, fast sells and sells observed, launches in the last 24 h, siblings, repeat buyers, launches with recycled socials.

Points per kind; the highest wins, ties go rugger > recycler > runner; zero everywhere is "unclear".
- Rugger: dead ≥ 2 and dead ≥ half of launches (2 points); fast sells ≥ 2; dumped ≥ 2; repeat buyers ≥ 2.
- Recycler: 3+ launches in 24 h; siblings ≥ 2; recycled socials ≥ 1.
- Runner: migrated ≥ 1 and ≥ 30 % of launches; no dead launches with 2+ launches; sells observed ≥ 2 with no fast sells.
Each matched rule adds one plain-English evidence line. The page says these are signals, not verdicts.

### Page

Header (address, copy, Solscan, archetype chip with evidence, stats: launches, dead, migrated, linked wallets, known funders, first seen, button to the newest launch). Sticky section nav on desktop: Overview, Wallet graph, Launches, Funding, Behaviour. Wallet graph: SVG, funders chain left, siblings and funded wallets above/below, repeat buyers and insiders around, launches right coloured by status; every node links to its wallet or token page. Launch table merges traced and feed launches (date, status, curve progress, score or quick score, dumped/recycled flags). Funding: existing timeline plus siblings list. Behaviour: dev habits card, repeat buyers, insiders. Unknown wallet: feed launches if any, else the current empty state.

## Part B: bundle analysis and bubble map

### Bundle analysis (core `holders.ts`)

`findEarlyBuyers` keeps each buyer's transaction signature. New per-buyer fields: `signature`, `sameTxAsCreate` (bought inside the create transaction), `txBuyers` (wallets whose balance rose in that same transaction), `fundedBy` and `fresh` (resolved for up to 12 earliest buyers through the cached wallet resolver).

New `HolderAnalysis.bundle` (null when early buyers are unknown):
- `wallets`: buyers in the launch block.
- `boughtPct`, `heldPct`: supply they bought, supply they still hold.
- `sameTxAsCreate`: buyers inside the create transaction.
- `multiBuyerTxs`: transactions in the launch block that credited 2+ wallets.
- `fundedByDev`: early buyers funded by the dev, a dev funder or an insider.
- `sharedFunders`: funders behind 2+ early buyers (ignoring high-activity wallets), with their wallets.
- `fresh`: early buyers whose first activity is under a day old.
- `uniformBuys`: 3+ launch-block buyers whose buys sit within ±10 % of their median.

New score factor `devBundle` (20): 2+ early buyers funded by the dev side, or a create transaction that also bought for other wallets. Reason names the count.

### Bubble map (web)

Purple palette. Shared funders drawn as small diamond hubs joined to the members they fund, so the reason for a cluster is visible; a dev hub when a cluster links to the dev. Wheel/pinch zoom, drag pan, reset button. Filter chips dim everything except: bundle and snipers, clusters, fresh wallets, dev and insiders. Clicking a bubble opens a detail panel (address, share, tags, funder, first seen, cluster) with "Open wallet". Legend under the map. A new Bundle card shows the bundle numbers, a bought-versus-held bar and early buyers grouped by transaction with funder badges.

## Testing

Core: `classifyDev` rules and ties; early buyer transaction grouping, same-tx detection, funder linking, uniform buys, `devBundle` factor. DB: siblings, funded, repeat buyers, insiders, feed launches. Web: e2e fixtures gain the new fields; wallet page renders the archetype, graph links and merged launches; bubble map filter and detail panel.
