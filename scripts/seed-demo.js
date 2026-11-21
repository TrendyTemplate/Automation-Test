// Fill a database with realistic demo data so you can explore the dashboard and admin panel
// without connecting a real mailbox. Usage:  DB_PATH=./data/demo.db node scripts/seed-demo.js
// Log in afterwards with demo@mailpilot.test / Demo-Pass-2026 (platform admin).
import bcrypt from 'bcryptjs';
import { run, one } from '../src/db.js';
import { encrypt } from '../src/crypto.js';

const email = 'demo@mailpilot.test';
if (one('SELECT id FROM users WHERE email = ?', email)) {
  console.log('Demo data already exists.');
  process.exit(0);
}
const uid = Number(run(`INSERT INTO users (email, name, password_hash, is_admin, email_verified, referral_code) VALUES (?,?,?,1,1,'demo01')`,
  email, 'Demo Owner', await bcrypt.hash('Demo-Pass-2026', 10)).lastInsertRowid);
const ws = Number(run(`INSERT INTO workspaces (name, owner_id, business_name, business_description, plan, subscription_status, billing_interval, current_period_end, signature, telegram_chat_id)
  VALUES ('Acme Travel', ?, 'Acme Travel', 'Boutique travel agency selling tour packages to Thailand, Bali and the Maldives.', 'pro', 'active', 'monthly', datetime('now','+20 days'), 'Best regards,\nAcme Travel Team', '12345')`, uid).lastInsertRowid);
run(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?, 'owner')`, ws, uid);

const mb1 = Number(run(`INSERT INTO mailboxes (workspace_id, label, email, provider, imap_host, smtp_host, username, password_enc, mode, last_sync_at, auth_type)
  VALUES (?, 'Sales', 'sales@acme-travel.com', 'custom', 'mail.acme-travel.com', 'mail.acme-travel.com', 'sales@acme-travel.com', ?, 'auto', datetime('now','-2 minutes'), 'password')`, ws, encrypt('x')).lastInsertRowid);
const mb2 = Number(run(`INSERT INTO mailboxes (workspace_id, label, email, provider, imap_host, smtp_host, username, password_enc, mode, last_sync_at, auth_type)
  VALUES (?, 'Support', 'acme.support@gmail.com', 'gmail', 'imap.gmail.com', 'smtp.gmail.com', 'acme.support@gmail.com', ?, 'draft', datetime('now','-3 minutes'), 'oauth_google')`, ws, encrypt('')).lastInsertRowid);

run(`INSERT INTO knowledge (workspace_id, title, content) VALUES (?, 'Bali package', '7 nights Bali: $1,290 per person incl. hotel, breakfast, airport transfer. Departures every Saturday.'),
  (?, 'Refund policy', 'Full refund up to 30 days before departure. 50% refund 14-30 days. No refund within 14 days.')`, ws, ws);

const emails = [
  [mb1, 'Sarah Johnson', 'sarah@bigcorp.com', 'Group trip to Bali for 25 people', 'sales_inquiry', 'high', 'positive', 'en', 'Wants a quote for a 25-person company retreat to Bali in March.', 'Company retreat quote for 25 people', 92, 'replied', 0.91, 'Clear purchase intent with group size, date and budget'],
  [mb1, 'Carlos Méndez', 'carlos@mendez.es', '¿Precio del paquete a Tailandia?', 'sales_inquiry', 'normal', 'neutral', 'es', 'Asks the price of the Thailand package for two in May.', 'Thailand package price for 2', 74, 'drafted', 0.62, 'Price question not fully covered in knowledge base'],
  [mb2, 'Ahmed Rahman', 'ahmed.r@gmail.com', 'Booking not confirmed — very disappointed', 'complaint', 'urgent', 'negative', 'en', 'Paid 5 days ago, still no confirmation; threatens chargeback.', 'Booking confirmation and reassurance', 20, 'drafted', 0.45, 'Angry customer with payment issue, needs a human'],
  [mb2, 'Priya Sharma', 'priya@outlook.com', 'Can I change my travel dates?', 'support', 'normal', 'neutral', 'en', 'Wants to move Bali trip from 12 to 19 April.', 'Change travel dates', 35, 'replied', 0.88, 'Standard support request answered by policy'],
  [mb1, 'Tanvir Hasan', 'tanvir@startup.com.bd', 'মালদ্বীপ হানিমুন প্যাকেজ', 'sales_inquiry', 'high', 'positive', 'bn', 'Asks for a Maldives honeymoon package for December.', 'Maldives honeymoon package', 85, 'replied', 0.84, 'Strong intent, specific dates'],
  [mb2, 'IT Security', 'security@acme-trave1.com', 'Your mailbox password expires today', 'spam', 'low', 'neutral', 'en', 'Fake password-expiry notice with suspicious link.', 'Credential phishing', 0, 'ignored', 0.99, 'Look-alike domain and password request: phishing'],
  [mb1, 'Emma Wilson', 'emma@wilsonevents.co.uk', 'Partnership with our wedding planning agency', 'partnership', 'normal', 'positive', 'en', 'Proposes a referral partnership for destination weddings.', 'Referral partnership', 60, 'triaged', 0.7, 'Business partnership proposal'],
];
emails.forEach(([mb, name, from, subject, category, priority, sentiment, lang, summary, intent, leadScore, status, conf, why], i) => {
  run(`INSERT INTO contacts (workspace_id, email, name, emails_in, lead_score, last_sentiment, last_seen, vip) VALUES (?,?,?,?,?,?,datetime('now', ?), ?)`,
    ws, from, name, 1 + (i % 3), leadScore, sentiment, `-${i * 3} hours`, i === 0 ? 1 : 0);
  const cid = one('SELECT id FROM contacts WHERE workspace_id = ? AND email = ?', ws, from).id;
  const mid = Number(run(`INSERT INTO messages (workspace_id, mailbox_id, uid, message_id, from_name, from_email, to_email, subject, text_body, received_at,
      category, priority, sentiment, language, summary, intent, lead_score, needs_reply, confidence, status, reasoning, is_phishing, contact_id, extracted_json, first_response_sec)
    VALUES (?,?,?,?,?,?,?,?,?, datetime('now', ?),?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`,
  ws, mb, i + 1, `<demo-${i}@x>`, name, from, '', subject, `Hello,\n\n${summary}\n\nThanks,\n${name}`, `-${i * 3} hours`,
  category, priority, sentiment, lang, summary, intent, leadScore, conf, status, why, category === 'spam' ? 1 : 0, cid,
  JSON.stringify({ name, company: i === 0 ? 'BigCorp Ltd' : '', phone: i === 0 ? '+1 555 0100' : '', budget: i === 0 ? '$40,000' : '', deadline: i === 0 ? 'March' : '', order_number: '' }),
  status === 'replied' ? 300 + i * 120 : null).lastInsertRowid);
  if (status === 'replied') run(`INSERT INTO replies (workspace_id, message_id, subject, body, source, status, sent_at) VALUES (?,?,?,?, 'ai', 'sent', datetime('now', ?))`, ws, mid, `Re: ${subject}`, 'Thank you for reaching out! Here are the details…', `-${i * 3 - 1} hours`);
  if (status === 'drafted') run(`INSERT INTO replies (workspace_id, message_id, subject, body, source, status, error, ai_original) VALUES (?,?,?,?, 'ai', 'pending', ?, ?)`, ws, mid, `Re: ${subject}`,
    i === 2 ? "Dear Ahmed,\n\nI'm truly sorry for the delay. I've escalated your booking and a team member will confirm it within 2 hours." : 'Hola Carlos,\n\n¡Gracias por tu interés! El paquete de Tailandia…',
    i === 2 ? 'Held for review: angry customer, payment issue; low confidence (45%)' : 'Held for review: low confidence (62%)', 'draft');
});
run(`INSERT INTO usage (workspace_id, period, ai_calls, ai_replies, emails_sent, input_tokens, output_tokens) VALUES (?, ?, 412, 318, 287, 1650000, 210000)`, ws, new Date().toISOString().slice(0, 7));
run(`INSERT INTO activity (workspace_id, type, detail) VALUES (?, 'auto_reply_sent', '{"to":"sarah@bigcorp.com","subject":"Group trip to Bali"}'), (?, 'phishing_blocked', '{"from":"security@acme-trave1.com","subject":"Your mailbox password expires today"}')`, ws, ws);

// A few more customers for the admin panel.
for (const [e, plan, status, interval, amount, method] of [
  ['nora@bakery.co', 'starter', 'active', 'monthly', 19, 'stripe'], ['li@agency.cn', 'business', 'active', 'yearly', 1490, 'stripe'],
  ['rafi@shop.com.bd', 'pro', 'active', 'manual', 49, 'bkash'], ['old@client.com', 'starter', 'canceled', 'monthly', 19, 'stripe'],
  ['life@time.io', 'lifetime', 'active', 'once', 299, 'paypal'], ['new@trial.dev', 'trial', null, null, 0, null],
]) {
  const u = Number(run(`INSERT INTO users (email, name, password_hash, referral_code, referred_by, created_at) VALUES (?,?,'!',?, ?, datetime('now', ?))`, e, e.split('@')[0], Math.random().toString(36).slice(2, 8), e.startsWith('rafi') ? uid : null, `-${Math.floor(Math.random() * 25)} days`).lastInsertRowid);
  const w = Number(run(`INSERT INTO workspaces (name, owner_id, plan, subscription_status, billing_interval, trial_ends_at, current_period_end) VALUES (?,?,?,?,?, datetime('now','+10 days'), datetime('now','+25 days'))`,
    e.split('@')[1], u, plan, status, interval).lastInsertRowid);
  run(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?, 'owner')`, w, u);
  if (amount) run(`INSERT INTO payments (workspace_id, amount, method, plan, interval, reference, referral_user_id, commission, created_at) VALUES (?,?,?,?,?,?,?,?, datetime('now', ?))`,
    w, amount, method, plan, interval, `demo-${e}`, e.startsWith('rafi') ? uid : null, e.startsWith('rafi') ? 14.7 : 0, `-${Math.floor(Math.random() * 28)} days`);
  if (e.startsWith('nora')) {
    const t = Number(run(`INSERT INTO tickets (workspace_id, user_id, subject, priority) VALUES (?,?, 'Outlook account shows an error', 'high')`, w, u).lastInsertRowid);
    run(`INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES (?,?, 'My Outlook mailbox says authentication failed since yesterday. Can you help?')`, t, u);
  }
}
run(`INSERT INTO announcements (message, level) VALUES ('New: the AI now learns your writing style. Try it in AI brain → Writing style!', 'success')`);
console.log('Demo data created. Log in with demo@mailpilot.test / Demo-Pass-2026');
