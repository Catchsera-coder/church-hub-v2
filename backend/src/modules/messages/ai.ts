import { config } from '../../config.js';
import type { MessagingSettings } from '../../db/schema.js';

/**
 * AI compose assistant. Drafts message copy for one, several, or all channels
 * (email / SMS / WhatsApp) in one or more languages from a short brief.
 *
 * Consistent with the rest of the messaging layer (delivery.ts): the provider is
 * called over its HTTP API with fetch — no SDK dependency, so the single global
 * image stays lean and `npm install` has nothing new to resolve.
 *
 * Off by default: a church supplies its own Anthropic key in Settings, or an env
 * default is used. With neither, `resolveAi` returns null and the route replies
 * 400 "AI not configured" — never a fake or silent success (the v1 lesson).
 */
export interface ResolvedAi {
  apiKey: string;
  model: string;
}

export function resolveAi(dbMsg?: MessagingSettings | null): ResolvedAi | null {
  const apiKey = dbMsg?.aiApiKey || config.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { apiKey, model: dbMsg?.aiModel || config.AI_MODEL };
}

export type AiChannel = 'email' | 'sms' | 'whatsapp';

export interface AiDraftRequest {
  brief: string;
  channels: AiChannel[];
  locales: string[]; // e.g. ['en'] or ['en', 'ar']
  tone?: string; // free-text, e.g. "warm and pastoral"
  churchName?: string;
}

/** Per-channel draft: SMS/WhatsApp are body-only; email also carries a subject.
 *  Values are keyed by locale code. */
export interface AiDraftResult {
  email?: { subject: Record<string, string>; body: Record<string, string> };
  sms?: { body: Record<string, string> };
  whatsapp?: { body: Record<string, string> };
}

const LANG_NAMES: Record<string, string> = { en: 'English', ar: 'Arabic' };

/** Build a strict JSON schema so the model returns exactly the shape we asked
 *  for — only the requested channels, only the requested locales. */
function buildSchema(channels: AiChannel[], locales: string[]): Record<string, unknown> {
  const localeObj = () => ({
    type: 'object',
    additionalProperties: false,
    required: locales,
    properties: Object.fromEntries(locales.map((l) => [l, { type: 'string' }])),
  });

  const props: Record<string, unknown> = {};
  if (channels.includes('email')) {
    props.email = {
      type: 'object', additionalProperties: false,
      required: ['subject', 'body'],
      properties: { subject: localeObj(), body: localeObj() },
    };
  }
  if (channels.includes('sms')) {
    props.sms = { type: 'object', additionalProperties: false, required: ['body'], properties: { body: localeObj() } };
  }
  if (channels.includes('whatsapp')) {
    props.whatsapp = { type: 'object', additionalProperties: false, required: ['body'], properties: { body: localeObj() } };
  }
  return { type: 'object', additionalProperties: false, required: channels, properties: props };
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

/** Call the Anthropic Messages API and return validated, structured drafts.
 *  Throws on transport/HTTP errors so the route can surface a clean message. */
export async function draftMessages(ai: ResolvedAi, req: AiDraftRequest): Promise<AiDraftResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ai.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ai.model,
      max_tokens: 2048,
      output_config: { format: { type: 'json_schema', schema: buildSchema(req.channels, req.locales) } },
      messages: [{ role: 'user', content: buildPrompt(req) }],
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`AI provider ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    stop_reason?: string;
    content?: Array<{ type: string; text?: string }>;
  };
  if (data.stop_reason === 'refusal') throw new Error('The AI declined to draft this message.');
  const text = data.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('The AI returned no draft.');

  try {
    return JSON.parse(text) as AiDraftResult;
  } catch {
    throw new Error('The AI returned an unexpected format. Please try again.');
  }
}
