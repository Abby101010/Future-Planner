# NorthStar backend — Fly.io deployment image
# Build context: repo root.
# Deploy with: fly deploy (from repo root, uses fly.toml → packages/server/Dockerfile)
FROM node:22-alpine AS builder

WORKDIR /repo

COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/

RUN npm install --workspaces --include-workspace-root

COPY packages/core packages/core
COPY packages/server packages/server

RUN npm --workspace @northstar/core run build \
 && npm --workspace @northstar/server run build

# ── Runtime stage ────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /repo

COPY --from=builder /repo/package.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/core/package.json ./packages/core/package.json
COPY --from=builder /repo/packages/core/dist ./packages/core/dist
COPY --from=builder /repo/packages/core/src ./packages/core/src
COPY --from=builder /repo/packages/server/package.json ./packages/server/package.json
COPY --from=builder /repo/packages/server/dist ./packages/server/dist
COPY --from=builder /repo/packages/server/node_modules ./packages/server/node_modules
# Versioned migrations are read at runtime by dist/src/db/migrate.js
# (resolves ../../../migrations relative to __dirname = dist/src/db)
COPY --from=builder /repo/packages/server/migrations ./packages/server/migrations

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "packages/server/dist/src/index.js"]
