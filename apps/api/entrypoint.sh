#!/bin/sh
set -e

echo "[api] Starting server..."
exec npx tsx apps/api/src/server.ts
