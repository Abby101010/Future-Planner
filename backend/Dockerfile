# NorthStar backend — Fly.io deployment image
# Build context: repo root (so we can COPY both backend/ and shared/).
# Deploy with: fly deploy --config backend/fly.toml --dockerfile backend/Dockerfile
#   (run from repo root)
FROM node:22-alpine AS builder

# Mirror the repo layout inside the container so tsconfig's rootDir=".."
# and "../shared/**/*.ts" include pattern resolve correctly.
WORKDIR /repo/backend

COPY backend/package.json backend/package-lock.json* ./
RUN npm install

COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY shared /repo/shared

RUN npm run build
# tsc with rootDir=".." emits under dist/ with the repo-root layout:
#   dist/backend/src/*.js
#   dist/shared/**/*.js

# ── Runtime stage ────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=builder /repo/backend/package.json ./
COPY --from=builder /repo/backend/node_modules ./node_modules
COPY --from=builder /repo/backend/dist ./dist
# schema.sql is read at runtime by dist/backend/src/db/migrate.js
# (it joins __dirname + 'schema.sql'); tsc only emits .js so copy it alongside.
COPY --from=builder /repo/backend/src/db/schema.sql ./dist/backend/src/db/schema.sql

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/backend/src/index.js"]
