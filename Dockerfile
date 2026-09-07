# ---- build stage ----
FROM node:20-slim AS build
WORKDIR /app
# Lockfile first for layer caching
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY server/tsconfig.json ./tsconfig.json
COPY server/src ./src
RUN npx tsc -p tsconfig.json

# ---- runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY server/db ./server/db
COPY server/scripts ./server/scripts
COPY web/dist ./web/dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Run migrations, then start the app.
CMD ["sh", "-c", "node server/scripts/migrate.mjs && node server/dist/index.js"]