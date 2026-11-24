// Deterministic safety checks that do NOT rely on the AI. The worst failures of AI sales bots are invented
// prices/discounts, links to scam sites and prompt-injection that turns the assistant against its owner.
// A model can be fooled; these rules cannot be talked out of their job.

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts|rules)/i,
  /disregard (the |all )?(previous|prior|above|system) (instructions|prompt|rules)/i,
  /(you are|act as|pretend to be) (now )?(an? )?(ai|assistant|system|developer|admin)/i,
  /(system|developer) (prompt|message|instructions)\s*[:=]/i,
  /reveal (your|the) (system )?(prompt|instructions|rules)/i,
  /(forward|send|email|copy) (all|every|the last \d+|your) (emails?|messages?|inbox|contacts|conversations?) to/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,
  /\[\[?\s*(system|assistant)\s*\]?\]/i,
  /BEGIN (SYSTEM|ADMIN) (PROMPT|INSTRUCTIONS)/i,
  /do not (tell|inform|alert) (the )?(user|owner|human)/i,
];

/** Detect instructions aimed at the AI hidden in a customer message. */
export function detectInjection(text) {
  const t = String(text || '');
  const hits = INJECTION_PATTERNS.filter((re) => re.test(t)).length;
  // Long base64 blobs and zero-width characters are common ways to smuggle hidden instructions.
  const smuggling = /[​-‏⁠-⁤﻿]{3,}/.test(t) || /[A-Za-z0-9+/]{400,}={0,2}/.test(t);
  return { flagged: hits > 0 || smuggling, score: hits + (smuggling ? 1 : 0) };
}

const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || '';
const OPT_OUT = /\b(unsubscribe me|remove me from (your|the) (list|mailing)|stop (emailing|contacting|sending)( me)?|do not (contact|email) me|opt[ -]?out|take me off)\b/i;
export const wantsOptOut = (text) => OPT_OUT.test(String(text || '').slice(0, 3000));

/** Workspace-defined topics that must always reach a human (refunds, legal …). */
export function sensitiveTopicHit(text, topicsCsv) {
  const t = String(text || '').toLowerCase();
  return String(topicsCsv || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).find((topic) => t.includes(topic)) || null;
}

const MONEY = /(?:[$€£¥₹৳]|\b(?:usd|eur|gbp|bdt|inr|tk|rs)\.?\s?)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:usd|eur|gbp|bdt|inr|dollars?|euros?|taka|rupees?)\b|\d+(?:\.\d+)?\s?%\s?(?:off|discount)/gi;
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_RE = /\b(sk-[a-z0-9-]{16,}|sk_(live|test)_[a-z0-9]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|cp_live_[a-f0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
/** Card numbers: 13-19 digits that pass the Luhn checksum and are not international phone numbers (+…). */
export function containsCardNumber(text) {
  for (const m of String(text || '').matchAll(/(\+?)\b(?:\d[ -]?){12,18}\d\b/g)) {
    if (m[1] === '+') continue;
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}
const normMoney = (m) => m.toLowerCase().replace(/[\s,]/g, '').replace(/\.0+$/, '').replace(/(usd|dollars?)/, '$').replace(/(eur|euros?)/, '€');
const digitsOf = (m) => m.replace(/[^\d.]/g, '').replace(/\.0+$/, '');

/**
 * Check an outgoing reply against what the business actually knows.
 * Returns a list of problems; any problem means the reply is held for human review (never auto-sent).
 */
export function checkOutbound(reply, { knowledge = '', original = '', bookingLink = '', allowedDomains = [], mailboxDomains = [], neverSay = '', senderEmail = '' }) {
  const problems = [];
  const body = String(reply || '');
  const facts = `${knowledge}\n${original}`;

  // 1. Prices/discounts must appear in the knowledge base or the customer's own email (no invented numbers).
  const knownAmounts = new Set((facts.match(MONEY) || []).map(digitsOf));
  for (const m of body.match(MONEY) || []) {
    if (!knownAmounts.has(digitsOf(m))) problems.push(`mentions an amount not found in your knowledge base: "${m.trim()}"`);
  }
  // 2. Links must point to domains the business controls or listed.
  // Only links from the business's own knowledge (never from the incoming email, which an attacker controls).
  const okDomains = new Set([...allowedDomains, ...mailboxDomains, ...(String(knowledge).match(URL_RE) || []).map((u) => { try { return new URL(u).hostname; } catch { return ''; } })]
    .concat(bookingLink ? [(() => { try { return new URL(bookingLink).hostname; } catch { return ''; } })()] : [])
    .filter(Boolean).map((d) => d.toLowerCase().replace(/^www\./, '')));
  for (const u of body.match(URL_RE) || []) {
    let host = '';
    try { host = new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* invalid */ }
    if (!host || ![...okDomains].some((d) => host === d || host.endsWith(`.${d}`))) problems.push(`contains a link to an unapproved site: ${host || u}`);
  }
  // 3. No third-party email addresses (classic data-exfiltration / redirection channel).
  const okEmails = new Set([senderEmail.toLowerCase(), ...(String(knowledge).match(EMAIL_RE) || []).map((e) => e.toLowerCase())]);
  for (const e of body.match(EMAIL_RE) || []) {
    const d = domainOf(e);
    if (!okEmails.has(e.toLowerCase()) && !mailboxDomains.includes(d)) problems.push(`mentions an unknown email address: ${e}`);
  }
  // 4. Secrets / card numbers must never leave.
  if (SECRET_RE.test(body)) problems.push('contains something that looks like an API key or private key');
  if (containsCardNumber(body)) problems.push('contains something that looks like a card number');
  // 5. Owner's "never say" list.
  for (const phrase of String(neverSay || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean)) {
    if (body.toLowerCase().includes(phrase.toLowerCase())) problems.push(`uses a phrase on your "never say" list: "${phrase}"`);
  }
  // 6. Sanity: empty / runaway / instruction-echo.
  if (body.trim().length < 2) problems.push('reply is empty');
  if (body.length > 8000) problems.push('reply is unusually long');
  if (/system prompt|as an ai (language )?model|my instructions/i.test(body)) problems.push('reply talks about the AI itself');
  return [...new Set(problems)];
}
