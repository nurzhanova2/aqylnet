#!/bin/sh
set -e

# Production start sequence. What it replaced, and why each change matters:
#
#   npx prisma generate              -> done at image build time
#   npx prisma db push --accept-data-loss -> npx prisma migrate deploy
#   npx tsx prisma/seed.ts           -> only when RUN_SEED=true
#   npx tsx watch src/server.ts      -> node dist/server.js
#
# `db push --accept-data-loss` ran on every single start and was authorised, by
# that flag, to drop whatever did not match the schema. It is a development
# convenience pointed at a live database. `migrate deploy` applies only
# reviewed migration files and refuses anything it was not given.

echo "[entrypoint] Applying migrations (prisma migrate deploy)..."
npx prisma migrate deploy

# Seeding used to run unconditionally, which created a demo project with
# ownerKey = null on every start — and a null owner key means visible in every
# workspace. Off unless explicitly asked for.
if [ "$RUN_SEED" = "true" ]; then
  echo "[entrypoint] RUN_SEED=true — seeding database (idempotent)..."
  node dist/seed.js
else
  echo "[entrypoint] Skipping seed (set RUN_SEED=true to populate the persona library)."
fi

echo "[entrypoint] Starting backend server (node dist/server.js)..."
exec node dist/server.js
