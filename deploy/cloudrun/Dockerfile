FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY scripts/check-api.js scripts/check-api.js
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
# Only public configuration may enter the browser build.
RUN VITE_SUPABASE_URL="$VITE_SUPABASE_URL" VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" VITE_API_URL='' npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 SERVE_WEB=true HEALTHCHECK_ENABLED=false
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY --from=build /app/apps/web/dist apps/web/dist
COPY scripts/gcp scripts/gcp
USER node
EXPOSE 8080
CMD ["node", "apps/api/src/server.js"]
