# Runtime persistente para Restaurant OS (Node + SQLite).
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/restaurant-os.db \
    SEED_DEMO=false

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data /app/backups && chown -R node:node /app

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "server/server.js"]
