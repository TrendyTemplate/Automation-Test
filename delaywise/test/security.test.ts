import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Session } from "@shopify/shopify-app-react-router/server";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import db from "../app/db.server";
import { EncryptedSessionStorage } from "../app/services/encrypted-session-storage.server";
import { configProblems, assertProductionConfig } from "../app/services/config.server";
import { applySecurityHeaders } from "../app/lib/security-headers";
import { actorFrom, audit, changedKeys, firstDelivery, recentAudit } from "../app/services/audit.server";

class MemoryStorage implements SessionStorage {
  rows = new Map<string, Session>();
  async storeSession(s: Session) { this.rows.set(s.id, new Session(s.toObject())); return true; }
  async loadSession(id: string) { const s = this.rows.get(id); return s ? new Session(s.toObject()) : undefined; }
  async deleteSession(id: string) { return this.rows.delete(id); }
  async deleteSessions(ids: string[]) { ids.forEach((i) => this.rows.delete(i)); return true; }
  async findSessionsByShop(shop: string) { return [...this.rows.values()].filter((s) => s.shop === shop); }
}

const session = () => new Session({ id: "offline_a.myshopify.com", shop: "a.myshopify.com", state: "x", isOnline: false, accessToken: "shpat_secret_token", refreshToken: "shprt_refresh" });

describe("S1 encrypted session storage", () => {
  afterEach(() => { delete process.env.APP_ENCRYPTION_KEY; });

  it("stores tokens encrypted and returns them decrypted", async () => {
    process.env.APP_ENCRYPTION_KEY = "33".repeat(32);
    const inner = new MemoryStorage();
    const store = new EncryptedSessionStorage(inner);
    await store.storeSession(session());
    const raw = inner.rows.get("offline_a.myshopify.com")!;
    expect(raw.accessToken).not.toContain("shpat_");
    expect(raw.refreshToken).not.toContain("shprt_");
    expect((await store.loadSession("offline_a.myshopify.com"))?.accessToken).toBe("shpat_secret_token");
    expect((await store.findSessionsByShop("a.myshopify.com"))[0].refreshToken).toBe("shprt_refresh");
  });

  it("still reads tokens stored before encryption, and treats unreadable ones as missing", async () => {
    const inner = new MemoryStorage();
    await inner.storeSession(session());
    process.env.APP_ENCRYPTION_KEY = "33".repeat(32);
    const store = new EncryptedSessionStorage(inner);
    expect((await store.loadSession("offline_a.myshopify.com"))?.accessToken).toBe("shpat_secret_token");
    await store.storeSession(session());
    process.env.APP_ENCRYPTION_KEY = "44".repeat(32); // key rotated without migration
    expect(await store.loadSession("offline_a.myshopify.com")).toBeUndefined();
  });
});

describe("S8 production config", () => {
  const good = {
    NODE_ENV: "production", SHOPIFY_API_KEY: "k", SHOPIFY_API_SECRET: "s", SHOPIFY_APP_URL: "https://app.test",
    DATABASE_URL: "file:/data/x.sqlite", RESEND_API_KEY: "re", EMAIL_FROM_ADDRESS: "a@b.test",
    APP_ENCRYPTION_KEY: "55".repeat(32), JOB_SECRET: "x".repeat(30),
  };
  it("accepts a complete configuration", () => {
    expect(configProblems(good)).toEqual([]);
    expect(() => assertProductionConfig(good)).not.toThrow();
  });
  it("refuses weak or missing settings in production only", () => {
    const bad = { ...good, APP_ENCRYPTION_KEY: "short", JOB_SECRET: "123", SHOPIFY_APP_URL: "http://app.test", RESEND_API_KEY: "" };
    const names = configProblems(bad).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["APP_ENCRYPTION_KEY", "JOB_SECRET", "SHOPIFY_APP_URL", "RESEND_API_KEY"]));
    expect(() => assertProductionConfig(bad)).toThrow(/cannot start in production/);
    expect(() => assertProductionConfig({ ...bad, NODE_ENV: "development" })).not.toThrow();
  });
});

describe("S2 security headers", () => {
  it("sets defensive headers and blocks framing unless Shopify set frame-ancestors", () => {
    const h = applySecurityHeaders(new Headers(), true);
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(h.get("Strict-Transport-Security")).toContain("max-age");
    const embedded = applySecurityHeaders(new Headers({ "Content-Security-Policy": "frame-ancestors https://x.myshopify.com https://admin.shopify.com" }), false);
    expect(embedded.get("Content-Security-Policy")).toContain("admin.shopify.com");
    expect(embedded.has("Strict-Transport-Security")).toBe(false);
  });
});

describe("S4 + S5 webhook dedupe and audit log", () => {
  const shop = `sec-${Date.now()}.myshopify.com`;
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { shop } });
    await db.processedWebhook.deleteMany({ where: { shop } });
  });
  it("accepts a webhook delivery once", async () => {
    const id = `wh-${Date.now()}`;
    expect(await firstDelivery(id, shop, "shop/redact")).toBe(true);
    expect(await firstDelivery(id, shop, "shop/redact")).toBe(false);
    expect(await firstDelivery(undefined, shop, "x")).toBe(true);
  });
  it("records actions without values", async () => {
    expect(actorFrom({ sub: "gid://shopify/User/42" })).toBe("Staff 42");
    expect(actorFrom(undefined)).toBe("Staff");
    expect(changedKeys({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: undefined })).toEqual(["b"]);
    await audit(shop, "Staff 42", "Settings changed", "tone, mode");
    const rows = await recentAudit(shop);
    expect(rows[0]).toMatchObject({ actor: "Staff 42", action: "Settings changed", detail: "tone, mode" });
  });
});

describe("IP allowlist: Admin API 403", () => {
  it("fails fast with a clear message and no retries", async () => {
    const { gql, AdminForbiddenError } = await import("../app/services/admin-types");
    let calls = 0;
    const admin = { graphql: async () => { calls++; return new Response("{}", { status: 403 }); } };
    await expect(gql(admin, "{ shop { id } }")).rejects.toBeInstanceOf(AdminForbiddenError);
    const thrower = { graphql: async () => { calls++; throw Object.assign(new Error("Forbidden"), { response: { code: 403 } }); } };
    await expect(gql(thrower, "{ shop { id } }")).rejects.toThrow(/IP allowlist/);
    expect(calls).toBe(2);
  });
});
