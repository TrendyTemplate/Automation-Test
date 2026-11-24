// Automatic customer emails that every well-run SaaS sends. Each one is sent at most once per (workspace, kind, ref),
// so customers are never spammed. Can be switched off in Admin → Settings → General.
import { one, all, run, getUsage, period } from '../db.js';
import { effectivePlan } from '../plans.js';
import { getBool, appUrl, appName } from '../settings.js';
import { sendSystemEmail } from './notify.js';

const ownerOf = (wsId) => one('SELECT u.email, u.name FROM workspaces w JOIN users u ON u.id = w.owner_id WHERE w.id = ?', wsId);

/** Send once; returns true if sent now. */
export async function sendOnce(wsId, kind, ref, subject, text) {
  if (!getBool('lifecycle_emails')) return false;
  const ins = run('INSERT OR IGNORE INTO lifecycle_sent (workspace_id, kind, ref) VALUES (?,?,?)', wsId, kind, String(ref || ''));
  if (!ins.changes) return false;
  const owner = ownerOf(wsId);
  if (!owner) return false;
  await sendSystemEmail(owner.email, subject, `Hi${owner.name ? ` ${owner.name.split(' ')[0]}` : ''},\n\n${text}\n\n— The ${appName()} team`).catch((e) => console.error('[lifecycle]', e.message));
  return true;
}

export function welcome(wsId) {
  return sendOnce(wsId, 'welcome', '', `Welcome to ${appName()} — let's set up your assistant`,
    `Thanks for signing up! Four steps get you to your first AI-answered customer message:\n\n1. Add your products and prices: ${appUrl()}/app#catalog\n2. Tell the assistant about delivery charges, payment and returns: ${appUrl()}/app#brain\n3. Try the Test chat to see how it answers: ${appUrl()}/app#saleslab\n4. Connect your Facebook Page, Instagram or WhatsApp: ${appUrl()}/app#channels\n\nEverything starts in Draft mode, so nothing is sent without your approval until you decide otherwise.\nTip: turn on two-factor authentication in Security & privacy.`);
}

export function paymentFailed(wsId, ref) {
  return sendOnce(wsId, 'payment_failed', ref, `Action needed: your ${appName()} payment failed`,
    `We couldn't process your latest payment. To keep your sales assistant running, please update your payment method:\n${appUrl()}/app#billing`);
}

/** Periodic checks run by the worker. */
export async function checkLifecycle(now = new Date()) {
  if (!getBool('lifecycle_emails')) return;
  const p = period();
  for (const ws of all('SELECT * FROM workspaces WHERE suspended = 0')) {
    // Trial ending / ended
    if (ws.plan === 'trial' && ws.trial_ends_at) {
      const left = (new Date(ws.trial_ends_at) - now) / 86400_000;
      if (left > 0 && left <= 3) {
        await sendOnce(ws.id, 'trial_ending', ws.trial_ends_at, `Your ${appName()} trial ends in ${Math.ceil(left)} day(s)`,
          `Your free trial ends on ${new Date(ws.trial_ends_at).toDateString()}. Choose a plan to keep your sales assistant answering customers — your products, settings and chats stay exactly as they are:\n${appUrl()}/app#billing`);
      } else if (left <= 0 && left > -14) {
        await sendOnce(ws.id, 'trial_ended', ws.trial_ends_at, `Your ${appName()} trial has ended — automation is paused`,
          `Your trial has ended, so customer messages are no longer answered by the assistant. Pick a plan to resume instantly:\n${appUrl()}/app#billing`);
      }
    }
    // Usage limits (80% / 100% of AI replies this month)
    const plan = effectivePlan(ws);
    if (plan.key !== 'expired' && plan.aiRepliesPerMonth > 0) {
      const used = getUsage(ws.id).ai_replies / plan.aiRepliesPerMonth;
      if (used >= 1) {
        await sendOnce(ws.id, 'usage_100', p, `You've used all AI replies for this month`,
          `Your ${plan.name} plan includes ${plan.aiRepliesPerMonth} AI replies per month and they've all been used. Customer messages are still collected, but the assistant pauses until next month. Upgrade to continue now:\n${appUrl()}/app#billing`);
      } else if (used >= 0.8) {
        await sendOnce(ws.id, 'usage_80', p, `You've used 80% of this month's AI replies`,
          `Heads up: ${Math.round(used * 100)}% of your ${plan.aiRepliesPerMonth} monthly AI replies are used. See usage or upgrade:\n${appUrl()}/app#billing`);
      }
    }
  }
  // Channels that keep failing to send (e.g. token expired, page disconnected) — never fail silently.
  for (const ch of all(`SELECT id, workspace_id, name, platform, last_error FROM channels WHERE enabled = 1 AND last_error IS NOT NULL`)) {
    await sendOnce(ch.workspace_id, 'channel_error', `${ch.id}:${now.toISOString().slice(0, 10)}`, `${ch.name || ch.platform} can't send messages`,
      `Replies to your customers on ${ch.name || ch.platform} are failing.\n\nReason: ${String(ch.last_error).slice(0, 300)}\n\nThis usually means the access token expired or the page/number was disconnected. Paste a new token here:\n${appUrl()}/app#channels`);
  }
}
