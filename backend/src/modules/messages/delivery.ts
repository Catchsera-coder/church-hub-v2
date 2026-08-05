import { createHash, createHmac } from 'node:crypto';
import { config } from '../../config.js';
import type { MessagingSettings } from '../../db/schema.js';

/**
 * Turns "send this on this channel" into an actual send.
 *
 * Config is resolved per church: the Settings-tab values (organisations.messaging,
 * passed in as `dbMsg`) take precedence, falling back to env defaults. So a church
 * can change providers/keys live without a redeploy. Providers are called over
 * their HTTP APIs with fetch (+ Node crypto for Azure signing) — no SDK dep.
 *
 * Honest about failure (the v1 lesson, in reverse): dev with nothing configured
 * logs + succeeds; a configured channel really sends and returns true only on a
 * provider ACCEPT; prod with nothing configured returns false so recipients are
 * marked 'failed', never a fake 'sent'.
 *
 * Email -> SendGrid. SMS -> Twilio OR Azure Communication Services.
 */
export interface ResolvedMessaging {
  emailEnabled: boolean;
  sendgridApiKey?: string;
  mailFrom?: string;
  smsProvider: 'twilio' | 'azure' | null;
  smsFrom?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  acsConnectionString?: string;
  acsSmsFrom?: string;
}

/** Merge the church's saved settings over the env defaults and pick providers. */
export function resolveMessaging(dbMsg?: MessagingSettings | null): ResolvedMessaging {
  const m = dbMsg ?? {};
  const sendgridApiKey = m.sendgridApiKey || config.SENDGRID_API_KEY;
  const mailFrom = m.mailFrom || config.MAIL_FROM;

  const smsFrom = m.smsFrom || config.SMS_FROM;
  const twilioAccountSid = m.twilioAccountSid || config.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = m.twilioAuthToken || config.TWILIO_AUTH_TOKEN;
  const acsConnectionString = m.acsConnectionString || config.ACS_CONNECTION_STRING;
  const acsSmsFrom = m.acsSmsFrom || config.ACS_SMS_FROM;

  const twilioReady = Boolean(twilioAccountSid && twilioAuthToken && smsFrom);
  const azureReady = Boolean(acsConnectionString && acsSmsFrom);
  const want = m.smsProvider ?? config.SMS_PROVIDER;
  let smsProvider: 'twilio' | 'azure' | null;
  if (want === 'twilio') smsProvider = twilioReady ? 'twilio' : null;
  else if (want === 'azure') smsProvider = azureReady ? 'azure' : null;
  else smsProvider = azureReady ? 'azure' : twilioReady ? 'twilio' : null;

  return {
    emailEnabled: Boolean(sendgridApiKey && mailFrom),
    sendgridApiKey,
    mailFrom,
    smsProvider,
    smsFrom,
    twilioAccountSid,
    twilioAuthToken,
    acsConnectionString,
    acsSmsFrom,
  };
}

export async function sendMessage(
  m: ResolvedMessaging,
  channel: 'email' | 'sms',
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    if (channel === 'email') {
      if (m.emailEnabled) return await sendEmail(m, to, subject, body);
    } else if (m.smsProvider === 'twilio') {
      return await sendSmsTwilio(m, to, body);
    } else if (m.smsProvider === 'azure') {
      return await sendSmsAzure(m, to, body);
    }
  } catch (err) {
    console.error(`[${channel}] delivery error for ${to}:`, err instanceof Error ? err.message : err);
    return false;
  }

  if (!config.isProd) {
    console.log(`[dev ${channel}] -> ${to} :: ${subject} :: ${body.slice(0, 80)}`);
    return true;
  }
  console.warn(`[${channel}] provider not configured — not delivered to ${to}`);
  return false;
}

// --- Email: SendGrid ---------------------------------------------------------
async function sendEmail(m: ResolvedMessaging, to: string, subject: string, body: string): Promise<boolean> {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${m.sendgridApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: m.mailFrom },
      subject: subject || '(no subject)',
      content: [{ type: 'text/plain', value: body }],
    }),
  });
  if (res.ok) return true; // 202 Accepted
  console.error(`[email] SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}

// --- SMS: Twilio -------------------------------------------------------------
async function sendSmsTwilio(m: ResolvedMessaging, to: string, body: string): Promise<boolean> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${m.twilioAccountSid}/Messages.json`;
  const auth = Buffer.from(`${m.twilioAccountSid}:${m.twilioAuthToken}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: m.smsFrom!, Body: body }).toString(),
  });
  if (res.ok) return true; // 201 Created
  console.error(`[sms] Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}

// --- SMS: Azure Communication Services --------------------------------------
// ACS uses HMAC-SHA256 request signing with the resource access key, over
// x-ms-date, host and a base64 SHA-256 of the body.
// https://learn.microsoft.com/azure/communication-services/quickstarts/sms
function parseAcsConnectionString(cs: string): { endpoint: string; accessKey: string } {
  const endpoint = /endpoint=([^;]+)/i.exec(cs)?.[1]?.replace(/\/+$/, '');
  const accessKey = /accesskey=([^;]+)/i.exec(cs)?.[1];
  if (!endpoint || !accessKey) throw new Error('ACS connection string is malformed');
  return { endpoint, accessKey };
}

async function sendSmsAzure(m: ResolvedMessaging, to: string, body: string): Promise<boolean> {
  const { endpoint, accessKey } = parseAcsConnectionString(m.acsConnectionString!);
  const host = new URL(endpoint).host;
  const pathAndQuery = '/sms?api-version=2021-03-07';

  const payload = JSON.stringify({
    from: m.acsSmsFrom,
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
  const data = (await res.json().catch(() => null)) as { value?: Array<{ successful?: boolean }> } | null;
  const first = data?.value?.[0];
  return first ? first.successful !== false : true;
}
