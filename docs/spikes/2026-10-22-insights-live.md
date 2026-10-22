# Socials, dev habits, risky wallets: live notes (2026-10-22)

Measured on mainnet with the dev API (feed on, `METADATA_FETCH=all`).

## Metadata

- ipfs.io answers every API request with `429 "This IPFS gateway is switching to a service worker gateway only"`. Rewriting CIDs to `ipfs.filebase.io` (30–170 ms) with `4everland.io` as fallback fixed it; `dweb.link`, `w3s.link` and `cf-ipfs.com` failed every probe, `gateway.pinata.cloud` took ~5 s.
- First live window: 98 of 98 new tokens fetched (j7tracker 74, IPFS via gateway 17, others 7).
- X links: 77 tweet links, 14 project accounts, 3 other, 4 none. Linking someone else's tweet is the norm, so it is shown as information, not scored.
- The token page no longer requests metadata from the browser; the only third-party request left is the image itself.

## False positives caught before release

- **Per-token pages on listing sites.** `otcdesks.cash/coin/<mint>` keyed by host made every user of the site look recycled. Website keys now include the path when it contains an address-like segment, and any website, image or X handle shared by more than 20 tokens is treated as a platform and ignored.
- **Image file names are not the target mint.** Axiom-style image names look like mints, but in the live corpus all 107 of them differed from their token's mint, so "image uploaded for another token" would have fired on about half of all launches. The check was built, measured and reverted.

## Dev habits

- Fresh dev (Wares.fun): 0 earlier launches, profile shows only fee claims ("None seen").
- Serial dev `CmwF…g5Rd` re-traced: 6 earlier launches, all dead; first sell a median of ~4.5 seconds after launch on all 6; 3 creator-fee claims totalling 19.7 SOL. New factor `fastSeller` fired alongside `serialDeadDev` and `devReleased`.
- Fee claims come from `CollectCreatorFeeEvent` (pump) and `CollectCoinCreatorFeeEvent` (PumpSwap); the claimer can be a relayer, so they are matched on the event's creator field. Layout `timestamp i64, creator pubkey, fee u64` confirmed against cached mainnet transactions (timestamps equal block times).

## Risky wallets (from the existing dev database)

- 3 devs with ≥ 2 dead launches (top two: 7 of 7), 8 funders, 20 repeat early buyers (top: 12 launches by 12 different devs, 9 in the launch slot; none are mayhem coins), 20 busy launchers (top: 549 creates in 24 h, almost certainly launchpad or bot wallets, which the page says).
