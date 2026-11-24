// One-step onboarding ("welcome") and the learning page ("what the AI learned").
import { esc, icon, api, toast, bind, ago, num, empty, confirmBox } from '../ui.js';

const PL = { messenger: 'Facebook Page', instagram: 'Instagram', whatsapp: 'WhatsApp' };
const STATUS = {
  pending: ['clock', 'Waiting to start'], running: ['refresh', 'Reading past chats & comments…'], done: ['checkCircle', 'Learned from past chats'],
  unavailable: ['sparkles', 'Learning from new chats'], failed: ['alert', 'Past chats unavailable — learning from new chats'],
};

export async function welcome(ctx, params) {
  const [pages, meta, learning] = await Promise.all([api('/sales/pages'), api('/sales/meta/status'), api('/sales/learning')]);
  const manager = ['owner', 'admin'].includes(ctx.me.role);
  if (!pages.length) {
    ctx.view.innerHTML = `
      <div class="welcome">
        <div class="welcome-art">${icon('chat')}</div>
        <h1>Connect your Facebook Page</h1>
        <p class="lead-w">That's the only step. ChatPilot reads how your page answers customers, learns your prices and style, and starts replying — on Messenger, Instagram and post comments.</p>
        ${params.error ? `<div class="callout bad">${icon('alert')}<div>${esc(params.error === 'no_pages' ? 'Facebook did not share any Page — tick your Page in the Facebook window.' : params.error)}</div></div>` : ''}
        ${manager ? (meta.available ? `<a class="btn fbig" href="/api/oauth/meta/connect?kind=pages">${icon('plug')}Connect with Facebook</a>
          <p class="hint">You choose the Pages in Facebook's window — pick as many as you manage. Instagram accounts linked to them come along.</p>
          <div class="row" style="justify-content:center;gap:16px"><a href="/api/oauth/meta/connect?kind=whatsapp">Connect WhatsApp Business instead</a><a href="#dashboard">Skip for now</a></div>`
          : `<div class="callout">${icon('info')}<div>One-click connect isn't set up on this server yet. <a href="#channels">Connect manually</a>.</div></div>`)
        : '<p class="hint">Ask the owner of this workspace to connect the Page.</p>'}
        <ol class="welcome-steps"><li><b>Connect</b> — one click, choose your Pages</li><li><b>It learns</b> — from your past replies, automatically</li><li><b>It answers</b> — you can watch, edit or take over anytime</li></ol>
      </div>`;
    return;
  }
  const byId = Object.fromEntries(learning.channels.map((c) => [c.id, c]));
  const busy = pages.some((p) => ['pending', 'running'].includes(p.history_status));
  ctx.view.innerHTML = `
    <div class="welcome">
      <div class="welcome-art ok">${icon('checkCircle')}</div>
      <h1>${params.connected ? `${num(params.connected)} connected — you're live` : "You're live"}</h1>
      <p class="lead-w">Your assistant is answering on ${pages.length} page${pages.length > 1 ? 's' : ''}. It ${busy ? 'is learning from your past replies right now and' : ''} keeps learning from every reply you or your team send.</p>
      ${params.problems ? `<div class="callout warn">${icon('alert')}<div>${esc(params.problems)}</div></div>` : ''}
      <div class="welcome-pages">${pages.map((p) => { const l = byId[p.id] || {}; const [ic, t] = STATUS[p.history_status] || STATUS.unavailable; return `<div class="wp"><span class="pf ${esc(p.platform)}">${esc(PL[p.platform])}</span>
        <b class="truncate">${esc(p.name || '')}</b><span class="hint">${icon(ic, 'sm')} ${esc(t)}${l.examples ? ` · ${num(l.examples)} replies learned` : ''}</span></div>`; }).join('')}</div>
      <div class="row" style="justify-content:center;gap:10px;margin-top:22px"><a class="btn primary lg" href="#chats">${icon('chat')}Open chats</a><a class="btn lg" href="#saleslab">${icon('flask')}Try it as a customer</a></div>
      <p class="hint mt">Optional: add products & prices in <a href="#catalog">Products</a> for exact order totals. ${manager ? `Add another page anytime: <a href="/api/oauth/meta/connect?kind=pages">Connect more</a>.` : ''}</p>
    </div>`;
  if (busy) setTimeout(() => { if (location.hash.startsWith('#welcome')) ctx.route(); }, 3000);
}

export async function learning(ctx) {
  const d = await api('/sales/learning');
  const manager = ['owner', 'admin'].includes(ctx.me.role);
  const SRC = { human: 'You replied', human_app: 'Replied in Facebook/Instagram', ai_edited: 'You corrected the AI', ai_approved: 'You approved the AI', ai_rejected: 'You discarded the AI draft', history: 'Past chat' };
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>What the AI learned</h1><p>Nothing to set up — the assistant learns by itself from every reply your page sends: in ChatPilot, in Facebook or Instagram, under post comments, and every time you edit or discard a draft.</p></div>
      ${manager ? `<div class="actions"><button class="btn" data-act="refresh">${icon('refresh')}Re-learn now</button></div>` : ''}</div>
    <div class="grid g4 mb">
      <div class="card stat ok"><div class="ic">${icon('sparkles')}</div><div class="l">Replies learned</div><div class="n">${num(d.total)}</div><div class="d">across ${d.channels.length} page${d.channels.length === 1 ? '' : 's'}</div></div>
      ${d.channels.slice(0, 3).map((c) => `<div class="card stat"><div class="ic">${icon('chat')}</div><div class="l truncate">${esc(c.name || PL[c.platform])}</div><div class="n">${num(c.examples)}</div><div class="d">${c.learned_at ? `updated ${ago(c.learned_at)}` : esc((STATUS[c.history_status] || STATUS.unavailable)[1])}</div></div>`).join('')}
    </div>
    ${d.channels.map((c) => { const p = c.profile; return `<div class="card mb"><div class="card-h"><span class="pf ${esc(c.platform)}">${esc(PL[c.platform])}</span><h3>${esc(c.name || '')}</h3><span class="spacer"></span>
      <span class="hint">${num(c.from_history)} from past chats · ${num(c.from_live)} live · ${num(c.corrections)} corrections</span></div>
      ${p ? `<p>${esc(p.summary)}</p>
        <div class="learn-grid">
          <div><h4>How it talks</h4><dl class="kv">${[['Language', p.style.languages], ['Tone', p.style.tone], ['Greeting', p.style.greeting], ['Closing', p.style.sign_off], ['Emojis', p.style.emoji], ['Length', p.style.length], ['Comments', p.style.comment_style]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
          <div><h4>Facts it uses</h4>${(p.facts || []).map((f) => `<div class="fact"><span>${esc(f.fact)}</span><span class="hint nowrap">${esc(f.last_seen || '')}</span>${manager ? `<button class="btn xs ghost" data-act="forget" data-f="${esc(f.fact)}" title="Remove — it will not be learned again">${icon('x', 'sm')}</button>` : ''}</div>`).join('') || '<p class="hint">None yet.</p>'}</div>
          <div><h4>Common questions</h4>${(p.faq || []).slice(0, 10).map((f) => `<div class="qa"><b>${esc(f.question)}</b><span>${esc(f.answer)}</span></div>`).join('') || '<p class="hint">None yet.</p>'}
            ${p.avoid?.length ? `<h4 class="mt">Never says</h4><ul class="hint" style="margin:0;padding-left:18px">${p.avoid.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
        </div>` : `<p class="hint">${c.examples ? 'Putting together what it learned…' : 'It will learn as soon as this page answers its first customers.'}</p>`}</div>`; }).join('') || `<div class="card">${empty('sparkles', 'Nothing learned yet', 'Connect a page — learning starts automatically.')}</div>`}
    <div class="card"><h3>Latest lessons</h3>${d.recent.map((x) => `<div class="lesson ${x.weight < 0 ? 'neg' : ''}"><div class="hint">${esc(SRC[x.source] || x.source)}${x.kind === 'comment' ? ' · comment' : ''}${x.outcome === 'ordered' ? ' · led to an order 🛒' : ''} · ${ago(x.happened_at)}</div>
      <div><b>Customer:</b> ${esc(x.question)}</div><div><b>${x.weight < 0 ? 'Not like this' : 'Answer'}:</b> ${esc(x.answer)}</div></div>`).join('') || '<p class="hint">Lessons appear here as your team answers customers.</p>'}</div>`;
  bind({
    refresh: async () => { await api('/sales/learning/refresh', { method: 'POST' }); toast('Re-learned from the latest replies'); ctx.route(); },
    forget: async (b) => { if (await confirmBox('Remove this fact?', 'The assistant stops using it and will not learn it again.', { ok: 'Remove' })) { await api('/sales/learning/forget', { method: 'POST', body: { fact: b.dataset.f } }); ctx.route(); } },
  }, ctx.view);
}
