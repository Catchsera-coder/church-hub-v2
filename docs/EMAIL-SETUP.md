# Email setup (per church deployment)

Email is **configuration, never code.** The shared codebase resolves the sender
at runtime from environment/secret or the tenant's `organisations.messaging` DB
row, and safely no-ops when unset (honest "not delivered", never a crash). So
enabling email for a new church is **additive config only** — no code change,
nothing hardcoded, and no way to break the running app or a future build.

The only things that differ per deployment are **the church's domain** and
**that church's own sender credentials**. The steps below are identical every
time; just swap those two things.

## Providers (pick one per deploy)

- **Azure Communication Services (ACS) Email** — free under the nonprofit grant.
  Needs `ACS_CONNECTION_STRING` (secret) + `ACS_MAIL_FROM` (sender address).
- **SendGrid** — free tier. Needs `SENDGRID_API_KEY` (secret) + `MAIL_FROM`.

Set these as backend env/secrets (per-deploy default) OR per-church in the
`organisations.messaging` row (which overrides env).

## 4-step recipe (ACS + custom domain)

1. **Add the custom sender domain.** In the deploy's Email Communication Service
   → `Provision domains` → `Add domain` → `Setup custom domain`, enter the
   church's domain (e.g. `example.org`). Azure generates a domain-verification
   `TXT`, an SPF `TXT`, and two DKIM `CNAME` records.

2. **Add those records to the church's DNS**, then click Verify in Azure (wait a
   few minutes for DNS to propagate first). On Cloudflare: set the DKIM CNAMEs to
   **DNS only** (grey cloud). If the domain also uses Email Routing (step 3),
   there can be only ONE SPF `TXT` — merge both includes into a single record,
   e.g. `v=spf1 <the include Azure gives you> include:_spf.mx.cloudflare.net ~all`.

3. **Reading (Cloudflare Email Routing, free).** On the church's domain, enable
   Email Routing and forward `*@example.org` (or specific addresses) to the
   church's real inbox. Confirm the destination via the verification email it
   sends. This adds the MX records + an SPF include (merge as in step 2).

4. **Configure the app — two values, no code change:**
   - Store the connection string as a **Container App secret** (never in code or
     the repo) and reference it via the `ACS_CONNECTION_STRING` env var.
   - Set `ACS_MAIL_FROM=noreply@example.org`.
   - Equivalent per-church path: set `emailProvider: 'acs'`, `acsConnectionString`,
     and `acsMailFrom` on that church's `organisations.messaging` row.

Done. Password-reset codes, invites, and any transactional email now send from
the church's own domain, and replies land in their inbox.

## Fastest start (no DNS wait)

Every Email Communication Service can add a **free Azure managed subdomain** in
one click — instantly verified, sends from `DoNotReply@<id>.azurecomm.net`. Use
it to switch email on immediately, then swap `ACS_MAIL_FROM` to the custom domain
once step 2 verifies. Swapping is a one-value change, no break.

## Why this never breaks a deploy

- Sender is read at runtime from env/secret or DB; **unset = safe no-op**.
- No church data is hardcoded — the same image ships to every deploy.
- Secrets live in Container App secrets, not in the repo.
- Adding a domain, DNS records, or routing is additive and independent of the app.
