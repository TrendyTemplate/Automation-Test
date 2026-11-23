import { Session } from "@shopify/shopify-app-react-router/server";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { decryptSecret, encryptionAvailable, encryptSecret } from "../lib/crypto";

/**
 * S1: wraps the template's Prisma session storage so Shopify access and
 * refresh tokens are encrypted at rest (AES-256-GCM, bound to the shop).
 * A leaked database file then doesn't leak working store credentials.
 *
 * Tokens written before encryption was enabled are still readable and are
 * re-encrypted the next time the session is stored.
 */
const PREFIX = "v1.";

function protect(value: string | undefined, shop: string): string | undefined {
  if (!value || value.startsWith(PREFIX) || !encryptionAvailable()) return value;
  return encryptSecret(value, `session:${shop}`);
}

function reveal(value: string | undefined, shop: string): string | undefined {
  if (!value || !value.startsWith(PREFIX)) return value;
  const plain = decryptSecret(value, `session:${shop}`);
  // An unreadable token is treated as missing, which makes Shopify re-authenticate.
  return plain ?? undefined;
}

function transform(session: Session, fn: (v: string | undefined, shop: string) => string | undefined): Session {
  const copy = new Session(session.toObject());
  copy.accessToken = fn(session.accessToken, session.shop);
  copy.refreshToken = fn(session.refreshToken, session.shop);
  return copy;
}

export class EncryptedSessionStorage implements SessionStorage {
  constructor(private readonly inner: SessionStorage) {}

  storeSession(session: Session): Promise<boolean> {
    return this.inner.storeSession(transform(session, protect));
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const session = await this.inner.loadSession(id);
    if (!session) return undefined;
    const plain = transform(session, reveal);
    return plain.accessToken ? plain : undefined;
  }

  deleteSession(id: string): Promise<boolean> {
    return this.inner.deleteSession(id);
  }

  deleteSessions(ids: string[]): Promise<boolean> {
    return this.inner.deleteSessions(ids);
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const sessions = await this.inner.findSessionsByShop(shop);
    return sessions.map((s) => transform(s, reveal)).filter((s) => Boolean(s.accessToken));
  }
}
