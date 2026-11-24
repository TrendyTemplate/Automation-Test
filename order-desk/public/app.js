const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) n.append(k);
  return n;
};

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  if (res.status === 401 && path !== '/session') { showLogin(); throw new Error('Signed out'); }
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(body?.error || `Error ${res.status}`);
  return body;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const FLAG_TEXT = {
  no_match: ['No product found', 'bad'], ambiguous_match: ['Several similar products', 'warn'], price_mismatch: ['Price differs from catalog', 'warn'],
  low_stock: ['Not enough stock', 'warn'], converted_from_case: ['Converted cases → units', 'ok'], converted_from_dozen: ['Converted dozens → units', 'ok'],
  unit_unknown_case_size: ['Ordered in cases: set case size', 'bad'], fractional_quantity: ['Fractional quantity rounded', 'warn'],
  duplicate_sku_in_catalog: ['SKU used by several products', 'warn'], duplicate_po: ['Same PO number already received', 'bad'],
  unknown_customer: ['Buyer not found in store', 'warn'], suspicious_instructions: ['Document contains instructions to the system', 'bad'],
  catalog_empty: ['Catalog is empty: sync it first', 'bad'], customer_lookup_failed: ['Could not look up buyer', 'warn'],
};
const STATUS = { needs_review: ['Needs review', 'warn'], ready: ['Ready', 'ok'], created: ['Created', 'ok'], failed: ['Failed', 'bad'], rejected: ['Rejected', 'muted'], creating: ['Creating…', 'muted'] };
const badge = (text, cls) => el('span', { className: `badge ${cls}`, textContent: text });
const flagBadges = (flags) => flags.map((f) => badge(...(FLAG_TEXT[f] || [f, 'warn'])));

let status = 'needs_review';
let current = null;

function showLogin() { $('login').hidden = false; $('app').hidden = true; $('logout').hidden = true; }

async function boot() {
  try {
    const me = await api('/api/me');
    $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false;
    $('store').textContent = `${me.name} · ${me.platform}`;
    $('inbound').textContent = me.inbound_url;
    $('catalog').textContent = `${me.catalog_count} products${me.catalog_synced_at ? ` · synced ${me.catalog_synced_at}` : ''}`;
    $('sync').textContent = me.platform === 'csv' ? 'Upload catalog CSV' : 'Sync catalog';
    $('sync').dataset.platform = me.platform;
    await Promise.all([loadList(), loadStats()]);
  } catch { /* showLogin already called on 401 */ }
}

async function loadStats() {
  const s = await api('/api/stats');
  const tile = (label, value) => el('div', {}, el('b', { textContent: value }), label);
  $('stats').replaceChildren(
    tile('waiting for review', s.by_status.needs_review || 0),
    tile('orders created', s.by_status.created || 0),
    tile('lines matched automatically', s.auto_match_rate == null ? '–' : `${s.auto_match_rate}%`),
    tile('buyer codes learned', s.learned_codes),
  );
}

async function loadList() {
  const rows = await api(`/api/pos${status ? `?status=${status}` : ''}`);
  $('empty').hidden = rows.length > 0;
  $('pos').replaceChildren(...rows.map((p) => {
    const tr = el('tr', {},
      el('td', { textContent: p.po_number || `#${p.id}` }),
      el('td', { textContent: p.company_name || p.customer_name || p.sender_email || '—' }),
      el('td', { textContent: p.line_count }),
      el('td', {}, badge(...(STATUS[p.status] || [p.status, 'muted']))),
      el('td', { textContent: p.created_at }));
    tr.onclick = () => openPo(p.id);
    return tr;
  }));
}

async function openPo(id) {
  const po = await api(`/api/pos/${id}`);
  current = po;
  $('detail').hidden = false;
  $('d-title').textContent = `PO ${po.po_number || `#${po.id}`} — ${po.company_name || po.customer_name || po.buyer_email || 'unknown buyer'}`;
  const ship = po.ship_to || {};
  $('d-meta').textContent = [po.source_filename, po.buyer_email, po.requested_ship_date && `ship by ${po.requested_ship_date}`,
    [ship.address1, ship.city, ship.country_code].filter(Boolean).join(', '), po.notes].filter(Boolean).join(' · ');
  $('d-flags').replaceChildren(...flagBadges(po.flags));
  const closed = ['created', 'rejected', 'creating'].includes(po.status);
  $('d-approve').hidden = closed; $('d-reject').hidden = closed;
  $('d-ack').hidden = closed || !po.flags.some((f) => f !== 'unknown_customer');
  $('d-approve').textContent = po.status === 'ready' ? 'Create order' : 'Create order anyway';
  $('d-msg').replaceChildren();
  if (po.order_url) $('d-msg').append('Order ', el('a', { href: po.order_url, target: '_blank', rel: 'noopener', textContent: po.order_name }), ' created.');
  else if (po.order_name) $('d-msg').textContent = `Order ${po.order_name} created.`;
  if (po.error) $('d-msg').append(el('span', { className: 'error', textContent: po.error }));

  $('d-lines').replaceChildren(...po.lines.map((l) => {
    const product = el('input', { value: l.matched_label ? `${l.matched_label}${l.sku ? ` [${l.sku}]` : ''}` : '', placeholder: 'Search SKU or name…', disabled: closed });
    product.setAttribute('list', 'catalog-options');
    product.oninput = () => searchCatalog(product.value);
    product.onchange = async () => {
      const opt = [...$('catalog-options').options].find((o) => o.value === product.value);
      if (!opt) return;
      await saveLine(l.id, { external_id: opt.dataset.id });
    };
    const qty = el('input', { className: 'qty', type: 'number', min: 0, step: 1, value: l.final_quantity ?? '', disabled: closed });
    qty.onchange = () => saveLine(l.id, { quantity: Number(qty.value) });
    const conf = l.corrected ? badge('Checked', 'ok') : l.confidence >= 0.9 ? badge(`${l.match_method} ${Math.round(l.confidence * 100)}%`, 'ok')
      : l.matched_external_id ? badge(`${l.match_method} ${Math.round(l.confidence * 100)}%`, 'warn') : badge('Pick product', 'bad');
    const onPo = el('td', {}, el('div', { textContent: l.raw_description || '' }), el('div', { className: 'muted', textContent: [l.raw_code, l.unit_price != null && `@ ${l.unit_price}`].filter(Boolean).join(' ') }));
    return el('tr', {},
      el('td', { textContent: l.line_no }),
      onPo,
      el('td', { textContent: `${l.quantity} ${l.unit || ''}` }),
      el('td', {}, product, ...(l.candidates.length && !l.matched_external_id ? [el('div', { className: 'muted', textContent: `Suggestions: ${l.candidates.map((c) => c.title).join(', ')}` })] : [])),
      el('td', {}, qty),
      el('td', {}, conf, ...flagBadges(l.flags)));
  }));
  $('detail').scrollIntoView({ behavior: 'smooth' });
}

let searchTimer;
function searchCatalog(q) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const items = await api(`/api/catalog?q=${encodeURIComponent(q)}`);
    $('catalog-options').replaceChildren(...items.map((i) => {
      const o = el('option', { value: `${i.title}${i.sku ? ` [${i.sku}]` : ''}` });
      o.dataset.id = i.external_id;
      return o;
    }));
  }, 200);
}

async function saveLine(lineId, body) {
  try {
    await api(`/api/pos/${current.id}/lines/${lineId}`, json('PATCH', body));
    await Promise.all([openPo(current.id), loadList()]);
  } catch (e) { $('d-msg').textContent = e.message; }
}

async function action(path, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  for (const b of ['d-approve', 'd-reject', 'd-ack']) $(b).disabled = true;
  try {
    await api(`/api/pos/${current.id}/${path}`, { method: 'POST' });
    await Promise.all([openPo(current.id), loadList(), loadStats()]);
  } catch (e) { $('d-msg').textContent = e.message; } finally {
    for (const b of ['d-approve', 'd-reject', 'd-ack']) $(b).disabled = false;
  }
}

$('d-approve').onclick = () => action('approve', current.status === 'ready' ? null : 'Some lines still have warnings. Create the order anyway?');
$('d-reject').onclick = () => action('reject', 'Reject this purchase order?');
$('d-ack').onclick = () => action('acknowledge');

$('tabs').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  status = b.dataset.status;
  for (const t of $('tabs').children) t.classList.toggle('active', t === b);
  loadList();
};

$('upload').onchange = async () => {
  const f = $('upload').files[0];
  if (!f) return;
  $('upload-msg').textContent = `Reading ${f.name}…`;
  try {
    const r = await api('/api/pos', { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name) }, body: f });
    $('upload-msg').textContent = 'Done.';
    await Promise.all([loadList(), loadStats()]);
    openPo(r.id);
  } catch (e) { $('upload-msg').textContent = e.message; } finally { $('upload').value = ''; }
};

$('sync').onclick = async () => {
  if ($('sync').dataset.platform === 'csv') {
    const input = el('input', { type: 'file', accept: '.csv' });
    input.onchange = async () => {
      try { await api('/api/catalog/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await input.files[0].text() }); boot(); } catch (e) { $('upload-msg').textContent = e.message; }
    };
    return input.click();
  }
  $('sync').disabled = true;
  try { await api('/api/catalog/sync', { method: 'POST' }); await boot(); } catch (e) { $('upload-msg').textContent = e.message; } finally { $('sync').disabled = false; }
};

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  try { await api('/session', json('POST', { api_key: $('api-key').value })); $('login-error').textContent = ''; boot(); } catch (err) { $('login-error').textContent = err.message; }
};
$('logout').onclick = async () => { await fetch('/session/logout', { method: 'POST' }); showLogin(); };

boot();
