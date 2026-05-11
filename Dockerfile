# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS base

# Persistence is now Supabase (Postgres) — no native modules to compile.
# We still need `curl` for the healthcheck and `ca-certificates` for HTTPS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# Copy source
COPY src ./src
COPY assets ./assets

# /app/data/images stores user-uploaded Telegram images served at
# /images/* so Zernio can fetch them. Mount a persistent Railway
# volume at /app/data so images survive deploys.
RUN mkdir -p /app/data/images
ENV DATA_DIR=/app/data
ENV NODE_ENV=production
ENV TZ=Europe/London
ENV PORT=3000

EXPOSE 3000

# Simple healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:${PORT}/health || exit 1

CMD ["node", "src/index.js"]
