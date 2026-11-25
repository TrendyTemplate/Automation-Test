// Live updates for the inbox: a tiny in-process event bus + Server-Sent Events per workspace.
const subs = new Map(); // wsId -> Set(res)

export function subscribe(wsId, res) {
  if (!subs.has(wsId)) subs.set(wsId, new Set());
  subs.get(wsId).add(res);
  return () => { subs.get(wsId)?.delete(res); if (!subs.get(wsId)?.size) subs.delete(wsId); };
}
/** Tell every open dashboard of a workspace that something changed (no message content is sent, only ids). */
export function emit(wsId, type, data = {}) {
  const set = subs.get(wsId);
  if (!set?.size) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { try { res.write(payload); } catch { /* closed */ } }
}
export const listeners = (wsId) => subs.get(wsId)?.size || 0;
