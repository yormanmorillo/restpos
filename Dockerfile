# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --no-audit --no-fund

FROM base AS web-build
ENV NODE_ENV=production
ENV API_URL=http://api:4000
ENV NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY shared ./shared
COPY web ./web
RUN npm run build -w web

FROM base AS api
ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_PATH=/data/restpos.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY server ./server
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/src/server.js"]

FROM base AS web
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=web-build --chown=node:node /app/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/web/.next/static ./web/.next/static
COPY --from=web-build --chown=node:node /app/web/public ./web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "web/server.js"]
