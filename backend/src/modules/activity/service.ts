import type { Request } from 'express';
import { db } from '../../db/index.js';
import { activityLog } from '../../db/schema.js';

type Event = 'created' | 'updated' | 'deleted';

/**
 * Append an audit row. Self-guarding: a logging failure must never break the
 * action that triggered it (v1 lesson — bookkeeping writes are wrapped).
 */
export async function logActivity(
  req: Request,
  event: Event,
  subjectType: string,
  subjectId: number | null,
  description?: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(activityLog).values({
      causerId: req.auth?.sub ?? null,
      event,
      subjectType,
      subjectId,
      description: description ?? null,
      properties,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('activity log failed', err);
  }
}
