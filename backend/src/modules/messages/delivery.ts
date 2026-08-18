import { createHash, createHmac } from 'node:crypto';
import { config } from '../../config.js';
import type { MessagingSettings } from '../../db/schema.js';

/**
 * Turns "send this on this channel" into an actual send.
 *
 * Config is resolved per church: Settings-tab values (organisations.messaging)
 * take precedence over env defaults, so a church changes providers/keys live
 * without a redeploy. Providers are called over their HTTP APIs with fetch (+
 * Node crypto for Azure signing) — no SDK dependency.
 *
 * Honest about failure (the v1 lesson, in reverse): dev with nothing configured
 * logs + succeeds; a configured channel really sends and returns true only on a
 * provider ACCEPT; prod with nothing configured returns false so recipients are
 * marked 'failed', never a fake 'sent'.
 *
 * Email    -> SendGrid OR Azure Communication Services.
 * SMS      -> Twilio OR Azure Communication Services.
 * WhatsApp -> Twilio (reuses the Twilio account; sender is a WhatsApp number).
 */
export interface ResolvedMessaging {
  emailProvider: 'sendgrid' | 'acs' | null;
  sendgridApiKey?: string;
  mailFrom?: string;
  acsMailFrom?: string;
  smsProvider: 'twilio' | 'azure' | null;
  smsFrom?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  acsConnectionString?: string;
  acsSmsFrom?: string;
  whatsappProvider: 'twilio' | null;
  whatsappFrom?: string;
}

/** Merge the church's saved settings over the env defaults and pick providers. */
export function resolveMessaging(dbMsg?: MessagingSettings | null): ResolvedMessaging {
  const m = dbMsg ?? {};
  const sendgridApiKey = m.sendgridApiKey || config.SENDGRID_API_KEY;
  const mailFrom = m.mailFrom || config.MAIL_FROM;
  const acsConnectionString = m.acsConnectionString || config.ACS_CONNECTION_STRING;
  const acsMailFrom = m.acsMailFrom || config.ACS_MAIL_FROM;

  const sendgridReady = Boolean(sendgridApiKey && mailFrom);
  const acsEmailReady = Boolean(acsConnectionString && acsMailFrom);
  const wantEmail = m.emailProvider;
  let emailProvider: 'sendgrid' | 'acs' | null;
  if (wantEmail === 'sendgrid') emailProvider = sendgridReady ? 'sendgrid' : null;
  else if (wantEmail === 'acs') emailProvider = acsEmailReady ? 'acs' : null;
  else emailProvider = sendgridReady ? 'sendgrid' : acsEmailReady ? 'acs' : null;

  const smsFrom = m.smsFrom || config.SMS_FROM;
  const twilioAccountSid = m.twilioAccountSid || config.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = m.twilioAuthToken || config.TWILIO_AUTH_TOKEN;
  const acsSmsFrom = m.acsSmsFrom || config.ACS_SMS_FROM;

  const twilioReady = Boolean(twilioAccountSid && twilioAuthToken && smsFrom);
  const azureSmsReady = Boolean(acsConnectionString && acsSmsFrom);
  const wantSms = m.smsProvider ?? config.SMS_PROVIDER;
  let smsProvider: 'twilio' | 'azure' | null;
  if (wantSms === 'twilio') smsProvider = twilioReady ? 'twilio' : null;
  else if (wantSms === 'azure') smsProvider = azureSmsReady ? 'azure' : null;
  else smsProvider = azureSmsReady ? 'azure' : twilioReady ? 'twilio' : null;

  // WhatsApp via Twilio: reuses the Twilio SID/token; needs its own WhatsApp
  // sender (e.g. "whatsapp:+1415..."). Ready only when all three are present.
  const whatsappFrom = m.whatsappFrom || config.WHATSAPP_FROM;
  const whatsappReady = Boolean(twilioAccountSid && twilioAuthToken && whatsappFrom);
  const whatsappProvider: 'twilio' | null = whatsappReady ? 'twilio' : null;

  return {
    emailProvider, sendgridApiKey, mailFrom, acsMailFrom,
    smsProvider, smsFrom, twilioAccountSid, twilioAuthToken, acsConnectionString, acsSmsFrom,
    whatsappProvider, whatsappFrom,
  };
}

export async function sendMessage(
  m: ResolvedMessaging,
  channel: 'email' | 'sms' | 'whatsapp',
  to: string,
  subject: string,
  body: string,
  html?: string,      // optional branded HTML for email (plain `body` is the fallback)
  mediaUrl?: string,  // optional image for MMS (SMS) / media (WhatsApp) — Twilio only
): Promise<boolean> {
  try {
    if (channel === 'email') {
      if (m.emailProvider === 'sendgrid') return await sendEmailSendgrid(m, to, subject, body, html);
      if (m.emailProvider === 'acs') return await sendEmailAcs(m, to, subject, body, html);
    } else if (channel === 'whatsapp') {
      if (m.whatsappProvider === 'twilio') return await sendWhatsappTwilio(m, to, body, mediaUrl);
    } else if (m.smsProvider === 'twilio') {
      return await sendSmsTwilio(m, to, body, mediaUrl);
    } else if (m.smsProvider === 'azure') {
      return await sendSmsAzure(m, to, body); // Azure SMS has no MMS media support
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

/**
 * Diagnostic: try to send a real test email and return the exact result/detail.
 * Powers the "Send test email" button in Settings so an admin can see WHY email
 * (incl. password-reset codes) isn't delivering, and fix the config themselves.
 */
export async function verifyEmail(m: ResolvedMessaging, to: string): Promise<{ ok: boolean; detail: string }> {
  if (!m.emailProvider) {
    return { ok: false, detail: 'No email provider is configured. Add your Azure ACS connection string + verified sender address (or a SendGrid API key + from address) above, then Save and try again.' };
  }
  const subject = 'Church Hub — test email';
  const body = 'This is a test from your Church Hub messaging settings. If you received it, email is working (including password-reset codes).';
  try {
    let res: Response;
    if (m.emailProvider === 'sendgrid') {
      res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${m.sendgridApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: m.mailFrom }, subject, content: [{ type: 'text/plain', value: body }] }),
      });
    } else {
      res = await acsSignedFetch(m.acsConnectionString!, '/emails:send?api-version=2023-03-31', {
        senderAddress: m.acsMailFrom, content: { subject, plainText: body }, recipients: { to: [{ address: to }] },
      });
    }
    if (res.ok) return { ok: true, detail: `Accepted by ${m.emailProvider === 'sendgrid' ? 'SendGrid' : 'Azure'} for ${to}. Check the inbox (and spam) in a moment.` };
    return { ok: false, detail: `${m.emailProvider === 'sendgrid' ? 'SendGrid' : 'Azure'} rejected it (HTTP ${res.status}): ${(await res.text()).slice(0, 400)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// --- Email: SendGrid ---------------------------------------------------------
async function sendEmailSendgrid(m: ResolvedMessaging, to: string, subject: string, body: string, html?: string): Promise<boolean> {
  // SendGrid requires text/plain before text/html; include both when we have HTML.
  const content = html
    ? [{ type: 'text/plain', value: body }, { type: 'text/html', value: html }]
    : [{ type: 'text/plain', value: body }];
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${m.sendgridApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: m.mailFrom },
      subject: subject || '(no subject)',
      content,
    }),
  });
  if (res.ok) return true; // 202 Accepted
  console.error(`[email] SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}

// --- Email: Azure Communication Services -------------------------------------
async function sendEmailAcs(m: ResolvedMessaging, to: string, subject: string, body: string, html?: string): Promise<boolean> {
  const res = await acsSignedFetch(
    m.acsConnectionString!,
    '/emails:send?api-version=2023-03-31',
    {
      senderAddress: m.acsMailFrom,
      content: { subject: subject || '(no subject)', plainText: body, ...(html ? { html } : {}) },
      recipients: { to: [{ address: to }] },
    },
  );
  if (res.ok) return true; // 202 Accepted (async send queued)
  console.error(`[email] Azure ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}

// --- SMS: Twilio -------------------------------------------------------------
async function sendSmsTwilio(m: ResolvedMessaging, to: string, body: string, mediaUrl?: string): Promise<boolean> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${m.twilioAccountSid}/Messages.json`;
  const auth = Buffer.from(`${m.twilioAccountSid}:${m.twilioAuthToken}`).toString('base64');
  const params = new URLSearchParams({ To: to, From: m.smsFrom!, Body: body });
  if (mediaUrl) params.append('MediaUrl', mediaUrl); // MMS
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (res.ok) return true; // 201 Created
  console.error(`[sms] Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}

// --- WhatsApp: Twilio --------------------------------------------------------
// Same Messages endpoint as SMS, but both numbers carry the "whatsapp:" scheme.
// The sender (whatsappFrom) is already stored with the prefix; the recipient's
// stored mobile is a bare E.164 number, so prefix it here.
async function sendWhatsappTwilio(m: ResolvedMessaging, to: string, body: string, mediaUrl?: string): Promise<boolean> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${m.twilioAccountSid}/Messages.json`;
  const auth = Buffer.from(`${m.twilioAccountSid}:${m.twilioAuthToken}`).toString('base64');
  const from = m.whatsappFrom!.startsWith('whatsapp:') ? m.whatsappFrom! : `whatsapp:${m.whatsappFrom}`;
  const toAddr = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const params = new URLSearchParams({ To: toAddr, From: from, Body: body });
  if (mediaUrl) params.append('MediaUrl', mediaUrl);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (res.ok) return true; // 201 Created
  console.error(`[whatsapp] Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return false;
}

// --- SMS: Azure Communication Services --------------------------------------
async function sendSmsAzure(m: ResolvedMessaging, to: string, body: string): Promise<boolean> {
  const res = await acsSignedFetch(
    m.acsConnectionString!,
    '/sms?api-version=2021-03-07',
    { from: m.acsSmsFrom, message: body, smsRecipients: [{ to }] },
  );
  if (!res.ok) {
    console.error(`[sms] Azure ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  const data = (await res.json().catch(() => null)) as { value?: Array<{ successful?: boolean }> } | null;
  const first = data?.value?.[0];
  return first ? first.successful !== false : true;
}

// --- ACS HMAC request signing (shared by email + SMS) ------------------------
// https://learn.microsoft.com/azure/communication-services/tutorials/hmac-header-tutorial
function parseAcsConnectionString(cs: string): { endpoint: string; accessKey: string } {
  const endpoint = /endpoint=([^;]+)/i.exec(cs)?.[1]?.replace(/\/+$/, '');
  const accessKey = /accesskey=([^;]+)/i.exec(cs)?.[1];
  if (!endpoint || !accessKey) throw new Error('ACS connection string is malformed');
  return { endpoint, accessKey };
}

async function acsSignedFetch(connectionString: string, pathAndQuery: string, payloadObj: unknown): Promise<Response> {
  const { endpoint, accessKey } = parseAcsConnectionString(connectionString);
  const host = new URL(endpoint).host;
  const payload = JSON.stringify(payloadObj);

  const date = new Date().toUTCString();
  const contentHash = createHash('sha256').update(payload, 'utf8').digest('base64');
  const stringToSign = `POST\n${pathAndQuery}\n${date};${host};${contentHash}`;
  const signature = createHmac('sha256', Buffer.from(accessKey, 'base64')).update(stringToSign, 'utf8').digest('base64');

  return fetch(endpoint + pathAndQuery, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ms-date': date,
      'x-ms-content-sha256': contentHash,
      Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
    },
    body: payload,
  });
}
