import { Router } from 'express';
import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { securityFindings, securityScans } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { runScan, applyAutoFix, canAutoFix } from './scanner.js';

/**
 * Security Center API — Super Admin only. Surfaces the self-audit findings, lets
 * an admin run a scan on demand, apply a SAFE one-click fix (or request a
 * reviewed code fix), and dismiss a finding.
 */
export const securityRouter = Router();
securityRouter.use(authenticate);
securityRouter.use(requireRole('Super Admin'));

const OPEN = ['open', 'fix_requested'] as const;

securityRouter.get('/overview', asyncHandler(async (_req, res) => {
  const findings = await db.select().from(securityFindings)
    .where(inArray(securityFindings.status, [...OPEN]))
    .orderBy(securityFindings.severity, desc(securityFindings.lastSeenAt));
  const [lastScan] = await db.select().from(securityScans).orderBy(desc(securityScans.startedAt)).limit(1);
  // Severity weight for a simple headline grade.
  const weight: Record<string, number> = { critical: 40, high: 20, medium: 8, low: 3, info: 1 };
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + (weight[f.severity] ?? 0), 0));
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  res.json({ data: { findings, lastScan: lastScan ?? null, score, counts } });
}));

securityRouter.get('/scans', asyncHandler(async (_req, res) => {
  const scans = await db.select().from(securityScans).orderBy(desc(securityScans.startedAt)).limit(20);
  res.json({ data: scans });
}));

securityRouter.post('/scan', asyncHandler(async (req, res) => {
  // Manual scan: detect + record, but do NOT auto-heal — the admin chooses what
  // to fix. (The weekly scheduled scan auto-heals the safe items.)
  const result = await runScan({ trigger: 'manual', autoHeal: false });
  await logActivity(req, 'created', 'security', result.scanId, `manual-scan:${result.open} open`);
  res.json({ data: result });
}));

securityRouter.post('/findings/:id/fix', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [f] = await db.select().from(securityFindings).where(eq(securityFindings.id, id)).limit(1);
  if (!f) throw notFound();
  if (f.status === 'fixed') throw badRequest('This finding is already resolved.');
  if (f.autofixable && canAutoFix(f.code)) {
    const detail = await applyAutoFix(f.code);
    await db.update(securityFindings).set({ status: 'fixed', resolvedAt: new Date(), resolvedByUserId: req.auth!.sub, updatedAt: new Date() }).where(eq(securityFindings.id, id));
    await logActivity(req, 'updated', 'security', id, `auto-fixed:${f.code}`);
    res.json({ data: { fixed: true, detail } });
  } else {
    // Not safe to auto-apply — flag it for the reviewed code change.
    await db.update(securityFindings).set({ status: 'fix_requested', updatedAt: new Date() }).where(eq(securityFindings.id, id));
    await logActivity(req, 'updated', 'security', id, `fix-requested:${f.code}`);
    res.json({ data: { fixed: false, requested: true, recommendation: f.recommendation } });
  }
}));

securityRouter.post('/findings/:id/dismiss', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
  const [f] = await db.update(securityFindings)
    .set({ status: 'dismissed', resolvedAt: new Date(), resolvedByUserId: req.auth!.sub, updatedAt: new Date(), evidence: body.reason ? { dismissReason: body.reason } : undefined })
    .where(eq(securityFindings.id, id)).returning();
  if (!f) throw notFound();
  await logActivity(req, 'updated', 'security', id, 'dismissed');
  res.json({ data: f });
}));
