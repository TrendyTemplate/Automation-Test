// In-memory fixed-window rate limiter (per process). Put a shared store (Redis) behind it when scaling out.
export function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many requests, slow down' }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweep.unref?.();
  return (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === 'true') return next();
    const k = key(req);
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset <= now) { h = { count: 0, reset: now + windowMs }; hits.set(k, h); }
    h.count += 1;
    res.set('RateLimit-Remaining', String(Math.max(0, max - h.count)));
    if (h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
