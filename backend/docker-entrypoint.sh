#!/bin/sh
set -e

echo "→ Applying database migrations..."
node dist/db/migrate.js up

echo "→ Starting server..."
exec node dist/server.js
