import { config } from '../../config.js';

/**
 * One place that turns "send this on this channel" into an actual send.
 *
 * No provider is wired yet. Rather than silently marking messages 'sent' (which
 * would be the v1 failure mode in reverse), this is honest:
 *   - dev: logs the message and reports success, so flows can be tested.
 *   - prod: reports FAILURE until an email/SMS provider is implemented here, so
 *     recipients are truthfully marked 'failed' instead of a fake 'sent'.
 *
 * To wire real delivery: implement the email branch (e.g. SMTP/nodemailer or
 * Azure Communication Services) and the sms branch (a provider), returning true
 * only on a confirmed accept.
 */
export async function sendMessage(
  channel: 'email' | 'sms',
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  if (!config.isProd) {
    // eslint-disable-next-line no-console
    console.log(`[dev ${channel}] -> ${to} :: ${subject} :: ${body.slice(0, 80)}`);
    return true;
  }
  // eslint-disable-next-line no-console
  console.warn(`[${channel}] provider not configured — not delivered to ${to}`);
  return false;
}
