import { and, eq, lte } from 'drizzle-orm';
import { pool, db } from './db/index.js';
import { messageCampaigns, automations } from './db/schema.js';
import { sendCampaignNow } from './modules/messages/send.js';
import { runAutomation, resolveMessaging, type Channel } from './modules/automations/service.js';
import { currentOrg } from './modules/settings/routes.js';
import { isDue, defaultAutomationSchedule, partsInTz } from './modules/scheduling/schedule.js';

/**
 * Background worker: sends scheduled campaigns and runs enabled auto-automations.
 * Runs in-process on a 60s tick. A Postgres advisory lock means only ONE replica
 * does the work at a time (safe on scale-up), and the lock is held only for the
 * duration of each tick.
 */
const LOCK_KEY = 994711;
let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;
  const run = () => tick().catch((e) => console.error('[scheduler]', e instanceof Error ? e.message : e));
  setInterval(run, 60_000);
  run();
}

async function tick(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('select pg_try_advisory_lock($1) as ok', [LOCK_KEY]);
    if (!rows[0]?.ok) return; // another replica holds the lock
    try {
      await runScheduledCampaigns();
      await runAutoAutomations();
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function runScheduledCampaigns(): Promise<void> {
  const due = await db
    .select({ id: messageCampaigns.id })
    .from(messageCampaigns)
    .where(and(eq(messageCampaigns.status, 'scheduled'), lte(messageCampaigns.scheduledFor, new Date())));
  for (const c of due) {
    await sendCampaignNow(c.id).catch((e) => console.error('[scheduler] campaign', c.id, e instanceof Error ? e.message : e));
  }
}

async function runAutoAutomations(): Promise<void> {
  const list = await db.select().from(automations).where(and(eq(automations.enabled, true), eq(automations.mode, 'auto')));
  // 'welcome' is triggered when a member is approved, not on a schedule.
  const candidates = list.filter((a) => a.type !== 'welcome');
  if (!candidates.length) return;

  const org = await currentOrg();
  const tz = org.timezone || 'UTC';
  const now = new Date();
  const localDate = partsInTz(now, tz).date; // "today" in the church's timezone
  // Each automation now carries its own schedule (time-of-day, frequency, days,
  // start/end). Null falls back to the legacy per-type cadence.
  const due = candidates.filter((a) => isDue(a.schedule ?? defaultAutomationSchedule(a.type), a.lastRunOn ?? null, now, tz));
  if (!due.length) return;

  const messaging = resolveMessaging(org.messaging, { replyTo: org.emailSettings?.replyTo || org.email });
  for (const a of due) {
    await runAutomation({ type: a.type, channel: a.channel as Channel, templateId: a.templateId, config: a.config }, org, messaging)
      .catch((e) => console.error('[scheduler] automation', a.type, e instanceof Error ? e.message : e));
    await db.update(automations).set({ lastRunOn: localDate, updatedAt: new Date() }).where(eq(automations.id, a.id));
  }
}
