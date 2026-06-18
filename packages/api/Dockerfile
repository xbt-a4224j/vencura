# VenCura API — multi-stage build. Pollers run in-process (no separate worker).
# Built from the REPO ROOT as context (needs the pnpm workspace + lockfile):
#   docker build -f packages/api/Dockerfile -t vencura-api .
# syntax=docker/dockerfile:1

FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH"
# Prisma's query engine needs openssl at build- and run-time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# ── build: install everything, build shared→api, generate Prisma client ──────
FROM base AS build
COPY . .
# postinstall runs `prisma generate`; --frozen-lockfile keeps it deterministic.
RUN pnpm install --frozen-lockfile
# shared must compile before api (api imports @vencura/shared/dist).
RUN pnpm --filter @vencura/shared build && pnpm --filter @vencura/api build

# ── runner: carry the built workspace; apply migrations then boot ────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
# Railway injects $PORT (main.ts reads it) and DATABASE_URL. Migrate, then serve.
CMD ["sh", "-c", "pnpm --filter @vencura/api exec prisma migrate deploy && node packages/api/dist/main.js"]
