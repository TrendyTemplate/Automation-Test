# Security architecture

ChatPilot AI holds the access tokens of shops' Facebook Pages, Instagram accounts and WhatsApp numbers, and their customers' chats, so security is designed in layers. Each control below is covered by automated tests (`test/security.test.js`, `test/sales.test.js`, `test/api.test.js`, `test/unit.test.js`, `test/ui.test.js`).

## Threat model (what we defend against)
| Threat | Real-world precedent | Controls |
|---|---|---|
| Database / backup theft | many SaaS breaches | Envelope encryption of channel tokens, app secrets and chat messages; master key outside the DB; crypto-shredding |
| Stolen OAuth tokens used at scale | Salesloft Drift (2025) | Per-workspace keys + AAD, least-privilege scopes, revoke on disconnect, emergency lockdown, refresh-token rotation honoured |
| Prompt injection turning the AI against its owner | EchoLeak (M365 Copilot), ShadowLeak (ChatGPT agent) | AI has no tools and no network; recipients fixed by code; injection detector; outbound guard; human review |
| AI inventing prices/policies | Air Canada chatbot ruling | Catalog grounding, server-computed order totals, deterministic price/link/email checks; unsupported claims held |
| Account takeover | credential stuffing | bcrypt, password policy, progressive lockout, per-IP rate limit, TOTP 2FA, new-device alerts, session revocation |
| Insider / support abuse | Unroll.me-style data misuse | Impersonation only with customer consent + reason, logged and visible to the customer; admins require 2FA in production |
| SSRF into internal networks | cloud metadata attacks | DNS-pinned safe fetch, private-range blocking, no redirects; Meta Graph API is the only outbound messaging host |
| CSRF / XSS / clickjacking | — | SameSite cookies + Fetch-Metadata/Origin checks; strict CSP (no inline script, no third parties); all output escaped; frame-ancestors none |
| Forged webhooks | spoofed customer messages | Every Meta webhook verified with X-Hub-Signature-256 (HMAC-SHA256 of the raw body, constant-time compare) against the channel's app secret |

## Encryption
- **Algorithm:** AES-256-GCM, 96-bit random IV, authenticated additional data (AAD).
- **Envelope:** each workspace has a random 256-bit data key (DEK), stored only wrapped by the master key (`ENCRYPTION_KEY`). DEKs are cached in memory (bounded LRU).
- **Encrypted with the DEK:** channel access tokens, Meta app secrets, every chat message (customer, AI and staff).
- **Field binding:** AAD = `ws:<id>:<table.column>` — a ciphertext copied to another row type or workspace fails to decrypt.
- **Encrypted with the master key:** DEKs, TOTP secrets, platform secrets in Settings (Stripe, Anthropic, OAuth, SMTP, Telegram).
- **Crypto-shredding:** deleting a workspace deletes its wrapped DEK.
- **Key rotation:** set the new key in `ENCRYPTION_KEY`, increment `ENCRYPTION_KEY_VERSION`, move the old key to `ENCRYPTION_KEYS_OLD="1:<hex>"`, restart, then Admin → Security center → "Re-encrypt with current key". Remove the old key afterwards.
- **Migration:** on boot, any legacy plaintext or master-key ciphertext is moved into workspace keys (idempotent).

## Authentication & sessions
- Passwords: bcrypt (cost 12), ≥10 characters, common-password and simplicity checks, cannot contain the email name.
- Sessions: random 256-bit tokens; only SHA-256 hashes stored; 30-day lifetime, 14-day idle timeout; listed and revocable per device; `__Host-` cookie in production (Secure, HttpOnly, SameSite=Lax, Path=/).
- Password change / reset / 2FA enable → other sessions revoked. Suspension → all sessions revoked.
- Lockout: 5 failures → 15 min, doubling up to 24 h; constant-time responses for unknown users; identical answers for forgot-password.
- 2FA: RFC 6238 TOTP (±1 step), required for platform admins in production; also enforced after Google/Microsoft sign-in.
- Microsoft sign-in links only by immutable ID (guards against the "nOAuth" email-claim issue); Google requires `email_verified`.

## Authorization
- Every data query is scoped by `workspace_id` from the session — never from the request body. A tenant-isolation sweep test tries every object endpoint across tenants.
- Roles: owner / admin / member. API keys (hashed) act as workspace admin on `/api/v1` only; refused on account, billing, OAuth and admin routes.
- Impersonation: requires the customer's time-limited support-access grant and a reason; session lasts 1 hour, has no admin powers, cannot change password or delete the account; logged in both audit log and the customer's security log.

## AI safety
- Privacy Shield masks card numbers, IBANs, passwords/OTPs before content leaves the server.
- The model has no tools, no browsing, no ability to choose recipients. Replies always go to the original sender (Reply-To if present, with BEC warning on mismatch).
- Structured output with `facts_used` and `unsupported_claims`; deterministic outbound guard checks amounts, links, email addresses, secrets, Luhn-valid card numbers, "never say" phrases.
- Injection detector (instruction patterns, zero-width characters, encoded blobs) → message flagged, reply held.
- Autopilot requires: confidence ≥ threshold, no guard problems, not VIP, not sensitive topic, category allowed ("earned autopilot"), business hours, ≤1 auto-reply per sender per 24 h; then a human-like delay with undo.
- AI transparency log records every AI access (purpose, tokens, redaction count). Attachments are passed in memory only, never stored.

## Network
- Outbound HTTP for user-supplied URLs (`safeFetch`): https only, standard ports, no credentials in URL, no redirects, size cap, and DNS resolution validated at connect time (undici dispatcher) — defeats DNS rebinding.
- Meta's 24-hour messaging window is enforced in code for AI, human and follow-up messages; Meta webhook retries are de-duplicated by message id.
- Webhooks are signed: `X-ChatPilot-Signature: v1=HMAC_SHA256(secret, timestamp + "." + body)`.

## HTTP hardening
Helmet with strict CSP (`script-src 'self'`, no inline scripts, no third-party fonts/scripts), HSTS (2 years, preload) in production, `frame-ancestors 'none'`, COOP same-origin, Permissions-Policy, `Cache-Control: no-store` on all API responses, `x-powered-by` removed, JSON body limit 1 MB, generic error messages in production (bodies never logged).

## Operational checklist
- Run behind HTTPS; set `NODE_ENV=production`, strong `JWT_SECRET`, `ENCRYPTION_KEY` (back it up separately from DB backups).
- Enable 2FA on every admin account; optionally restrict the admin panel by IP (Admin → Settings → Security).
- Daily encrypted off-site backups of `data/`; test restores.
- Keep dependencies updated (`npm audit --omit=dev` currently reports 0 vulnerabilities).
- Before going public, complete Meta App Review for `pages_messaging`, `instagram_manage_messages` and `whatsapp_business_messaging`, and Business Verification.
- Consider a third-party penetration test before large launches.
