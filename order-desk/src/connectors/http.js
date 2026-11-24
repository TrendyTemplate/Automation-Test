// Outbound HTTP used by connectors. Swappable in tests.
//   http.fetch      — fixed, trusted API hosts (Intuit, Xero)
//   http.safeFetch  — merchant-supplied URLs (WooCommerce sites): public hosts only, no redirects
import { safeFetch } from '../net.js';

export const http = {
  fetch: (url, opts) => globalThis.fetch(url, { ...opts, signal: opts?.signal || AbortSignal.timeout(30_000) }),
  safeFetch: (url, opts) => safeFetch(url, opts),
};

export async function readJson(res, what) {
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = body?.Fault?.Error?.map((e) => e.Detail || e.Message).join('; ') // QuickBooks
      || body?.Elements?.flatMap((e) => e.ValidationErrors || []).map((e) => e.Message).join('; ') // Xero
      || body?.message || body?.Detail || text.slice(0, 200);
    const err = new Error(`${what} error ${res.status}${detail ? `: ${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return body;
}
