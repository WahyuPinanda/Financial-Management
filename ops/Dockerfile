FROM postgres:17-bookworm AS pgtools
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 libzstd1 liblz4-1 && rm -rf /var/lib/apt/lists/*
COPY --from=pgtools /usr/lib/postgresql/17/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=pgtools /usr/lib/postgresql/17/bin/pg_restore /usr/local/bin/pg_restore
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY packages/shared packages/shared
COPY scripts/ops scripts/ops
USER node
CMD ["node", "scripts/ops/scheduler.js"]
