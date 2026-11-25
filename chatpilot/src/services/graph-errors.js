// Meta Graph API errors, sorted into what to do about them.
// https://developers.facebook.com/docs/graph-api/guides/error-handling · Messenger & WhatsApp error code lists.
export class GraphError extends Error {
  constructor(err = {}, status = 0) {
    super(`${err.error_user_msg || err.message || `Graph API HTTP ${status}`}${err.code ? ` (code ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''})` : ''}`);
    this.code = Number(err.code) || 0;
    this.subcode = Number(err.error_subcode) || 0;
    this.status = status;
    this.fbtrace = err.fbtrace_id || null;
    this.kind = classify(this.code, this.subcode, status);
  }
}

const RATE = new Set([4, 17, 32, 613, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80014, 130429, 131056]);
const TOKEN_SUB = new Set([458, 459, 460, 463, 464, 467, 492]);
const PERMANENT_WA = new Set([131026, 131048, 131049, 131051, 131052, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010]);

/**
 * rate_limit  → slow down, retry later
 * token       → the Page / WhatsApp token stopped working: reconnect needed
 * window      → outside the messaging window: needs HUMAN_AGENT tag or a template
 * unavailable → the person can't be messaged (blocked, deleted): never retry
 * permanent   → bad request / policy: don't retry
 * transient   → network / Meta outage: retry later
 */
export function classify(code, subcode = 0, status = 0) {
  if (RATE.has(code)) return 'rate_limit';
  if (code === 190 || code === 102 || TOKEN_SUB.has(subcode) || (code === 10 && subcode === 0 && status === 403)) return 'token';
  if (subcode === 2018278 || subcode === 2534022 || code === 131047 || (code === 10 && subcode === 2018065)) return 'window';
  if (code === 551 || subcode === 1545041 || subcode === 2018001 || code === 131026) return 'unavailable';
  if (PERMANENT_WA.has(code) || code === 100 || code === 200 || code === 368 || code === 10) return 'permanent';
  if (!code && (status >= 500 || status === 0)) return 'transient';
  if (code === 1 || code === 2 || code === 131000 || code === 131016) return 'transient';
  return 'permanent';
}
export const kindOf = (e) => e?.kind || (/timeout|aborted|ECONNRESET|fetch failed/i.test(String(e?.message)) ? 'transient' : 'permanent');
export const retryable = (e) => ['rate_limit', 'transient'].includes(kindOf(e));
