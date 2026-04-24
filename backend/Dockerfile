# Starward backend — Fly.io deployment image
# Build context: repo root.
# Deploy with: fly deploy (from repo root, uses fly.toml → backend/Dockerfile)
FROM node:22-alpine AS builder

WORKDIR /repo

COPY package.json package-lock.json* ./
COPY backend/core/package.json backend/core/
COPY backend/package.json backend/

RUN npm install --workspaces --include-workspace-root

COPY backend/core backend/core
COPY backend/src backend/src
COPY backend/migrations backend/migrations
COPY backend/tsconfig.json backend/

RUN npm --workspace @starward/core run build \
 && npm --workspace @starward/server run build

# ── Runtime stage ────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /repo

COPY --from=builder /repo/package.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/backend/core/package.json ./backend/core/package.json
COPY --from=builder /repo/backend/core/dist ./backend/core/dist
# Shim files so server code can resolve `@starward/core/handlers` under
# classic Node module resolution. Forward to dist/handlers.js.
COPY --from=builder /repo/backend/core/handlers.js ./backend/core/handlers.js
COPY --from=builder /repo/backend/core/handlers.d.ts ./backend/core/handlers.d.ts
COPY --from=builder /repo/backend/package.json ./backend/package.json
COPY --from=builder /repo/backend/dist ./backend/dist
# Versioned migrations are read at runtime by dist/src/db/migrate.js
# (resolves ../../migrations relative to __dirname = dist/src/db)
COPY --from=builder /repo/backend/migrations ./backend/migrations

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "backend/dist/index.js"]
