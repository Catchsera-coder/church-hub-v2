# Running church-hub-v2

> Note: this codebase was authored in an environment with **no Node.js**, so it
> was not run locally by its author. First run WILL surface small fixes — that's
> expected; TypeScript + CI catch most, a developer confirms the rest.

## Prerequisites
- Node.js 20+, npm
- Docker (for Postgres) or a local Postgres 16

## First run (local)
```bash
# 1. Database
docker compose up -d postgres            # or point DATABASE_URL at your own PG

# 2. Backend
cd backend
cp .env.example .env                     # edit secrets
npm install                              # generates & commits package-lock.json (do commit it!)
npm run db:generate                      # create SQL migrations from the schema
npm run db:migrate                       # apply them
npm run db:seed                          # org, roles, Super Admin, default funds/ministries
npm run dev                              # API on :8080

# 3. Frontend (new terminal)
cd frontend
npm install                              # commit package-lock.json
npm run dev                              # SPA on :5173 (proxies /api -> :8080)
```
Sign in with the seeded Super Admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, defaults in
`db/seed.ts` — change immediately).

## Whole stack in Docker
```bash
docker compose up --build   # postgres + backend(:8080) + frontend(:3000)
```

## Commit the lockfiles
`package-lock.json` in **both** `backend/` and `frontend/` must be committed on the
first `npm install` — the #1 lesson from v1 (missing lockfile → version drift).

## Deploy (Azure Container Apps)
Build both Dockerfiles, push to ACR, deploy as two Container Apps **in the same
region as the Postgres database** (v1 lesson: co-locate app + DB). Set env/secrets
(DATABASE_URL, JWT secrets, CORS_ORIGINS) from Key Vault. The backend image runs
migrations on start.
