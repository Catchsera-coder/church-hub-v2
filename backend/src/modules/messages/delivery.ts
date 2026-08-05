import { config } from '../../config.js';

/**
 * One place that turns "send this on this channel" into an actual send.
 *
 * Providers are called over their HTTP APIs with the global `fetch` — no SDK
 * dependency. Both are env-gated and honest about failure:
 *   - dev (non-prod) with no provider configured: log + report success, so flows
 *     can be exercised end-to-end locally.
 *   - configured (any env): really send; return true only on a provider ACCEPT.
 *   - prod with no provider configured: report FAILURE, so recipients are marked
 *     'failed' truthfully instead of a fake 'sent' (the v1 lesson, in reverse).
 *
 * Email  -> SendGrid v3 (SENDGRID_API_KEY, MAIL_FROM)
 * SMS    -> Twilio Messages (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SMS_FROM)
 * Swapping providers means changing only this file.
 */
export async function sendMessage(
  channel: 'email' | 'sms',
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    if (channel === 'email') {
      if (config.emailEnabled) return await sendEmail(to, subject, body);
    } else if (config.smsEnabled) {
      return await sendSms(to, body);
    }
  } catch (err) {
    console.error(`[${channel}] delivery error for ${to}:`, err instanceof Error ? err.message : err);
    return false;
  }

  // No provider configured for this channel.
  if (!config.isProd) {
    console.log(`[dev ${channel}] -> ${to} :: ${subject} :: ${body.slice(0, 80)}`);
    return true;
  }
  console.warn(`[${channel}] provider not configured — not delivered to ${to}`);
  return false;
}

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: config.MAIL_FROM },
      subject: subject || '(no subject)',
      content: [{ type: 'text/plain', value: body }],
    }),
  });
  // SendGrid returns 202 Accepted on success.
  if (res.ok) return true;
  console.error(`[email] SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}

async function sendSms(to: string, body: string): Promise<boolean> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: config.SMS_FROM!, Body: body }).toString(),
  });
  // Twilio returns 201 Created on accept.
  if (res.ok) return true;
  console.error(`[sms] Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}
