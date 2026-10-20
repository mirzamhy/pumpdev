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
