// Voice messages → text, so the assistant can answer "voice note" customers (very common in Bangladesh).
// Any OpenAI-compatible transcription endpoint (OpenAI, Groq Whisper, a self-hosted Whisper server); set in Admin → Settings.
import { getSetting } from '../settings.js';

export const sttEnabled = () => Boolean(getSetting('stt_api_key') && getSetting('stt_url'));

/** audio: { buffer, media_type }. Returns the transcript or null. */
export async function transcribe(audio, { language = '' } = {}) {
  if (!sttEnabled() || !audio?.buffer?.length) return null;
  const form = new FormData();
  const ext = /ogg|opus/.test(audio.media_type) ? 'ogg' : /mp4|m4a|aac/.test(audio.media_type) ? 'm4a' : /mpeg|mp3/.test(audio.media_type) ? 'mp3' : /wav/.test(audio.media_type) ? 'wav' : 'ogg';
  form.append('file', new Blob([audio.buffer], { type: audio.media_type || 'audio/ogg' }), `voice.${ext}`);
  form.append('model', getSetting('stt_model') || 'whisper-1');
  if (language) form.append('language', language);
  const res = await fetch(getSetting('stt_url'), { method: 'POST', headers: { authorization: `Bearer ${getSetting('stt_api_key')}` }, body: form, signal: AbortSignal.timeout(60_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Transcription HTTP ${res.status}`);
  return String(j.text || '').trim().slice(0, 2000) || null;
}
