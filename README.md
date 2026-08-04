# Church Hub v2 — client-SPA rebuild

A white-label, bilingual (EN/AR) church-management SaaS, rebuilt as a **client-side
SPA** for instant tab switching — the architecture that makes the Catchsera clinic
app feel fast. This replaces the Filament/Laravel `abc-church-hub`, which is kept
as the functional reference and **retired only after this is verified in prod**.

## Why a rewrite (the speed story)
The old hub is server-rendered (Filament/Livewire): every tab is a server round-trip
(~500–750 ms even after Octane + indexes + caching). A client SPA renders tabs in
the browser (~0 ms) and only fetches data — the clinic's pattern. So: **SvelteKit
SPA front-end + a lean Node API + Postgres.**

## Stack (matches the clinic, hardened with our lessons)
| Layer | Choice | Why |
|---|---|---|
| Frontend | **SvelteKit (Svelte 5) + Vite + TailwindCSS**, TypeScript | Client-side routing = instant tabs; SSR-capable; small bundles |
| Backend | **Node + Express**, TypeScript | Same as clinic; simple, well-understood |
| DB access | **Drizzle ORM** (Postgres) + drizzle-kit migrations | Type-safe SQL, transparent, migrations from day 1 |
| Validation | **Zod** | One schema validates API input AND types |
| Auth | **JWT** (short access + refresh), bcrypt | Stateless, cross-region friendly, like the clinic |
| DB | **PostgreSQL 16** | Same as both apps |
| i18n | JSON message catalogs, EN + AR, RTL | Bilingual, labels never hardcoded |
| Tests | **Vitest** + Supertest | Run in CI (this machine has no Node) |
| CI/CD | GitHub Actions → Docker → Azure Container Apps | Reuse the proven deploy target |

## Lessons from v1 — baked in as guardrails
1. **Commit lockfiles** (`package-lock.json`) from the first commit — v1's missing
   `composer.lock` caused a week of version-drift bugs.
2. **TypeScript everywhere** — the compiler is the safety net when there's no local
   runtime to run the app on the build machine.
3. **Migrations from day 1** (drizzle-kit) — never hand-edit prod schema.
4. **Money in integer minor units** — never floats. Currency is per-org.
5. **Giving is an append-only ledger** — a correction is a NEW negative row with
   `reverses_id`; originals are never edited or deleted. Preserves audit + tax years.
6. **Bilingual + RTL first-class** — every label from i18n catalogs; Arabic uses a
   proper Arabic font; translatable names stored as JSONB `{ "en": …, "ar": … }`.
7. **White-label** — church name, logo, currency, timezone, locale, service/ministry
   names come from the `organisations` settings row, never hardcoded.
8. **Co-locate app + database in the same Azure region** — v1's app (eastus2) ↔ DB
   (centralus) split cost ~200 ms/request. Deploy both in one region.
9. **Validate every API input with Zod**; return typed, consistent error shapes.
10. **A real queue/worker or sync jobs** — v1 had a DB queue with no worker, so
    campaigns silently never sent. Decide explicitly (BullMQ + worker, or inline).

## Modules (feature parity with v1)
People/**Members** · **Families** (households) · **Ministries** (service types) +
rosters · **Attendance** events + records · **Check-in** (QR/kiosk) · **Giving**:
Funds, **Counting sessions** (batches), Contributions (ledger) · **Sermons** ·
**Events** (conferences) + registrants · **Messages** (campaigns) · **Team**
(users/roles) · **Activity log** · **Dashboard** · **Church settings**.

## Repo layout
```
church-hub-v2/
  backend/         Express + TS API (Drizzle, auth, modules)
  frontend/        SvelteKit (Svelte 5) SPA
  docs/            plan, data model, API, deploy, cutover
  .github/workflows/ci.yml
  docker-compose.yml   (local: postgres + backend + frontend)
```

## Build phases
0. Plan + scaffold (this) → 1. Data model + migrations → 2. Backend core (auth, RBAC,
i18n, errors) → 3. Backend modules (incl. giving ledger) → 4. Frontend shell (auth,
layout, i18n/RTL, branding) → 5. Frontend module pages → 6. CI + Docker + deploy →
7. Polish + cutover.

## Honest status / how to run
This environment has **no Node/npm**, so nothing here is run or tested locally by the
author of these files — correctness relies on TypeScript + tests-in-CI + a developer
running it. To run locally: `docker compose up` (Postgres), then `npm ci && npm run
dev` in `backend/` and `frontend/`. See `docs/RUNNING.md`.
