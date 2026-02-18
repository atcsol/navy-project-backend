#!/bin/sh
set -e

echo "=== Navy Backend - Production Entrypoint ==="

echo "[entrypoint] Running Prisma migrations..."
npx prisma migrate deploy

echo "[entrypoint] Migrations completed."

echo "[entrypoint] Starting backend..."
exec "$@"
