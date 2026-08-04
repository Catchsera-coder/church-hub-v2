# Cutover plan — retire the old Filament hub

The old `abc-church-hub` (Filament/Laravel) stays LIVE and untouched as the
reference until v2 is verified in production. Only then do we retire it.

## Status of v2 (what's built vs. remaining)
**Built (foundation + vertical slice):**
- Full data model + Drizzle migrations for every module (money in minor units,
  append-only giving ledger with `reverses_id`, translatable JSONB, FK indexes).
- Backend core: config, pooled Postgres, error shape, Zod validation, JWT
  access+refresh with rotation, Argon2, RBAC (Super Admin bypass), activity log.
- Backend modules: **auth, people (members) CRUD, contributions ledger
  (create/list/reverse), dashboard stats, org settings.**
- Frontend SPA: SvelteKit (SSR off = instant tabs), Tailwind design system,
  EN/AR i18n + RTL, branded login, authed shell (grouped sidebar, dark mode),
  **dashboard + members** pages, API client with silent token refresh.
- CI (typecheck + build + migrate + test on Postgres), Dockerfiles, compose.

**Remaining (follow the established patterns — est. the bulk of the ~150–300h):**
- Backend routers for: families, ministries + rosters, attendance + check-in
  (QR), funds, counting sessions (batches, close/variance), sermons, events +
  registrants, messages (+ a real worker/queue or sync send — v1 gap), team
  (users/roles + invites), activity log read. Each mirrors `people/routes.ts`.
- Frontend pages for each of the above (mirror `members/+page.svelte` + a shared
  create/edit form component and a generic data-table component).
- Data migration script from the old Postgres → new schema.
- Azure infra (Container Apps for backend + frontend, same region as DB), custom
  domain, CI→ACR deploy.
- Tests per module; seed richer demo data.

## Cutover steps (when v2 reaches parity)
1. Stand up v2 in staging; run the data-migration script from a snapshot; verify.
2. QA every module against the old app; check bilingual/RTL and giving totals.
3. Deploy v2 to prod (same region as DB); point the domain at v2.
4. Run in parallel briefly (old app read-only) to confirm.
5. Retire `abc-church-hub`: stop its Container App, keep a final DB snapshot +
   the repo archived, then delete resources.

## Guardrails carried from v1 (do not regress)
Committed lockfiles · TypeScript everywhere · migrations from day 1 · money in
minor units · append-only giving ledger · bilingual/RTL + labels in i18n only ·
white-label from the org settings row · **app and DB in one region** · Zod on all
inputs · a real job runner for messages (never a queue with no worker).
