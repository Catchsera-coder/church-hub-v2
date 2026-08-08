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
  | { provider: 'azure'; endpoint: string; apiKey: string; deployment: string; apiVersion: string; model: string };

const DEFAULT_AZURE_MODEL = 'gpt-4o-mini';
const DEFAULT_AZURE_API_VERSION = '2024-10-21';

export function resolveAi(dbMsg?: MessagingSettings | null): ResolvedAi | null {
  const m = dbMsg ?? {};
  const azEndpoint = (m.azureOpenaiEndpoint || config.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '');
  const azKey = m.azureOpenaiKey || config.AZURE_OPENAI_KEY;
  const provider = m.aiProvider || (azEndpoint && azKey ? 'azure' : 'anthropic');

  if (provider === 'azure') {
    const model = m.aiModel || config.AZURE_OPENAI_DEPLOYMENT || DEFAULT_AZURE_MODEL;
    const deployment = m.azureOpenaiDeployment || config.AZURE_OPENAI_DEPLOYMENT || model;
    const apiVersion = m.azureOpenaiApiVersion || config.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;
    if (azEndpoint && azKey && deployment) return { provider: 'azure', endpoint: azEndpoint, apiKey: azKey, deployment, apiVersion, model };
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
    headers: { 'content-type': 'application/json', 'api-key': ai.apiKey },
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
