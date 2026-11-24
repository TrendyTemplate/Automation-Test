// Outbound network safety for user-supplied hosts (IMAP servers, Slack webhooks, WooCommerce sites):
// public addresses only, re-checked at connect time (defeats DNS rebinding), https only for HTTP.
import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';

const allowPrivate = () => process.env.ALLOW_PRIVATE_HOSTS === 'true'; // local testing only — never on a public server

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

export async function resolvePublic(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || /[^a-z0-9.\-:[\]]/.test(host)) throw new Error('Invalid host name');
  const priv = allowPrivate();
  if (!priv && (['localhost', 'metadata.google.internal'].includes(host) || host.endsWith('.local') || host.endsWith('.internal'))) {
    throw new Error('This host is not allowed');
  }
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIPv6(host) ? 6 : 4 }] : await dns.lookup(host, { all: true });
  if (!addrs.length) throw new Error('Host not found');
  if (!priv && addrs.some((a) => isPrivateIp(a.address))) throw new Error('This host resolves to a private network address and is not allowed');
  return addrs[0];
}

const safeAgent = new Agent({
  connect: {
    lookup: (hostname, opts, cb) => {
      resolvePublic(hostname).then((a) => (opts?.all ? cb(null, [a]) : cb(null, a.address, a.family))).catch((e) => cb(e));
    },
  },
  headersTimeout: 20_000, bodyTimeout: 30_000,
});

/** fetch() for user-supplied URLs: https only (http allowed only in private-host test mode), public hosts, no redirects. */
export async function safeFetch(url, opts = {}) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'https:' && !(allowPrivate() && u.protocol === 'http:')) throw new Error('URL must use https');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed');
  await resolvePublic(u.hostname);
  const res = await fetch(u, { ...opts, redirect: 'manual', dispatcher: safeAgent, signal: opts.signal || AbortSignal.timeout(30_000) });
  if (res.status >= 300 && res.status < 400) throw new Error('Redirects are not followed for security');
  return res;
}

const MAIL_PORTS = new Set([143, 993, 1143, 1993]);
export async function resolveMailHost(host, port) {
  const n = Number(port);
  if (!MAIL_PORTS.has(n) && !(allowPrivate() && n >= 1024 && n <= 65535)) throw new Error(`Port ${port} is not an IMAP port`);
  const a = await resolvePublic(host);
  return { ip: a.address, servername: net.isIP(host) ? undefined : String(host).toLowerCase() };
}
