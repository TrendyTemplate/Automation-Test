// Runs the real AI pipeline against a local fake of the Messages API, so we can check
// the exact request we send and how the structured response is used.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const requests = [];
let nextReply = null;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = JSON.parse(body);
    requests.push({ url: req.url, headers: req.headers, body: json });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: json.model, stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(nextReply) }],
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 800 },
    }));
  });
});
await new Promise((r) => fake.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.DB_PATH = ':memory:';

const { run, one, getUsage } = await import('../src/db.js');
const { storeMessage, processMessage } = await import('../src/services/processor.js');
const { encrypt } = await import('../src/crypto.js');

let ws; let mb;
before(() => {
  const u = Number(run(`INSERT INTO users (email, password_hash) VALUES ('ai@test.com', '!')`).lastInsertRowid);
  ws = Number(run(`INSERT INTO workspaces (name, owner_id, plan, subscription_status, billing_interval, business_name, business_description, privacy_shield, reply_delay_min, reply_delay_max)
    VALUES ('Shop', ?, 'pro', 'active', 'monthly', 'Shoe Shop', 'We sell shoes', 1, 0, 0)`, u).lastInsertRowid);
  run(`INSERT INTO knowledge (workspace_id, title, content) VALUES (?, 'Shipping', 'Ships in 3 days')`, ws);
  run(`INSERT INTO corrections (workspace_id, email_summary, ai_draft, final_text) VALUES (?, 'q', 'Dear customer', 'Hey there')`, ws);
  const id = Number(run(`INSERT INTO mailboxes (workspace_id, email, imap_host, smtp_host, username, password_enc, mode) VALUES (?, 'shop@x.com', 'i', 's', 'shop@x.com', ?, 'draft')`, ws, encrypt('pw')).lastInsertRowid);
  mb = one('SELECT * FROM mailboxes WHERE id = ?', id);
});
after(() => fake.close());

const triage = (over = {}) => ({
  category: 'sales_inquiry', priority: 'high', sentiment: 'positive', language: 'en', summary: 'Wants 50 pairs',
  reasoning: 'Bulk purchase request', intent: 'bulk order quote', lead_score: 88, is_phishing: false,
  extracted: { name: 'Ann', company: 'Ann Co', phone: '+1 555', budget: '$2k', deadline: 'June', order_number: '' },
  needs_reply: true, requires_human: false, requires_human_reason: '', confidence: 0.93,
  reply_subject: 'Re: Bulk order', reply_body: 'Hi Ann, yes we can ship 50 pairs in 3 days.', ...over,
});

test('AI request shape: structured output, fallback, cached system prompt with KB, lessons and redaction', async () => {
  nextReply = triage();
  const id = storeMessage(mb, { uid: 1, message_id: '<1@x>', from_name: 'Ann', from_email: 'ann@annco.com', subject: 'Bulk order',
    text_body: 'Need 50 pairs. My card 4111 1111 1111 1111', received_at: new Date().toISOString(), headers: {} });
  await processMessage(id);

  const req = requests.at(-1);
  assert.match(req.url, /\/v1\/messages/);
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.output_config.format.schema.additionalProperties, false);
  assert.equal(req.body.output_config.effort, 'low');
  assert.equal(req.body.system[0].cache_control.type, 'ephemeral');
  assert.match(req.body.system[0].text, /Ships in 3 days/);
  assert.match(req.body.system[0].text, /Hey there/, 'learned corrections are included');
  assert.ok(!req.body.messages[0].content.includes('4111 1111'), 'card number redacted');
  assert.ok(!('temperature' in req.body) && !('thinking' in req.body));

  const m = one('SELECT * FROM messages WHERE id = ?', id);
  assert.equal(m.category, 'sales_inquiry');
  assert.equal(m.lead_score, 88);
  assert.equal(m.reasoning, 'Bulk purchase request');
  assert.equal(JSON.parse(m.extracted_json).company, 'Ann Co');
  const reply = one('SELECT * FROM replies WHERE message_id = ?', id);
  assert.equal(reply.status, 'pending'); // mailbox in draft mode
  assert.equal(reply.ai_original, reply.body);
  const contact = one('SELECT * FROM contacts WHERE id = ?', m.contact_id);
  assert.equal(contact.company, 'Ann Co');
  assert.equal(contact.lead_score, 88);
  const usage = getUsage(ws);
  assert.equal(usage.ai_calls, 1);
  assert.equal(usage.ai_replies, 1);
  assert.equal(usage.input_tokens, 2000);
});

test('autopilot guardrails: requires_human and low confidence hold the reply; phishing is never answered', async () => {
  run(`UPDATE mailboxes SET mode = 'auto' WHERE id = ?`, mb.id);
  nextReply = triage({ requires_human: true, requires_human_reason: 'refund above policy', confidence: 0.95 });
  const a = storeMessage(mb, { uid: 2, message_id: '<2@x>', from_email: 'bob@b.com', subject: 'refund', text_body: 'refund me', received_at: new Date().toISOString(), headers: {} });
  await processMessage(a);
  const ra = one('SELECT * FROM replies WHERE message_id = ?', a);
  assert.equal(ra.status, 'pending');
  assert.match(ra.error, /refund above policy/);

  nextReply = triage({ confidence: 0.4 });
  const b = storeMessage(mb, { uid: 3, message_id: '<3@x>', from_email: 'cy@c.com', subject: 'q', text_body: 'question', received_at: new Date().toISOString(), headers: {} });
  await processMessage(b);
  assert.match(one('SELECT error FROM replies WHERE message_id = ?', b).error, /low confidence/);

  nextReply = triage({ is_phishing: true, category: 'spam' });
  const c = storeMessage(mb, { uid: 4, message_id: '<4@x>', from_email: 'it@evil.com', subject: 'password expires', text_body: 'click', received_at: new Date().toISOString(), headers: {} });
  await processMessage(c);
  assert.equal(one('SELECT status FROM messages WHERE id = ?', c).status, 'ignored');
  assert.equal(one('SELECT COUNT(*) AS n FROM replies WHERE message_id = ?', c).n, 0);

  // Automated senders never reach the AI at all.
  const before = requests.length;
  const d = storeMessage(mb, { uid: 5, message_id: '<5@x>', from_email: 'noreply@shop.com', subject: 'receipt', text_body: 'x', received_at: new Date().toISOString(), headers: {} });
  await processMessage(d);
  assert.equal(requests.length, before);
});
