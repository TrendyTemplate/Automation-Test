// Connect everything the user granted in the Facebook dialog in one go — no extra picking step.
// Each Page (Messenger), its linked Instagram account and each WhatsApp number becomes a channel, webhooks are
// subscribed, the shop profile is filled in from the Page, and learning from past chats starts in the background.
import { one, all, run, logActivity, audit } from '../db.js';
import { randomToken } from '../crypto.js';
import { seal } from '../vault.js';
import { effectivePlan } from '../plans.js';
import { subscribePage, subscribeWaba, fetchPageProfile } from './meta.js';
import { queueImport } from './learning.js';

/**
 * items: pages [{id, name, token, instagram:{id, username}}] or WhatsApp numbers [{id, waba, name, phone}].
 * Returns [{name, platform, ok|error, reconnected}].
 */
export async function connectGranted(req, wsId, { kind, fbUserId, userToken, items, mode = 'auto' }) {
  const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId);
  const plan = effectivePlan(ws);
  const want = [];
  for (const it of items) {
    if (kind === 'whatsapp') { want.push({ platform: 'whatsapp', external_id: it.id, name: it.name || it.phone, token: userToken, waba: it.waba }); continue; }
    want.push({ platform: 'messenger', external_id: it.id, name: it.name, token: it.token, page: it });
    if (it.instagram) want.push({ platform: 'instagram', external_id: it.instagram.id, send_id: it.id, name: it.instagram.username ? `@${it.instagram.username}` : `${it.name} (Instagram)`, token: it.token, page: it });
  }
  const results = [];
  const subscribed = new Set();
  for (const w of want) {
    const existing = one('SELECT * FROM channels WHERE platform = ? AND external_id = ?', w.platform, w.external_id);
    if (existing && existing.workspace_id !== wsId) { results.push({ name: w.name, platform: w.platform, error: 'already connected to another ChatPilot account' }); continue; }
    if (!existing && one('SELECT COUNT(*) AS n FROM channels WHERE workspace_id = ?', wsId).n >= plan.channels) {
      results.push({ name: w.name, platform: w.platform, error: `your ${plan.name} plan includes ${plan.channels} page(s) — upgrade to add more` }); continue;
    }
    try {
      const subKey = w.page ? `page:${w.page.id}` : `waba:${w.waba}`;
      if (!subscribed.has(subKey)) { await (w.page ? subscribePage(w.page.id, w.page.token) : subscribeWaba(w.waba, w.token)); subscribed.add(subKey); }
    } catch (e) { results.push({ name: w.name, platform: w.platform, error: `Meta refused the connection: ${e.message}` }); continue; }
    const tokenEnc = seal(wsId, 'channels.access_token', w.token);
    let id;
    if (existing) {
      id = existing.id;
      run(`UPDATE channels SET access_token_enc = ?, managed = 1, connected_by = ?, send_id = COALESCE(?, send_id), waba_id = COALESCE(?, waba_id), enabled = 1, last_error = NULL WHERE id = ?`,
        tokenEnc, fbUserId, w.send_id || null, w.waba || null, existing.id);
      results.push({ name: w.name, platform: w.platform, ok: true, reconnected: true, id });
    } else {
      id = Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, send_id, access_token_enc, app_secret_enc, verify_token, mode, managed, connected_by, waba_id, history_status)
        VALUES (?,?,?,?,?,?,'',?,?,1,?,?, 'pending')`, wsId, w.platform, w.name, w.external_id, w.send_id || null, tokenEnc, `cp_${randomToken(24)}`, mode, fbUserId, w.waba || null).lastInsertRowid);
      audit(req, 'channel.connect', id, { platform: w.platform, via: 'facebook_login' });
      logActivity(wsId, 'channel_added', { platform: w.platform, name: w.name });
      results.push({ name: w.name, platform: w.platform, ok: true, id });
    }
    queueImport(id); // learn from this page's past chats and comments, automatically
  }
  // Describe the shop from its first Page so the assistant knows the business without the owner typing anything.
  const firstPage = kind === 'pages' && items.find((p) => results.some((r) => r.ok && r.platform === 'messenger' && r.name === p.name));
  if (firstPage && !ws.business_description) {
    const p = await fetchPageProfile(firstPage.id, firstPage.token);
    if (p) {
      const desc = [`${p.name || firstPage.name}${p.category ? ` — ${p.category}` : ''}.`, p.about, p.description, p.single_line_address && `Address: ${p.single_line_address}.`,
        p.phone && `Phone: ${p.phone}.`, p.website && `Website: ${p.website}`].filter(Boolean).join(' ').slice(0, 2000);
      run('UPDATE workspaces SET business_description = ?, business_name = COALESCE(NULLIF(business_name, \'\'), ?) WHERE id = ?', desc, p.name || firstPage.name, wsId);
      if (/'s shop$/.test(ws.name)) run('UPDATE workspaces SET name = ? WHERE id = ?', String(p.name || firstPage.name).slice(0, 120), wsId);
      const domain = (() => { try { return new URL(p.website).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      if (domain && !ws.allowed_link_domains) run('UPDATE workspaces SET allowed_link_domains = ? WHERE id = ?', domain, wsId);
    }
  }
  void all;
  return results;
}
