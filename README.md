# pumpfun.dev

Paste a pump.fun token address and see who funded the dev: the dev wallet's first SOL, traced back up to 5 wallets, the dev's other launches, whether the dev sold or moved tokens, links to other traced tokens, and a heuristic risk score. For tokens still on the bonding curve it also maps the holders: top 20 as a bubble map, wallets that look like one owner, launch-block buyers (bundles and snipers), fresh wallets, repeat snipers and the insider share of supply.

The token page embeds a GeckoTerminal market-cap chart (the most liquid pool: bonding curve before migration, PumpSwap after) with links to GeckoTerminal and DexScreener. Each trace also reads the token's metadata (X, Telegram, website, image) and flags socials or images recycled from tokens launched at least an hour earlier, and profiles the dev's habits from their recent transactions: launch rate, how fast they sold earlier launches, and creator-fee claims. The Risky wallets page (`/risky`) ranks devs with the most dead launches, funders behind them, wallets that buy early in many launches, and the busiest launchers, all from this site's own data.

The live screener (`/screener`) lists every new pump.fun launch within seconds: age, market cap, bonding-curve progress, copycat tickers, dumps (curve gave back most of its progress), and the risk score once traced. Tokens that sell 40% of their curve in their first 15 minutes are traced automatically in the background, up to 20 per hour; any other token is traced when someone opens it. New tokens come from PumpPortal's free websocket (create and migration events only); curve numbers come from public RPC.

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

- `packages/core`: trace logic (pure, tested with synthetic transactions)
- `packages/solana`: rate-limited Solana RPC client
- `packages/db`: SQLite cache, jobs and results
- `packages/shared`: types shared by API and web
- `apps/api`: Fastify API with SSE streaming, live feed ingestion (`src/feed`)
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

Public RPC allows about 4 transaction lookups per second per IP. A trace with nothing cached takes roughly 2–5 minutes (holder analysis adds 1–2 minutes) (busy tokens take longest, because their bonding-curve history is long); cached wallets and known creation transactions make repeat traces fast. The screener adds about one `getMultipleAccounts` call every 20 seconds per 100 young tokens, and one background trace at a time; user traces always go first. Set `FEED_ENABLED=false` to turn the screener's ingestion off. To go faster, register free-tier keys with RPC providers and append them to `RPC_URLS` (format `url|rps|perMethodRps`).
