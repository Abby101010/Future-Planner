# NorthStar backend — Fly.io deployment image
# Build context: backend/ (the directory this Dockerfile lives in).
# Reorg note: shared/ no longer exists — cognitiveBudget.ts is now duplicated
# into backend/src/domain/, so the backend is fully self-contained.
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps from package manifest
COPY package.json package-lock.json* ./
RUN npm install

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build (tsc emits to dist/, mirrors src/ now that rootDir is "src")
RUN npm run build

# ── Runtime stage ────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# schema.sql is read at runtime by dist/db/migrate.js (it joins __dirname +
# 'schema.sql'), but tsc only emits .js — copy the SQL alongside.
COPY --from=builder /app/src/db/schema.sql ./dist/db/schema.sql

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
