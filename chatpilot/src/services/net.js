// Outbound network safety. Anything that connects to a user-supplied host (webhooks, website import,
// one-click unsubscribe, IMAP/SMTP servers) goes through here, so the server can never be used to reach
// internal networks or cloud metadata endpoints (SSRF), including via DNS rebinding.
import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';
import { config } from '../config.js';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff') || v.startsWith('64:ff9b');
}

/** Resolve a hostname and refuse if any address is private. Returns the first public address. */
export async function resolvePublic(hostname, { allowPrivate = false } = {}) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || /[^a-z0-9.\-:[\]]/.test(host)) throw new Error('Invalid host name');
  if (['localhost', 'metadata.google.internal'].includes(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    if (!allowPrivate) throw new Error('This host is not allowed');
  }
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIPv6(host) ? 6 : 4 }] : await dns.lookup(host, { all: true });
  if (!addrs.length) throw new Error('Host not found');
  if (!allowPrivate && addrs.some((a) => isPrivateIp(a.address))) throw new Error('This host resolves to a private network address and is not allowed');
  return addrs[0];
}

// undici dispatcher whose DNS lookup re-validates at connect time (defeats DNS rebinding between check and use).
const safeAgent = new Agent({
  connect: {
    lookup: (hostname, opts, cb) => {
      resolvePublic(hostname).then((a) => (opts?.all ? cb(null, [a]) : cb(null, a.address, a.family))).catch((e) => cb(e));
    },
  },
  headersTimeout: 15_000, bodyTimeout: 15_000,
});

/** fetch() for user-supplied URLs: https only, public hosts only, no redirects, size-capped body. */
export async function safeFetch(url, opts = {}, { maxBytes = 2_000_000 } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'https:') throw new Error('URL must use https');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed');
  if (u.port && !['443', '8443'].includes(u.port)) throw new Error('Only standard HTTPS ports are allowed');
  await resolvePublic(u.hostname);
  const res = await fetch(u, { ...opts, redirect: 'manual', dispatcher: safeAgent, signal: opts.signal || AbortSignal.timeout(15_000) });
  if (res.status >= 300 && res.status < 400) throw new Error('Redirects are not followed for security');
  const reader = res.body?.getReader();
  const chunks = []; let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { reader.cancel().catch(() => {}); throw new Error('Response too large'); }
      chunks.push(value);
    }
  }
  const body = Buffer.concat(chunks);
  return { ok: res.ok, status: res.status, headers: res.headers, text: () => body.toString('utf8'), body };
}

