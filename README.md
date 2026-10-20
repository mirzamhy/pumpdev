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

- `packages/core`: trace logic (pure, tested with synthetic transactions)
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

Public RPC allows about 4 transaction lookups per second per IP. A trace with nothing cached takes roughly 1–3 minutes (busy tokens take longest, because their bonding-curve history is long); cached wallets and known creation transactions make repeat traces fast. To go faster, register free-tier keys with RPC providers and append them to `RPC_URLS` (format `url|rps|perMethodRps`).
