import { makeStore, startServer } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { drainJobs } from '../src/core/jobs.js';
import { schedulePolls } from '../src/core/mailbox.js';
import { get } from '../src/db.js';

process.env.ALLOW_PRIVATE_HOSTS = 'true'; // the test IMAP server runs on 127.0.0.1
const require = createRequire(import.meta.url);
const hoodiecrow = require('hoodiecrow-imap');

const PORT = 21143;
const imap = hoodiecrow({
  plugins: ['id', 'unselect', 'enable', 'uidplus', 'literalplus', 'sasl-ir'],
  users: { 'orders@tea.co': { password: 'pw' } },
  storage: { INBOX: { messages: [] } },
});
await new Promise((r) => imap.listen(PORT, '127.0.0.1', r));
const deliver = (raw) => imap.appendMessage('INBOX', [], new Date(), raw);
const srv = await startServer();
after(async () => { await srv.close(); await new Promise((r) => imap.close(r)); });

const csvMail = (po) => [
  'From: Dana <dana@cornergrocer.com>', `Subject: PO ${po}`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '',
  '--b', 'Content-Type: text/plain', '', 'Order attached', '--b',
  `Content-Type: text/csv; name="${po}.csv"`, `Content-Disposition: attachment; filename="${po}.csv"`, '', `PO Number: ${po}`, 'SKU,Qty', 'MUG-CER-01,4', '--b--', '',
].join('\r\n');

test('IMAP: wrong password is rejected before saving', async () => {
  const s = makeStore();
  const r = await srv.client(s.apiKey)('/api/mailboxes', { method: 'POST', body: { host: '127.0.0.1', port: PORT, secure: false, username: 'orders@tea.co', password: 'bad' } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Mailbox login failed/);
});

test('IMAP: only mail that arrives after connecting is imported', async () => {
  deliver(csvMail('OLD-1')); // already in the inbox: must not be imported
  const s = makeStore();
  const call = srv.client(s.apiKey);
  const add = await call('/api/mailboxes', { method: 'POST', body: { host: '127.0.0.1', port: PORT, secure: false, username: 'orders@tea.co', password: 'pw' } });
  assert.equal(add.status, 201);
  const list = (await call('/api/mailboxes')).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].last_error, null);
  assert.equal(JSON.stringify(list).includes('pw'), false, 'password never returned');

  deliver(csvMail('NEW-1'));
  deliver(csvMail('NEW-2'));
  schedulePolls();
  await drainJobs(); // poll → two ingest jobs → processed
  const pos = (await call('/api/pos?status=')).data.map((p) => p.po_number).sort();
  assert.deepEqual(pos, ['NEW-1', 'NEW-2']);

  schedulePolls();
  await drainJobs();
  assert.equal((await call('/api/pos?status=')).data.length, 2, 'no duplicates on the next poll');

  const mbId = list[0].id;
  assert.ok(get('SELECT last_uid FROM mailboxes WHERE id = ?', mbId).last_uid >= 3);
  assert.equal((await call(`/api/mailboxes/${mbId}`, { method: 'DELETE' })).status, 200);
});

test('IMAP: private hosts are refused unless explicitly allowed', async () => {
  process.env.ALLOW_PRIVATE_HOSTS = 'false';
  const s = makeStore();
  const r = await srv.client(s.apiKey)('/api/mailboxes', { method: 'POST', body: { host: '127.0.0.1', port: 993, username: 'a', password: 'b' } });
  process.env.ALLOW_PRIVATE_HOSTS = 'true';
  assert.equal(r.status, 400);
  assert.match(r.data.error, /private network|not allowed/);
});
