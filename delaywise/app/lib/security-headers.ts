/**
 * S2: browser security headers for every response. Embedded pages keep the
 * Content-Security-Policy frame-ancestors that Shopify's helper sets (the
 * admin must be able to frame the app); other pages can't be framed at all.
 */
export function applySecurityHeaders(headers: Headers, production = process.env.NODE_ENV === "production"): Headers {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  }
  if (production) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return headers;
}

/** JSON response with security headers and no caching (API endpoints). */
export function secureJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = applySecurityHeaders(new Headers(init.headers));
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}
