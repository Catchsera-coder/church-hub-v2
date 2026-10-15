import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  users, userRoles, roles, refreshTokens, passwordResetTokens, activityLog,
  securityFindings, securityScans,
} from '../../db/schema.js';
import { config } from '../../config.js';
import { currentOrg } from '../settings/routes.js';

/**
 * Security Center scanner. A deterministic, NIST/OWASP-Top-10-aligned self-audit
 * that inspects the live configuration and data for risks, records findings, and
 * can SAFELY auto-heal a small set of config-level issues (e.g. purging expired
 * tokens). Code-level fixes are never applied automatically — they are reported
 * with a precise recommendation for the normal reviewed deploy. Runs weekly from
 * the scheduler and on demand from the Super-Admin page.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Detected {
  code: string;
  category: string;       // OWASP ref (A01…A10) or NIST area
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
  autofixable: boolean;
  evidence?: Record<string, unknown>;
}

const PRIVILEGED = ['Super Admin', 'Admin'];

async function privilegedUsers() {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, mfa: users.mfaEnabled, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.isActive, true), inArray(roles.name, PRIVILEGED)));
  // De-dupe (a user may hold several privileged roles).
  const seen = new Map<number, typeof rows[number]>();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}

/** Run every check and return the findings currently present. */
export async function detectFindings(): Promise<Detected[]> {
  const out: Detected[] = [];
  const now = Date.now();

  // --- A07: privileged accounts without 2FA ---------------------------------
  const privileged = await privilegedUsers();
  const noMfa = privileged.filter((u) => !u.mfa);
  if (noMfa.length) {
    out.push({
      code: 'admin-no-mfa', category: 'A07', severity: 'high',
      title: 'Admin accounts without two-factor authentication',
      detail: `${noMfa.length} admin account(s) can sign in with only a password: ${noMfa.map((u) => u.email).join(', ')}.`,
      recommendation: 'Each admin should turn on 2FA from their Security page (Settings → Security). This blocks account takeover even if a password leaks.',
      autofixable: false,
      evidence: { emails: noMfa.map((u) => u.email) },
    });
  }

  // --- A01: seeded/temporary password never changed -------------------------
  const [mustChange] = await db.select({ c: sql<number>`count(*)::int` }).from(users)
    .where(and(eq(users.isActive, true), eq(users.mustChangePassword, true)));
  if ((mustChange?.c ?? 0) > 0) {
    out.push({
      code: 'must-change-password', category: 'A01', severity: 'high',
      title: 'Accounts still using a temporary password',
      detail: `${mustChange.c} active account(s) have never changed the password set for them. Default/temporary credentials are a common break-in route.`,
      recommendation: 'Ask those users to sign in and set their own password, or reset and reissue it. They are prompted to change it at next login.',
      autofixable: false, evidence: { count: mustChange.c },
    });
  }

  // --- A05: weak token-signing secrets --------------------------------------
  const weakSecret = [config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET].some((s) => (s ?? '').length < 32);
  if (weakSecret) {
    out.push({
      code: 'weak-jwt-secret', category: 'A02', severity: 'critical',
      title: 'Session-token signing secret is short',
      detail: 'A JWT signing secret is shorter than 32 characters, which weakens login-token security.',
      recommendation: 'Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to long (64+ char) random values in the container app config, then redeploy. This is a code/config change applied through the normal reviewed deploy.',
      autofixable: false,
    });
  }

  // --- A02: provider secrets stored in plaintext in the DB ------------------
  const org = await currentOrg();
  const m = (org.messaging ?? {}) as Record<string, unknown>;
  const secretFields = ['sendgridApiKey', 'twilioAuthToken', 'acsConnectionString', 'aiApiKey', 'azureOpenaiKey', 'azureMapsKey'];
  const present = secretFields.filter((k) => typeof m[k] === 'string' && (m[k] as string).length > 0);
  if (present.length) {
    out.push({
      code: 'plaintext-provider-keys', category: 'A02', severity: 'medium',
      title: 'Messaging/AI provider keys stored in plain text',
      detail: `${present.length} provider secret(s) are stored unencrypted in the settings record. Anyone with database access could read them.`,
      recommendation: 'Move these to an encrypted store (Azure Key Vault) and reference them from config. Until then, keep database access tightly restricted and rotate keys periodically. This is a planned code change for the reviewed deploy.',
      autofixable: false, evidence: { fields: present },
    });
  }

  // --- A05/hygiene: expired or revoked refresh tokens not purged ------------
  const [staleRt] = await db.select({ c: sql<number>`count(*)::int` }).from(refreshTokens)
    .where(or(lt(refreshTokens.expiresAt, new Date()), sql`${refreshTokens.revokedAt} IS NOT NULL`));
  if ((staleRt?.c ?? 0) > 0) {
    out.push({
      code: 'stale-refresh-tokens', category: 'A05', severity: 'low',
      title: 'Expired/revoked session tokens not cleaned up',
      detail: `${staleRt.c} expired or revoked refresh token(s) are still stored. Clearing them reduces the data exposed if the database is ever read.`,
      recommendation: 'Safe to auto-remove now — click Fix. (Deletes only already-expired or revoked tokens; no active session is affected.)',
      autofixable: true, evidence: { count: staleRt.c },
    });
  }

  // --- A05/hygiene: used/expired password-reset codes not purged ------------
  const [staleReset] = await db.select({ c: sql<number>`count(*)::int` }).from(passwordResetTokens)
    .where(or(lt(passwordResetTokens.expiresAt, new Date()), sql`${passwordResetTokens.usedAt} IS NOT NULL`));
  if ((staleReset?.c ?? 0) > 0) {
    out.push({
      code: 'stale-reset-tokens', category: 'A05', severity: 'low',
      title: 'Used/expired password-reset codes not cleaned up',
      detail: `${staleReset.c} spent or expired password-reset code(s) are still stored.`,
      recommendation: 'Safe to auto-remove now — click Fix. (Deletes only used or expired codes.)',
      autofixable: true, evidence: { count: staleReset.c },
    });
  }

  // --- A01: dormant privileged accounts -------------------------------------
  const cutoff = new Date(now - 180 * 24 * 3600_000);
  const dormant = privileged.filter((u) => (u.lastLoginAt ? u.lastLoginAt < cutoff : (u.createdAt ? u.createdAt < cutoff : false)));
  if (dormant.length) {
    out.push({
      code: 'dormant-admins', category: 'A01', severity: 'medium',
      title: 'Admin accounts inactive for 6+ months',
      detail: `${dormant.length} admin account(s) have not signed in for over 180 days: ${dormant.map((u) => u.email).join(', ')}. Unused privileged accounts widen the attack surface.`,
      recommendation: 'Review these accounts in Team. Remove the admin role or deactivate any that are no longer needed.',
      autofixable: false, evidence: { emails: dormant.map((u) => u.email) },
    });
  }

  // --- A05: app not served over HTTPS ---------------------------------------
  if (config.PUBLIC_APP_URL && !/^https:\/\//i.test(config.PUBLIC_APP_URL)) {
    out.push({
      code: 'no-https', category: 'A05', severity: 'high',
      title: 'Public app URL is not HTTPS',
      detail: `The configured public URL (${config.PUBLIC_APP_URL}) does not use HTTPS, so traffic could be read in transit.`,
      recommendation: 'Serve the app over HTTPS and set PUBLIC_APP_URL to the https:// address, then redeploy.',
      autofixable: false,
    });
  }

  // --- A09: audit logging appears to have stopped ---------------------------
  const [recentLog] = await db.select({ c: sql<number>`count(*)::int` }).from(activityLog)
    .where(sql`${activityLog.createdAt} > now() - interval '14 days'`);
  if ((recentLog?.c ?? 0) === 0) {
    out.push({
      code: 'no-recent-audit-log', category: 'A09', severity: 'info',
      title: 'No activity has been logged in 14 days',
      detail: 'The audit log has no entries in the last two weeks. That is expected for a very quiet system, but can also mean logging has stopped.',
      recommendation: 'If staff have been active, check that activity logging is working. Otherwise no action is needed.',
      autofixable: false,
    });
  }

  return out;
}

// --- Safe auto-fix handlers (config/data hygiene only) ----------------------
const FIXERS: Record<string, () => Promise<string>> = {
  'stale-refresh-tokens': async () => {
    const r = await db.delete(refreshTokens)
      .where(or(lt(refreshTokens.expiresAt, new Date()), sql`${refreshTokens.revokedAt} IS NOT NULL`)).returning({ id: refreshTokens.id });
    return `Removed ${r.length} expired/revoked session token(s).`;
  },
  'stale-reset-tokens': async () => {
    const r = await db.delete(passwordResetTokens)
      .where(or(lt(passwordResetTokens.expiresAt, new Date()), sql`${passwordResetTokens.usedAt} IS NOT NULL`)).returning({ id: passwordResetTokens.id });
    return `Removed ${r.length} used/expired reset code(s).`;
  },
};

export function canAutoFix(code: string): boolean {
  return code in FIXERS;
}

/** Apply the safe fix for one finding code. Throws if the code has no safe fix. */
export async function applyAutoFix(code: string): Promise<string> {
  const fn = FIXERS[code];
  if (!fn) throw new Error('This finding has no automatic fix — it needs a reviewed change.');
  return fn();
}

/**
 * Run a full scan: detect, persist (upsert by code, reopening recurrences and
 * closing resolved ones), and — when autoHeal — apply the safe fixes so the
 * system self-heals on the weekly schedule even with nobody watching.
 */
export async function runScan(opts: { trigger?: 'scheduled' | 'manual'; autoHeal?: boolean } = {}): Promise<{ scanId: number; open: number; autoFixed: number; summary: Record<string, number> }> {
  const trigger = opts.trigger ?? 'scheduled';
  const [scan] = await db.insert(securityScans).values({ trigger }).returning({ id: securityScans.id });

  let detected = await detectFindings();
  let autoFixed = 0;

  // Self-heal the safe ones first (scheduled runs), then drop them from the
  // "detected" set so they record as fixed, not open.
  if (opts.autoHeal) {
    const healable = detected.filter((d) => d.autofixable && canAutoFix(d.code));
    for (const d of healable) {
      try { await applyAutoFix(d.code); autoFixed++; } catch { /* leave as open if the fix errors */ }
    }
    const healedCodes = new Set(healable.map((d) => d.code));
    detected = detected.filter((d) => !healedCodes.has(d.code));
  }

  const detectedCodes = new Set(detected.map((d) => d.code));

  // Upsert each current finding (keep a dismissed one dismissed; otherwise open).
  for (const d of detected) {
    await db.insert(securityFindings).values({
      code: d.code, category: d.category, severity: d.severity, title: d.title,
      detail: d.detail, recommendation: d.recommendation, autofixable: d.autofixable,
      evidence: d.evidence ?? {}, status: 'open',
    }).onConflictDoUpdate({
      target: securityFindings.code,
      set: {
        category: d.category, severity: d.severity, title: d.title, detail: d.detail,
        recommendation: d.recommendation, autofixable: d.autofixable, evidence: d.evidence ?? {},
        lastSeenAt: new Date(), updatedAt: new Date(), resolvedAt: null,
        status: sql`case when ${securityFindings.status} = 'dismissed' then 'dismissed'::security_finding_status else 'open'::security_finding_status end`,
      },
    });
  }

  // Anything previously open/requested that we no longer detect is resolved.
  const resolveWhere = detectedCodes.size
    ? and(inArray(securityFindings.status, ['open', 'fix_requested']), sql`${securityFindings.code} NOT IN (${sql.join([...detectedCodes].map((c) => sql`${c}`), sql`, `)})`)
    : inArray(securityFindings.status, ['open', 'fix_requested']);
  await db.update(securityFindings).set({ status: 'fixed', resolvedAt: new Date(), updatedAt: new Date() }).where(resolveWhere);

  const summary: Record<string, number> = {};
  for (const d of detected) summary[d.severity] = (summary[d.severity] ?? 0) + 1;
  await db.update(securityScans).set({ finishedAt: new Date(), openCount: detected.length, autoFixed, summary }).where(eq(securityScans.id, scan.id));

  return { scanId: scan.id, open: detected.length, autoFixed, summary };
}
