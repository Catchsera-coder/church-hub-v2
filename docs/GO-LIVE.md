# Go live — final steps (run in Azure Cloud Shell)

Most of the deploy is already done: both v2 images are built and pushed to the
existing registry, and all shared infra is reused. What remains are the steps that
set **secrets** (DB password, JWT keys, admin password) — these must be run by a
human; automation is intentionally blocked from handling credentials.

Open **Azure Portal → Cloud Shell (Bash)** and paste the block below. Replace the
two `<CHOOSE-...>` values with strong passwords of your choice.

```bash
RG=rg-abchub-prod
ACR=abchubacrko7bpuyfp66em
ENVID=$(az containerapp env show -g $RG -n cae-abchub-prod --query id -o tsv)
IDID=$(az identity show -g $RG -n id-abchub-prod --query id -o tsv)

# 1) Dedicated Postgres for v2 (its own DB; the old app is untouched)
PGPASS='<CHOOSE-A-STRONG-DB-PASSWORD>'
az postgres flexible-server create -g $RG -n psql-abchubv2-prod -l eastus2 \
  --tier Burstable --sku-name Standard_B1ms --version 16 \
  --admin-user chadmin --admin-password "$PGPASS" \
  --storage-size 32 --public-access 0.0.0.0 --database-name church_hub_v2 --yes
DBURL="postgres://chadmin:$PGPASS@psql-abchubv2-prod.postgres.database.azure.com:5432/church_hub_v2"

# 2) App secrets
JWTA=$(openssl rand -base64 48); JWTR=$(openssl rand -base64 48)
ADMINEMAIL='Contact@catchsera.com'
ADMINPASS='<CHOOSE-AN-ADMIN-LOGIN-PASSWORD>'

# 3) Backend — internal ingress; runs migrate + seed + start on boot (seed is idempotent)
az containerapp create -g $RG -n v2-backend --environment $ENVID \
  --image $ACR.azurecr.io/church-hub-backend:v2 \
  --registry-server $ACR.azurecr.io --registry-identity $IDID --user-assigned $IDID \
  --ingress internal --target-port 8080 --min-replicas 1 --max-replicas 2 \
  --command "/bin/sh" --args "-c" "node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js" \
  --secrets database-url="$DBURL" jwt-access="$JWTA" jwt-refresh="$JWTR" admin-pass="$ADMINPASS" \
  --env-vars NODE_ENV=production PORT=8080 DATABASE_URL=secretref:database-url \
    JWT_ACCESS_SECRET=secretref:jwt-access JWT_REFRESH_SECRET=secretref:jwt-refresh \
    ADMIN_EMAIL="$ADMINEMAIL" ADMIN_PASSWORD=secretref:admin-pass CORS_ORIGINS=https://placeholder

# 4) Frontend — public; reverse-proxies /api to the backend's internal address
BEURL=$(az containerapp show -g $RG -n v2-backend --query properties.configuration.ingress.fqdn -o tsv)
az containerapp create -g $RG -n v2-frontend --environment $ENVID \
  --image $ACR.azurecr.io/church-hub-frontend:v2 \
  --registry-server $ACR.azurecr.io --registry-identity $IDID --user-assigned $IDID \
  --ingress external --target-port 3000 --min-replicas 1 --max-replicas 2 \
  --env-vars NODE_ENV=production BACKEND_ORIGIN="https://$BEURL"

# 5) Your live URL:
echo "https://$(az containerapp show -g $RG -n v2-frontend --query properties.configuration.ingress.fqdn -o tsv)"
```

Then open that URL and sign in with `ADMIN_EMAIL` / the admin password you chose.

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
