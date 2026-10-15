import { config } from '../../config.js';
import type { MessagingSettings } from '../../db/schema.js';

/**
 * AI compose assistant. Drafts message copy for one, several, or all channels
 * (email / SMS / WhatsApp) in one or more languages from a short brief.
 *
 * Two providers, both over plain fetch (no SDK): Anthropic (Claude) or the
 * church's own Azure OpenAI resource. Off by default: if neither is configured,
 * resolveAi returns null and the route replies 400 "AI not configured" — never a
 * fake success.
 */
export type ResolvedAi =
  | { provider: 'anthropic'; apiKey: string; model: string }
  | { provider: 'azure'; endpoint: string; apiKey: string; deployment: string; apiVersion: string; model: string; useManagedIdentity: boolean };

const DEFAULT_AZURE_MODEL = 'gpt-4.1-mini';
const DEFAULT_AZURE_API_VERSION = '2024-10-21';

// --- Managed-identity token (Azure Container Apps) --------------------------
// When the app authenticates to Azure OpenAI with its own identity, there is NO
// API key to store anywhere. The host injects IDENTITY_ENDPOINT / IDENTITY_HEADER;
// we exchange them for a short-lived AAD token and cache it until it nears expiry.
let miToken: { token: string; expMs: number } | null = null;
async function managedIdentityToken(): Promise<string> {
  if (miToken && Date.now() < miToken.expMs - 120_000) return miToken.token;
  const ep = process.env.IDENTITY_ENDPOINT, hdr = process.env.IDENTITY_HEADER;
  if (!ep || !hdr) throw new Error('Managed identity is not available in this environment.');
  const url = `${ep}?resource=${encodeURIComponent('https://cognitiveservices.azure.com')}&api-version=2019-08-01`;
  const res = await fetch(url, { headers: { 'X-IDENTITY-HEADER': hdr } });
  if (!res.ok) throw new Error(`Managed identity token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = (await res.json()) as { access_token: string; expires_on?: string; expires_in?: string };
  const expMs = d.expires_on ? Number(d.expires_on) * 1000 : Date.now() + Number(d.expires_in ?? 3000) * 1000;
  miToken = { token: d.access_token, expMs };
  return d.access_token;
}
async function azureHeaders(ai: Extract<ResolvedAi, { provider: 'azure' }>): Promise<Record<string, string>> {
  return ai.useManagedIdentity
    ? { 'content-type': 'application/json', authorization: `Bearer ${await managedIdentityToken()}` }
    : { 'content-type': 'application/json', 'api-key': ai.apiKey };
}

export function resolveAi(dbMsg?: MessagingSettings | null): ResolvedAi | null {
  const m = dbMsg ?? {};
  const azEndpoint = (m.azureOpenaiEndpoint || config.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '');
  const azKey = m.azureOpenaiKey || config.AZURE_OPENAI_KEY || '';
  // Use managed identity when enabled and the host provides the identity endpoint.
  const useMI = config.AZURE_OPENAI_USE_MANAGED_IDENTITY === 'true' && Boolean(process.env.IDENTITY_ENDPOINT && process.env.IDENTITY_HEADER);
  const provider = m.aiProvider || (azEndpoint && (azKey || useMI) ? 'azure' : 'anthropic');

  if (provider === 'azure') {
    const model = m.aiModel || config.AZURE_OPENAI_DEPLOYMENT || DEFAULT_AZURE_MODEL;
    const deployment = m.azureOpenaiDeployment || config.AZURE_OPENAI_DEPLOYMENT || model;
    const apiVersion = m.azureOpenaiApiVersion || config.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;
    if (azEndpoint && deployment && (azKey || useMI)) {
      return { provider: 'azure', endpoint: azEndpoint, apiKey: azKey, deployment, apiVersion, model, useManagedIdentity: !azKey && useMI };
    }
    return null;
  }

  const apiKey = m.aiApiKey || config.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { provider: 'anthropic', apiKey, model: m.aiModel || config.AI_MODEL };
}

export type AiChannel = 'email' | 'sms' | 'whatsapp';

export interface AiDraftRequest {
  brief: string;
  channels: AiChannel[];
  locales: string[];
  tone?: string;
  churchName?: string;
}

export interface AiDraftResult {
  email?: { subject: Record<string, string>; body: Record<string, string> };
  sms?: { body: Record<string, string> };
  whatsapp?: { body: Record<string, string> };
}

const LANG_NAMES: Record<string, string> = { en: 'English', ar: 'Arabic' };

// JSON Schema for Anthropic's structured output.
function buildSchema(channels: AiChannel[], locales: string[]): Record<string, unknown> {
  const localeObj = () => ({
    type: 'object', additionalProperties: false, required: locales,
    properties: Object.fromEntries(locales.map((l) => [l, { type: 'string' }])),
  });
  const props: Record<string, unknown> = {};
  if (channels.includes('email')) props.email = { type: 'object', additionalProperties: false, required: ['subject', 'body'], properties: { subject: localeObj(), body: localeObj() } };
  if (channels.includes('sms')) props.sms = { type: 'object', additionalProperties: false, required: ['body'], properties: { body: localeObj() } };
  if (channels.includes('whatsapp')) props.whatsapp = { type: 'object', additionalProperties: false, required: ['body'], properties: { body: localeObj() } };
  return { type: 'object', additionalProperties: false, required: channels, properties: props };
}

// Plain-text shape hint for Azure OpenAI json_object mode.
function shapeHint(channels: AiChannel[], locales: string[]): string {
  const loc = `{ ${locales.map((l) => `"${l}": "..."`).join(', ')} }`;
  const parts: string[] = [];
  if (channels.includes('email')) parts.push(`"email": { "subject": ${loc}, "body": ${loc} }`);
  if (channels.includes('sms')) parts.push(`"sms": { "body": ${loc} }`);
  if (channels.includes('whatsapp')) parts.push(`"whatsapp": { "body": ${loc} }`);
  return `{ ${parts.join(', ')} }`;
}

function buildPrompt(req: AiDraftRequest): string {
  const langs = req.locales.map((l) => LANG_NAMES[l] ?? l).join(' and ');
  const channelNotes: string[] = [];
  if (req.channels.includes('email')) channelNotes.push('- email: a clear subject line and a friendly body with a greeting and a sign-off.');
  if (req.channels.includes('sms')) channelNotes.push('- sms: one concise message, ideally under 320 characters, no subject.');
  if (req.channels.includes('whatsapp')) channelNotes.push('- whatsapp: warm and conversational, short, light use of emoji is fine.');
  return [
    `You are helping ${req.churchName || 'a church'} write a message to its congregation.`,
    `Write copy in ${langs}. When Arabic is requested, write natural, fluent Arabic (not a literal translation).`,
    req.tone ? `Tone: ${req.tone}.` : 'Tone: warm, welcoming, and pastoral.',
    '',
    'Draft the message for these channels:',
    ...channelNotes,
    '',
    'Do not invent specific dates, times, names, or links that are not in the brief; leave a natural placeholder if needed.',
    '',
    `Brief: ${req.brief}`,
  ].join('\n');
}

function parseResult(text: string): AiDraftResult {
  try { return JSON.parse(text) as AiDraftResult; }
  catch { throw new Error('The AI returned an unexpected format. Please try again.'); }
}

export async function draftMessages(ai: ResolvedAi, req: AiDraftRequest): Promise<AiDraftResult> {
  return ai.provider === 'azure' ? draftAzure(ai, req) : draftAnthropic(ai, req);
}

// --- One-click "Polish with AI": reformat an email body with light markdown ---
// (**bold**, *italic*, ## headings, - lists) WITHOUT changing the wording or
// meaning. Reuses whichever provider the church already configured.
const POLISH_SYSTEM = [
  'You format church email messages. You are given the body of an email (plain text or simple HTML).',
  'Reformat it to be clear and attractive using ONLY these simple HTML tags:',
  '- <strong> for key phrases, <em> for gentle emphasis, <u> for underline,',
  '- <h2> for a big section heading, <h3> for a smaller heading,',
  '- <ul><li>…</li></ul> for bullet lists, <ol><li>…</li></ol> for numbered lists,',
  '- <p> for paragraphs, <a href="…"> for links, and <span style="color:#RRGGBB"> sparingly for a touch of colour.',
  'Rules: keep ALL of the original meaning, wording, names, dates, numbers and links.',
  'Do NOT add new information, greetings, sign-offs or links that are not already there.',
  'Return ONLY the formatted HTML body — no <html>/<body> wrapper, no markdown, no code fences.',
].join('\n');

export async function polishEmailBody(ai: ResolvedAi, text: string): Promise<string> {
  const body = text.trim();
  if (!body) return text;
  const out = ai.provider === 'azure'
    ? await polishAzure(ai, body)
    : await polishAnthropic(ai, body);
  return (out || '').trim() || text;
}

async function polishAnthropic(ai: Extract<ResolvedAi, { provider: 'anthropic' }>, body: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: ai.model, max_tokens: 2048, system: POLISH_SYSTEM,
      messages: [{ role: 'user', content: body }],
    }),
  });
  if (!res.ok) throw new Error(`AI provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
  if (data.stop_reason === 'refusal') throw new Error('The AI declined to format this message.');
  return data.content?.find((b) => b.type === 'text')?.text ?? '';
}

async function polishAzure(ai: Extract<ResolvedAi, { provider: 'azure' }>, body: string): Promise<string> {
  const url = `${ai.endpoint}/openai/deployments/${encodeURIComponent(ai.deployment)}/chat/completions?api-version=${ai.apiVersion}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: await azureHeaders(ai),
    body: JSON.stringify({
      messages: [{ role: 'system', content: POLISH_SYSTEM }, { role: 'user', content: body }],
      max_tokens: 2048, temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`Azure OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

async function draftAnthropic(ai: Extract<ResolvedAi, { provider: 'anthropic' }>, req: AiDraftRequest): Promise<AiDraftResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: ai.model, max_tokens: 2048,
      output_config: { format: { type: 'json_schema', schema: buildSchema(req.channels, req.locales) } },
      messages: [{ role: 'user', content: buildPrompt(req) }],
    }),
  });
  if (!res.ok) throw new Error(`AI provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
  if (data.stop_reason === 'refusal') throw new Error('The AI declined to draft this message.');
  const text = data.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('The AI returned no draft.');
  return parseResult(text);
}

async function draftAzure(ai: Extract<ResolvedAi, { provider: 'azure' }>, req: AiDraftRequest): Promise<AiDraftResult> {
  const url = `${ai.endpoint}/openai/deployments/${encodeURIComponent(ai.deployment)}/chat/completions?api-version=${ai.apiVersion}`;
  const system = `You write church messages. Respond ONLY with a valid JSON object exactly matching this shape (no extra keys, no markdown fences): ${shapeHint(req.channels, req.locales)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: await azureHeaders(ai),
    body: JSON.stringify({
      messages: [{ role: 'system', content: system }, { role: 'user', content: buildPrompt(req) }],
      response_format: { type: 'json_object' },
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Azure OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('The AI returned no draft.');
  return parseResult(text);
}
