# Go live — final steps (run in Azure Cloud Shell)

Most of the deploy is already done: both v2 images are built and pushed to the
existing registry, and all shared infra is reused. What remains are the steps that
set **secrets** (DB password, JWT keys, admin password) — these must be run by a
human; automation is intentionally blocked from handling credentials.

Open **Azure Portal → Cloud Shell (Bash)** and paste the block below. Replace the
two `<CHOOSE-...>` values with strong passwords of your choice.

The backend image runs migrate + seed (idempotent) + start on boot, so no startup
override is needed. `az acr build` and `--database-name` details already handled.

```bash
RG=rg-abchub-prod; ACR=abchubacrko7bpuyfp66em
ENVID=$(az containerapp env show -g $RG -n cae-abchub-prod --query id -o tsv)
IDID=$(az identity show -g $RG -n id-abchub-prod --query id -o tsv)

# choose real passwords (letters/digits; avoid @ : / in the DB one)
PGPASS='<STRONG-DB-PASSWORD>'
ADMINPASS='<ADMIN-LOGIN-PASSWORD>'
JWTA=$(openssl rand -base64 48); JWTR=$(openssl rand -base64 48)

# 1) Dedicated Postgres for v2 (own DB; old app untouched). Create server, then db.
az postgres flexible-server create -g $RG -n psql-abchubv2-prod -l eastus2 \
  --tier Burstable --sku-name Standard_B1ms --version 16 \
  --admin-user chadmin --admin-password "$PGPASS" \
  --storage-size 32 --public-access 0.0.0.0 --yes
az postgres flexible-server db create -g $RG -s psql-abchubv2-prod -d church_hub_v2
DBURL="postgres://chadmin:$PGPASS@psql-abchubv2-prod.postgres.database.azure.com:5432/church_hub_v2"

# 2) Backend — internal ingress (image CMD migrates + seeds + starts)
az containerapp create -g $RG -n v2-backend --environment $ENVID \
  --image $ACR.azurecr.io/church-hub-backend:v2 \
  --registry-server $ACR.azurecr.io --registry-identity $IDID --user-assigned $IDID \
  --ingress internal --target-port 8080 --min-replicas 1 --max-replicas 2 \
  --secrets database-url="$DBURL" jwt-access="$JWTA" jwt-refresh="$JWTR" admin-pass="$ADMINPASS" \
  --env-vars NODE_ENV=production PORT=8080 DATABASE_URL=secretref:database-url \
    JWT_ACCESS_SECRET=secretref:jwt-access JWT_REFRESH_SECRET=secretref:jwt-refresh \
    ADMIN_EMAIL=Contact@catchsera.com ADMIN_PASSWORD=secretref:admin-pass CORS_ORIGINS=https://placeholder

# 3) Point the frontend (already created) at the backend's internal address
BEURL=$(az containerapp show -g $RG -n v2-backend --query properties.configuration.ingress.fqdn -o tsv)
az containerapp update -g $RG -n v2-frontend --set-env-vars BACKEND_ORIGIN="https://$BEURL"

# 4) Live URL:
echo "LIVE AT: https://$(az containerapp show -g $RG -n v2-frontend --query properties.configuration.ingress.fqdn -o tsv)"
```

Then open that URL and sign in with `Contact@catchsera.com` / the admin password you chose.
(If the backend image was rebuilt, first: `az containerapp update -g $RG -n v2-backend --image $ACR.azurecr.io/church-hub-backend:v2`.)

## If image pull fails (AcrPull)
The managed identity `id-abchub-prod` must have AcrPull on the registry. If a create
step errors pulling the image:
```bash
ACRID=$(az acr show -n $ACR --query id -o tsv)
PRINCIPAL=$(az identity show -g $RG -n id-abchub-prod --query principalId -o tsv)
az role assignment create --assignee $PRINCIPAL --role AcrPull --scope $ACRID
```
Then re-run the failed `az containerapp create`.

## After it's up
- **Messaging:** you already have ACS (`acs-abchub`) — set its connection string and
  an ACS phone number in the app's **Settings → Messaging** tab (or Twilio). Email
  via SendGrid, or wire the ACS email domain.
- **Domain:** map `abcbchurchhub.org` to the frontend container app (custom domain +
  managed certificate).
- **Rebuild images later:** re-run the two `az acr build` commands, then
  `az containerapp update -n v2-backend/-frontend -g $RG --image ...:v2`.
- **Redeploy note:** the images use `npm install` (no committed lockfile yet). Once a
  dev commits lockfiles, switch the Dockerfiles back to `npm ci`.
