FROM node:22-bookworm-slim AS builder
WORKDIR /app
# Prisma 5.x needs the openssl CLI to detect the OpenSSL 3.x engine target on
# Debian bookworm; without it the generated client looks for libssl1.1.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev
RUN npm run db:generate -w packages/database
RUN npm run build -w apps/api

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 1001 sitedock \
    && adduser --system --uid 1001 sitedock \
    && mkdir -p /home/sitedock && chown sitedock:sitedock /home/sitedock
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/src ./apps/api/src
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/packages ./packages
COPY apps/api/entrypoint.sh ./entrypoint.sh
RUN chmod +x /app/entrypoint.sh && chown sitedock:sitedock /app/entrypoint.sh
USER sitedock
EXPOSE 4000
CMD ["/app/entrypoint.sh"]
