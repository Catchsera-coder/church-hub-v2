import { createHash, createHmac } from 'node:crypto';
import { config } from '../../config.js';

/**
 * One place that turns "send this on this channel" into an actual send.
 *
 * Providers are called over their HTTP APIs with the global `fetch` (+ Node
 * `crypto` for Azure request signing) — no SDK dependency. Everything is
 * env-gated per deploy and honest about failure:
 *   - dev (non-prod) with no provider configured: log + report success.
 *   - configured (any env): really send; return true only on a provider ACCEPT.
 *   - prod with no provider configured: report FAILURE, so recipients are marked
 *     'failed' truthfully instead of a fake 'sent' (the v1 lesson, in reverse).
 *
 * Email -> SendGrid v3 (SENDGRID_API_KEY, MAIL_FROM).
 * SMS   -> Twilio OR Azure Communication Services, chosen by config.smsProvider
 *          (SMS_PROVIDER override, else auto-detect). Each church deploy picks
 *          its own; swapping providers means changing only env, not code.
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
    } else if (config.smsProvider === 'twilio') {
      return await sendSmsTwilio(to, body);
    } else if (config.smsProvider === 'azure') {
      return await sendSmsAzure(to, body);
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

// --- Email: SendGrid ---------------------------------------------------------
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
  if (res.ok) return true; // 202 Accepted
  console.error(`[email] SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}

// --- SMS: Twilio -------------------------------------------------------------
async function sendSmsTwilio(to: string, body: string): Promise<boolean> {
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
  if (res.ok) return true; // 201 Created
  console.error(`[sms] Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}

// --- SMS: Azure Communication Services --------------------------------------
// ACS uses HMAC-SHA256 request signing with the resource access key. Signed
// against x-ms-date, host and a base64 SHA-256 of the body.
// https://learn.microsoft.com/azure/communication-services/quickstarts/sms
function parseAcsConnectionString(cs: string): { endpoint: string; accessKey: string } {
  const endpoint = /endpoint=([^;]+)/i.exec(cs)?.[1]?.replace(/\/+$/, '');
  const accessKey = /accesskey=([^;]+)/i.exec(cs)?.[1];
  if (!endpoint || !accessKey) throw new Error('ACS_CONNECTION_STRING is malformed');
  return { endpoint, accessKey };
}

async function sendSmsAzure(to: string, body: string): Promise<boolean> {
  const { endpoint, accessKey } = parseAcsConnectionString(config.ACS_CONNECTION_STRING!);
  const host = new URL(endpoint).host;
  const pathAndQuery = '/sms?api-version=2021-03-07';

  const payload = JSON.stringify({
    from: config.ACS_SMS_FROM,
    message: body,
    smsRecipients: [{ to }],
  });

  const date = new Date().toUTCString();
  const contentHash = createHash('sha256').update(payload, 'utf8').digest('base64');
  const stringToSign = `POST\n${pathAndQuery}\n${date};${host};${contentHash}`;
  const signature = createHmac('sha256', Buffer.from(accessKey, 'base64')).update(stringToSign, 'utf8').digest('base64');

  const res = await fetch(endpoint + pathAndQuery, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ms-date': date,
      'x-ms-content-sha256': contentHash,
      Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
    },
    body: payload,
  });

  if (!res.ok) {
    console.error(`[sms] Azure ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  // 202 with a per-recipient result; treat an explicit `successful:false` as failure.
  const data = (await res.json().catch(() => null)) as { value?: Array<{ successful?: boolean }> } | null;
  const first = data?.value?.[0];
  return first ? first.successful !== false : true;
}
