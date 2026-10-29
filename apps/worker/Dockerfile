FROM node:22-bookworm-slim AS builder
WORKDIR /app
# Prisma 5.x needs the openssl CLI to detect the OpenSSL 3.x engine target on
# Debian bookworm; without it the generated client looks for libssl1.1.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev
RUN npm run db:generate -w packages/database
RUN npm run build -w apps/worker

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 1001 sitedock \
    && adduser --system --uid 1001 sitedock
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/src ./apps/worker/src
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/packages ./packages
USER sitedock
CMD ["npx", "tsx", "apps/worker/src/index.ts"]
