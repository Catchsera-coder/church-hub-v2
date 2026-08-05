// ---------------------------------------------------------------------------
// church-hub-v2 — per-deploy infrastructure (Azure Container Apps).
//
// One deployment = one church (the tenant boundary). Run this once per church
// with a distinct `namePrefix`; the SAME container images serve every church,
// only env/secrets differ. Backend + frontend live in ONE region, co-located
// with the database (v1 lesson: never split app and DB across regions).
//
// Topology: frontend has EXTERNAL ingress (the public origin) and reverse-
// proxies /api to the backend via BACKEND_ORIGIN (see hooks.server.ts). Backend
// has INTERNAL ingress, reachable only inside the Container Apps environment.
//
// NOTE: authored without a local `az`/bicep to run it — a developer must
// `az bicep build -f infra/main.bicep` and `az deployment group what-if` before
// applying. See docs/DEPLOY.md.
// ---------------------------------------------------------------------------

@description('Short, DNS-safe prefix unique per church, e.g. "abchub" or "gracechurch".')
@minLength(3)
@maxLength(20)
param namePrefix string

@description('Azure region. Keep the same as the database.')
param location string = resourceGroup().location

@description('ACR login server, e.g. myregistry.azurecr.io (shared across churches).')
param acrLoginServer string

@description('ACR admin username.')
param acrUsername string

@secure()
@description('ACR admin password.')
param acrPassword string

@description('Backend image reference (repository:tag) within the registry.')
param backendImage string

@description('Frontend image reference (repository:tag) within the registry.')
param frontendImage string

@secure()
@description('Postgres connection string (co-located, same region).')
param databaseUrl string

@secure()
param jwtAccessSecret string

@secure()
param jwtRefreshSecret string

@description('Comma-separated public origin(s) of the frontend, for CORS.')
param corsOrigins string

// Optional messaging secrets (leave empty to disable a channel; delivery.ts is honest).
@secure()
param sendgridApiKey string = ''
param mailFrom string = ''
@allowed(['', 'twilio', 'azure'])
param smsProvider string = ''
param smsFrom string = ''
param twilioAccountSid string = ''
@secure()
param twilioAuthToken string = ''
@secure()
param acsConnectionString string = ''
param acsSmsFrom string = ''

var tags = { app: 'church-hub-v2', church: namePrefix }

// --- Observability ----------------------------------------------------------
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${namePrefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// --- Container Apps environment ---------------------------------------------
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// --- Backend (internal ingress) --------------------------------------------
resource backend 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-backend'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
        transport: 'auto'
      }
      registries: [
        { server: acrLoginServer, username: acrUsername, passwordSecretRef: 'acr-password' }
      ]
      secrets: [
        { name: 'acr-password', value: acrPassword }
        { name: 'database-url', value: databaseUrl }
        { name: 'jwt-access-secret', value: jwtAccessSecret }
        { name: 'jwt-refresh-secret', value: jwtRefreshSecret }
        { name: 'sendgrid-api-key', value: sendgridApiKey }
        { name: 'twilio-auth-token', value: twilioAuthToken }
        { name: 'acs-connection-string', value: acsConnectionString }
      ]
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: '${acrLoginServer}/${backendImage}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '8080' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'JWT_ACCESS_SECRET', secretRef: 'jwt-access-secret' }
            { name: 'JWT_REFRESH_SECRET', secretRef: 'jwt-refresh-secret' }
            { name: 'CORS_ORIGINS', value: corsOrigins }
            { name: 'MAIL_FROM', value: mailFrom }
            { name: 'SENDGRID_API_KEY', secretRef: 'sendgrid-api-key' }
            { name: 'SMS_PROVIDER', value: smsProvider }
            { name: 'SMS_FROM', value: smsFrom }
            { name: 'TWILIO_ACCOUNT_SID', value: twilioAccountSid }
            { name: 'TWILIO_AUTH_TOKEN', secretRef: 'twilio-auth-token' }
            { name: 'ACS_CONNECTION_STRING', secretRef: 'acs-connection-string' }
            { name: 'ACS_SMS_FROM', value: acsSmsFrom }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// --- Frontend (external ingress, public origin) -----------------------------
resource frontend 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-frontend'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        { server: acrLoginServer, username: acrUsername, passwordSecretRef: 'acr-password' }
      ]
      secrets: [
        { name: 'acr-password', value: acrPassword }
      ]
    }
    template: {
      containers: [
        {
          name: 'frontend'
          image: '${acrLoginServer}/${frontendImage}'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            // Reverse-proxy /api to the backend's internal FQDN (hooks.server.ts).
            { name: 'BACKEND_ORIGIN', value: 'https://${backend.properties.configuration.ingress.fqdn}' }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

output frontendUrl string = 'https://${frontend.properties.configuration.ingress.fqdn}'
output backendInternalFqdn string = backend.properties.configuration.ingress.fqdn
