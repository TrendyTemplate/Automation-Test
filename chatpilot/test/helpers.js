// Shared test utilities: HTTP client with cookie jar and a fake Anthropic API.
import http from 'node:http';

export const PW = 'Correct-Horse-Battery-91';

export function client(base) {
  const c = { cookie: '' };
  c.call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(c.cookie ? { cookie: c.cookie } : {}), ...headers },
      body: body === undefined || body === null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    for (const sc of res.headers.getSetCookie?.() || []) {
      if (/^(__Host-)?mp_session=/.test(sc)) c.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  c.signup = async (email, extra = {}) => {
    const r = await c.call('POST', '/api/auth/signup', { email, password: PW, name: email.split('@')[0], ...extra });
    if (r.status !== 200) throw new Error(`signup failed: ${r.status} ${r.text}`);
    return r;
  };
  return c;
}

/** Local fake of the Anthropic Messages API. `reply(body)` returns the JSON object the model "answers". */
export async function fakeAnthropic(reply) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      requests.push({ url: req.url, headers: req.headers, body: json });
      const out = reply(json);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: json.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, { timeout = 8000, every = 100 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for condition');
    await sleep(every);
  }
}
