// Claude API access shared by the sales assistant: client, privacy masking, structured calls with usage tracking.
import Anthropic from '@anthropic-ai/sdk';
import { all, run, bumpUsage } from '../db.js';
import { getSetting } from '../settings.js';

let client = null;
let clientKey = '';
function getClient() {
  const key = getSetting('anthropic_api_key');
  if (!key) return null;
  if (key !== clientKey) { client = new Anthropic({ apiKey: key }); clientKey = key; }
  return client;
}
export const aiEnabled = () => Boolean(getSetting('anthropic_api_key'));

// ---------- Privacy Shield: mask sensitive data before anything leaves the server ----------
const REDACTIONS = [
  [/\b(?:\d[ -]?){13,19}\b/g, '[CARD-REDACTED]'],
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '[IBAN-REDACTED]'],
  [/\b(password|passcode|pwd|pin|otp|verification code|পাসওয়ার্ড)\s*[:=]?\s*\S+/gi, '$1: [REDACTED]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN-REDACTED]'],
];
export function redact(text) {
  let t = String(text || '');
  for (const [re, rep] of REDACTIONS) t = t.replace(re, rep);
  return t;
}
export const countRedactions = (text) => REDACTIONS.reduce((n, [re]) => n + (String(text || '').match(new RegExp(re.source, re.flags)) || []).length, 0);

export async function call(ws, { system, user, schema, maxTokens = 4000, purpose = 'other', conversationId = null, redactions = 0 }) {
  const c = getClient();
  if (!c) throw new Error('AI is not configured');
  const params = {
    model: getSetting('ai_model') || 'claude-opus-5-5',
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { effort: getSetting('ai_effort') || 'low', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  let response;
  try {
    // Server-side refusal fallback: if the model declines, the API retries on a recommended fallback model.
    response = await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    // Some models/platforms don't accept the fallback parameter: retry once without it.
    if (!(e instanceof Anthropic.BadRequestError) || !/fallback/i.test(e.message)) throw e;
    response = await c.messages.create(params);
  }
  run('INSERT INTO ai_log (workspace_id, conversation_id, purpose, model, input_tokens, output_tokens, redactions) VALUES (?,?,?,?,?,?,?)',
    ws.id, conversationId, purpose, response.model || params.model, response.usage?.input_tokens || 0, response.usage?.output_tokens || 0, redactions);
  bumpUsage(ws.id, {
    ai_calls: 1,
    input_tokens: (response.usage?.input_tokens || 0) + (response.usage?.cache_read_input_tokens || 0) + (response.usage?.cache_creation_input_tokens || 0),
    output_tokens: response.usage?.output_tokens || 0,
  });
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('AI declined this request'), { refusal: true });
  if (response.stop_reason === 'max_tokens') throw new Error('AI output was truncated');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return schema ? JSON.parse(text) : text.trim();
}
