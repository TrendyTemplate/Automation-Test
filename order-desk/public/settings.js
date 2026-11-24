// Settings panel and sign-up. Loaded by app.js.
export function initSettings({ $, el, api, json, badge, boot, embedded }) {
  const PLATFORM_NAMES = { shopify: 'Shopify', woocommerce: 'WooCommerce', quickbooks: 'QuickBooks Online', xero: 'Xero', csv: 'Spreadsheet catalog' };
  const msg = (text, cls = 'muted') => { $('settings-msg').className = cls; $('settings-msg').textContent = text; };

  function renderSettings(me) {
    const c = me.connection || {};
    const where = c.site_url || me.shop_domain;
    $('conn-status').textContent = `${PLATFORM_NAMES[me.platform] || me.platform}: ${c.connected ? `connected${where ? ` (${where})` : ''}` : 'not connected yet'}`;
    $('woo-form').hidden = me.platform !== 'woocommerce';
    if (c.site_url) $('woo-url').value = c.site_url;
    const oauth = ['quickbooks', 'xero'].includes(me.platform);
    $('oauth-connect').hidden = !oauth || embedded;
    if (oauth) {
      $('oauth-connect').href = `/connect/${me.platform}/start`;
      $('oauth-connect').textContent = `${c.connected ? 'Reconnect' : 'Connect'} ${PLATFORM_NAMES[me.platform]}`;
    }

    const p = me.plan;
    $('plan-status').textContent = `${p.name} plan: ${p.used} of ${p.orders} orders used this month.`;
    const planButtons = me.platform === 'shopify'
      ? me.plans.filter((x) => x.id !== p.id).map((x) => {
        const b = el('button', { className: 'ghost', textContent: x.price ? `${x.name}: $${x.price}/mo, ${x.orders} orders` : 'Switch to Free' });
        b.onclick = async () => {
          try {
            const r = await api('/api/billing/subscribe', json('POST', { plan: x.id }));
            if (r.confirmation_url) window.open(r.confirmation_url, '_top'); else boot();
          } catch (e) { msg(e.message, 'error'); }
        };
        return b;
      })
      : [el('span', { className: 'muted', textContent: 'To change plan, contact support.' })];
    $('plan-buttons').replaceChildren(...planButtons);

    const st = me.settings;
    $('s-email').value = st.notify_email;
    $('s-slack').value = '';
    $('s-slack').placeholder = st.slack_webhook_url ? 'Saved. Paste a new URL to replace it.' : 'https://hooks.slack.com/services/…';
    $('s-auto').checked = st.auto_create;
    $('s-confirm').checked = st.confirm_buyer;
    $('s-message').value = st.confirm_message;
    $('s-mail-warning').hidden = st.email_enabled;

    $('mailboxes').replaceChildren(...me.mailboxes.map((m) => {
      const del = el('button', { className: 'ghost danger', textContent: 'Remove' });
      del.onclick = async () => {
        if (!window.confirm(`Stop reading ${m.username}?`)) return;
        await api(`/api/mailboxes/${m.id}`, { method: 'DELETE' });
        boot();
      };
      const state = m.last_error ? badge(m.last_error, 'bad') : badge(m.last_polled_at ? `checked ${m.last_polled_at}` : 'waiting', 'ok');
      return el('tr', {}, el('td', { textContent: `${m.username} · ${m.host} · ${m.folder}` }), el('td', {}, state), el('td', {}, del));
    }));

    $('failures-block').hidden = !me.recent_failures.length;
    $('failures').replaceChildren(...me.recent_failures.map((f) => el('li', { textContent: `${f.created_at} · ${f.type}: ${f.error}` })));
    if (new URLSearchParams(location.search).get('connected')) { $('settings').open = true; msg('Connected. Your catalog is syncing in the background.', 'ok'); }
    if (!c.connected) $('settings').open = true;
  }

  $('settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = { notify_email: $('s-email').value.trim(), auto_create: $('s-auto').checked, confirm_buyer: $('s-confirm').checked, confirm_message: $('s-message').value };
    if ($('s-slack').value.trim()) body.slack_webhook_url = $('s-slack').value.trim();
    try { await api('/api/settings', json('PATCH', body)); msg('Saved.', 'ok'); boot(); } catch (err) { msg(err.message, 'error'); }
  };

  $('woo-form').onsubmit = async (e) => {
    e.preventDefault();
    msg('Connecting…');
    try {
      await api('/api/connect/woocommerce', json('POST', { site_url: $('woo-url').value.trim(), consumer_key: $('woo-key').value.trim(), consumer_secret: $('woo-secret').value.trim() }));
      $('woo-key').value = '';
      $('woo-secret').value = '';
      msg('Connected. Your catalog is syncing in the background.', 'ok');
      boot();
    } catch (err) { msg(err.message, 'error'); }
  };

  $('mailbox-form').onsubmit = async (e) => {
    e.preventDefault();
    msg('Checking the mailbox…');
    try {
      await api('/api/mailboxes', json('POST', {
        host: $('mb-host').value.trim(), port: Number($('mb-port').value), username: $('mb-user').value.trim(), password: $('mb-pass').value, folder: $('mb-folder').value.trim(),
      }));
      $('mb-pass').value = '';
      msg('Mailbox connected. New mail is checked every minute.', 'ok');
      boot();
    } catch (err) { msg(err.message, 'error'); }
  };

  $('signup-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/signup', json('POST', { store_name: $('su-name').value.trim(), platform: $('su-platform').value, currency: $('su-currency').value.trim() || 'USD' }));
      const go = el('button', { textContent: 'Continue' });
      go.onclick = () => boot();
      $('signup-msg').className = '';
      $('signup-msg').replaceChildren('Account created. Save this API key now, it is shown only once:', el('code', { className: 'secret', textContent: r.api_key }), go);
    } catch (err) { $('signup-msg').className = 'error'; $('signup-msg').textContent = err.message; }
  };

  return renderSettings;
}
