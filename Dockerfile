# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS base

# better-sqlite3 needs Python and a C++ toolchain to build native bindings
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better caching
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# Copy source
COPY src ./src
COPY assets ./assets

# Persistent data directory (Railway volume should be mounted here)
RUN mkdir -p /app/data/images
ENV DATA_DIR=/app/data
ENV DB_FILE=/app/data/agent.db
ENV NODE_ENV=production
ENV TZ=Europe/London
ENV PORT=3000

EXPOSE 3000

# Simple healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:${PORT}/health || exit 1

CMD ["node", "src/index.js"]
