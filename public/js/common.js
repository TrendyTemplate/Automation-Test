export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = (d) => (d ? new Date(/Z$|T/.test(d) ? d : `${d.replace(' ', 'T')}Z`).toLocaleString() : '—');
export const fmtDay = (d) => (d ? new Date(/Z$|T/.test(d) ? d : `${d.replace(' ', 'T')}Z`).toLocaleDateString() : '—');
export const money = (v, cur = 'usd') => `${cur.toUpperCase() === 'USD' ? '$' : `${cur.toUpperCase()} `}${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const badge = (v, cls) => (v || v === 0 ? `<span class="badge ${esc(cls || v)}">${esc(String(v).replace(/_/g, ' '))}</span>` : '');
export const formData = (form) => {
  const d = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type=checkbox][name]').forEach((c) => { d[c.name] = c.checked; });
  return d;
};

export function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = `toast ${isErr ? 'err' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('Not signed in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Bind handlers declared with data-act="name" (CSP forbids inline handlers). */
export function bind(handlers, root) {
  root.querySelectorAll('[data-act]').forEach((el) => {
    const fn = handlers[el.dataset.act];
    if (!fn) return;
    const evt = el.tagName === 'FORM' ? 'submit' : el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type === 'checkbox') ? 'change' : 'click';
    el.addEventListener(evt, async (e) => {
      if (evt !== 'change') e.preventDefault();
      e.stopPropagation();
      const btn = el.tagName === 'FORM' ? el.querySelector('button:not([type=button])') : el.tagName === 'BUTTON' ? el : null;
      if (btn) btn.disabled = true;
      try { await fn(el, e); } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
    });
  });
}

/** Tiny dependency-free bar chart: rows [{label, value}] */
export function bars(rows, { fmt = (v) => v, height = 140 } = {}) {
  if (!rows.length) return '<p class="hint">No data yet.</p>';
  const max = Math.max(1, ...rows.map((r) => r.value || 0));
  return `<div class="chart" style="height:${height}px">${rows.map((r) => `<div class="col" title="${esc(r.label)}: ${esc(fmt(r.value))}">
    <i style="height:${Math.max(2, ((r.value || 0) / max) * 100)}%"></i><span>${esc(r.short ?? r.label)}</span></div>`).join('')}</div>`;
}

export function modal(html, onBind) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `<div class="modal card"><button class="btn sm modal-x" type="button" aria-label="Close">✕</button>${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('.modal-x').addEventListener('click', close);
  onBind?.(wrap.querySelector('.modal'), close);
  return close;
}

export function csvDownload(path) { location.href = `/api${path}`; }
