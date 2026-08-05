# --- build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# No lockfile committed yet, so use `npm install` (matches CI). Switch to
# `npm ci` once lockfiles are committed.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime (adapter-node) ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/build ./build
EXPOSE 3000
CMD ["node", "build"]
