import { and, eq } from 'drizzle-orm';
import { pool, db } from './db/index.js';
import { messageCampaigns, messageRecipients, automations } from './db/schema.js';
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
  const scheduled = await db.select().from(messageCampaigns).where(eq(messageCampaigns.status, 'scheduled'));
  if (!scheduled.length) return;
  const org = await currentOrg();
  const tz = org.timezone || 'UTC';
  const now = new Date();
  const localDate = partsInTz(now, tz).date;

  for (const c of scheduled) {
    const recurring = c.schedule && c.schedule.mode === 'recurring';
    if (recurring) {
      // Recurring send (e.g. a weekly reminder or a stream link). Fire on each
      // due occurrence; clear prior recipients so everyone gets this occurrence,
      // then keep the campaign 'scheduled' for the next one.
      if (!isDue(c.schedule, c.lastRunOn ?? null, now, tz)) continue;
      await db.delete(messageRecipients).where(eq(messageRecipients.messageCampaignId, c.id));
      await sendCampaignNow(c.id).catch((e) => console.error('[scheduler] campaign', c.id, e instanceof Error ? e.message : e));
      await db.update(messageCampaigns).set({ status: 'scheduled', lastRunOn: localDate, updatedAt: new Date() }).where(eq(messageCampaigns.id, c.id));
    } else {
      // One-time: send once when its scheduled time has arrived (marks it sent).
      if (!c.scheduledFor || c.scheduledFor > now) continue;
      await sendCampaignNow(c.id).catch((e) => console.error('[scheduler] campaign', c.id, e instanceof Error ? e.message : e));
    }
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
