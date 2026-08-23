# ── SiteDock Dashboard (developer console) ───────────────────
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
  && npm run build -w apps/dashboard

FROM node:20-slim AS runtime
WORKDIR /app
RUN groupadd -r sitedock && useradd -r -g sitedock sitedock

COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /app/apps/dashboard/public ./apps/dashboard/public

USER sitedock
EXPOSE 3001

ENV PORT=3001 HOSTNAME=0.0.0.0

CMD ["node", "apps/dashboard/server.js"]
