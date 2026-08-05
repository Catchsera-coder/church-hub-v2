# --- build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# No lockfile committed yet, so use `npm install` (matches CI). Switch to
# `npm ci` once lockfiles are committed.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
# Generate SQL migrations into ./drizzle so the runtime image is self-contained
# (drizzle-kit only reads schema.ts here — no DB connection needed). --name fixes
# the filename so it is byte-stable across builds (migrator tracks by content hash).
RUN npx drizzle-kit generate --name init

# --- runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
EXPOSE 8080
# Run migrations, seed (idempotent — creates the first admin from ADMIN_EMAIL/
# ADMIN_PASSWORD if absent), then start. Co-located with the DB in the same region.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js"]
