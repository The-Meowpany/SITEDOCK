# ── SiteDock API ─────────────────────────────────────────────
# Multi-stage: build → runtime slim. No secrets baked in.

FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS deps
RUN npm ci --ignore-scripts

FROM base AS build
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY tsconfig.base.json ./
# Genera el cliente Prisma y compila solo apps/api + sus deps de workspace
RUN npx prisma generate --schema packages/database/prisma/schema.prisma \
  && npm run build -w apps/api --if-present

FROM node:20-slim AS runtime
WORKDIR /app
RUN groupadd -r sitedock && useradd -r -g sitedock sitedock

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/database/prisma/schema.prisma ./packages/database/prisma/schema.prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/package.json ./

USER sitedock
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
