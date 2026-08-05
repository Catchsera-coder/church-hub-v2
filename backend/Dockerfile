# --- build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# No lockfile committed yet, so use `npm install` (matches CI). Switch to
# `npm ci` once lockfiles are committed.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# drizzle-kit push reads these at startup to sync the live DB to the schema
# (adds new tables/columns without migration-history bookkeeping — safe for
# additive changes across deploys).
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
EXPOSE 8080
# Sync schema (push), seed (idempotent — first admin from ADMIN_EMAIL/PASSWORD),
# then start. Co-located with the DB in the same region.
CMD ["sh", "-c", "npx drizzle-kit push --verbose && node dist/db/seed.js && node dist/index.js"]
