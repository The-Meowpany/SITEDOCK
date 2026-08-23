# ── SiteDock Web (client portal) ─────────────────────────────
FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS deps
RUN npm ci --ignore-scripts

FROM base AS build
COPY packages/ packages/
COPY apps/ apps/
COPY tsconfig.base.json ./
RUN npx prisma generate --schema packages/database/prisma/schema.prisma \
  && npm run build -w apps/web

FROM node:20-slim AS runtime
WORKDIR /app
RUN groupadd -r sitedock && useradd -r -g sitedock sitedock

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

USER sitedock
EXPOSE 3000

ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
