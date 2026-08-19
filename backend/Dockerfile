# ---- Build stage: compile TypeScript ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# tsc does NOT copy .sql migration files into dist — bring them along so
# `node dist/db/migrate.js` can find them at runtime.
RUN cp -r src/db/migrations dist/db/migrations

# ---- Runtime stage: prod deps only ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && mkdir -p uploads && chown -R node:node /app

# Drop root — run the server as the unprivileged `node` user (uid 1000).
# NOTE: the prod uploads bind-mount (./uploads) must be writable by uid 1000:
#   sudo chown -R 1000:1000 /opt/schoola/uploads   (one-time, on the server)
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Runs pending migrations, then starts the server.
ENTRYPOINT ["./docker-entrypoint.sh"]
