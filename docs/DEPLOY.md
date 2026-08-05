# Deploying church-hub-v2

One repo, many church deployments. The **same** two container images serve every
church; each church is one Bicep deployment with its own `namePrefix`, database,
and secrets. A church can therefore run standalone (its own everything) or share
infrastructure (registry, environment) in a SaaS setup — see below.

> Local `az` is blocked by conditional-access policy on this org, so run the
> provisioning commands from the **Azure Portal Cloud Shell** (Bash). Ongoing
> image rollouts run in GitHub Actions (`.github/workflows/deploy.yml`).

## 0. One-time shared setup (once per subscription)
1. **Container Registry** (shared across churches):
   ```bash
   az acr create -g rg-abchub-prod -n <registry> --sku Basic --admin-enabled true
   ```
2. **GitHub OIDC** so Actions can deploy without a stored password: create a
   user-assigned managed identity (or app registration) with a federated
   credential for this repo, grant it `AcrPush` on the registry and `Contributor`
   on the resource group, then set repo secrets `AZURE_CLIENT_ID`,
   `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ACR_LOGIN_SERVER`.
3. **Postgres** — a Flexible Server in the **same region** as the apps
   (v1 lesson). One database per church (or one server, one DB per church for SaaS).

## 1. Provision a church (per church, one-off)
```bash
# In Cloud Shell, from a checkout of this repo:
az bicep build -f infra/main.bicep         # validate first
cp infra/main.parameters.example.json /tmp/abchub.params.json
# edit /tmp/abchub.params.json: namePrefix, region, acr*, databaseUrl, jwt*, corsOrigins, messaging

az deployment group what-if \
  -g rg-abchub-prod -f infra/main.bicep -p @/tmp/abchub.params.json
az deployment group create \
  -g rg-abchub-prod -f infra/main.bicep -p @/tmp/abchub.params.json
```
This creates `<namePrefix>-env`, `<namePrefix>-backend` (internal), and
`<namePrefix>-frontend` (public). The frontend reverse-proxies `/api` to the
backend's internal FQDN, so there is **one public origin** and no CORS to manage.
The output `frontendUrl` is the church's URL; map a custom domain to it as needed.

Seed the first admin once the backend is up (Cloud Shell exec into the app or a
one-off job): set `ADMIN_EMAIL` / `ADMIN_PASSWORD` and run `npm run db:seed`.

## 2. Deploy new code (ongoing)
GitHub → Actions → **Deploy** → Run workflow, enter the church `namePrefix` and
resource group. It builds + pushes both images and rolls out both apps; the
backend runs migrations on start (`Dockerfile` CMD). CI (`ci.yml`) must be green
first — Deploy does not re-run tests.

## 3. Messaging per church
Set per-deploy env (Bicep params → container secrets):
- **Email:** `SENDGRID_API_KEY` + `MAIL_FROM`.
- **SMS:** either Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SMS_FROM`)
  or Azure Communication Services (`ACS_CONNECTION_STRING`, `ACS_SMS_FROM`).
  Leave `SMS_PROVIDER` blank to auto-pick, or force `twilio`/`azure`.
Unconfigured channels report failure honestly (no fake "sent").

## Per-church vs SaaS
- **Per-church:** dedicated RG/registry/DB/env per church — full isolation.
- **SaaS (shared infra):** one registry + one Container Apps environment + one
  Postgres server, one Bicep deployment (namePrefix) and one database per church.
  White-labelling already comes from each deploy's single `organisations` row.
  A future fully-multi-tenant mode (many churches in one app instance) would move
  per-tenant config into per-org DB rows and scope queries by org — not needed
  for the current model.
