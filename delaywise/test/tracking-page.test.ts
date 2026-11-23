import { afterAll, describe, expect, it } from "vitest";
import db from "../app/db.server";
import {
  esc,
  normalizeEmail,
  orderNameCandidates,
  proxyPath,
  renderTrackPage,
  safeUrl,
  statusKey,
  trackLang,
} from "../app/lib/tracking-page";
import { trackOrder } from "../app/services/track-lookup.server";

describe("T1 tracking page: input handling", () => {
  it("neutralises HTML and Liquid", () => {
    const out = esc(`<script>{{ customer.email }}{% render 'x' %}"'&`);
    expect(out).not.toMatch(/[<>{}%"']/);
    expect(out).toContain("&lt;script&gt;");
  });
  it("never renders the shopper's input as Liquid", () => {
    const html = renderTrackPage({ kind: "error", message: "notFound" }, "en", "/apps/track", "{{ shop.secret }}");
    expect(html).not.toContain("{{ shop.secret }}");
  });
  it("accepts order names with or without #", () => {
    expect(orderNameCandidates(" #1042 ")).toEqual(["#1042", "1042"]);
    expect(orderNameCandidates("1042")).toEqual(["#1042", "1042"]);
    expect(orderNameCandidates('1042" OR name:*')).toBeNull();
    expect(orderNameCandidates("")).toBeNull();
  });
  it("normalises emails", () => {
    expect(normalizeEmail(" Lena@Example.DE ")).toBe("lena@example.de");
    expect(normalizeEmail("not an email")).toBeNull();
  });
  it("only allows Shopify proxy paths and http links", () => {
    expect(proxyPath("/apps/track")).toBe("/apps/track");
    expect(proxyPath("/tools/where-is-my-order")).toBe("/tools/where-is-my-order");
    expect(proxyPath("https://evil.example")).toBe("/apps/track");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://www.dhl.de/x?y=1")).toBe("https://www.dhl.de/x?y=1");
  });
  it("picks the shopper's language", () => {
    expect(trackLang("de-DE,de;q=0.9,en;q=0.8")).toBe("de");
    expect(trackLang("ja-JP")).toBe("en");
    expect(trackLang(null)).toBe("en");
  });
  it("maps statuses to plain words", () => {
    expect(statusKey("DELIVERED", "none")).toBe("delivered");
    expect(statusKey("IN_TRANSIT", "lost")).toBe("problem");
    expect(statusKey("IN_TRANSIT", "delayed")).toBe("moving");
    expect(statusKey("UNKNOWN", "none")).toBe("waiting");
  });
  it("renders an order in the shopper's language", () => {
    const html = renderTrackPage(
      {
        kind: "order",
        orderName: "#1042",
        shipped: true,
        notice: "Dein Paket braucht länger.",
        parcels: [{ carrier: "DHL", trackingNumber: "JD01", trackingUrl: "https://dhl.de/t", status: "IN_TRANSIT", risk: "delayed", expectedBy: new Date("2026-11-26T12:00:00Z") }],
      },
      "de",
      "/apps/track",
    );
    expect(html).toContain("Bestellung verfolgen");
    expect(html).toContain("Unterwegs");
    expect(html).toContain("Dein Paket braucht länger.");
    expect(html).toContain('href="https://dhl.de/t"');
  });
});

describe("T1 tracking page: lookup", () => {
  const shop = `track-${Date.now()}.myshopify.com`;
  const order = { id: "gid://shopify/Order/77", name: "#1042", email: "Lena@Example.de", customerLocale: "de", displayFulfillmentStatus: "FULFILLED" };
  const admin = (nodes: unknown[]) => ({
    graphql: async () => new Response(JSON.stringify({ data: { orders: { nodes } } })),
  });
  afterAll(async () => {
    await db.shipment.deleteMany({ where: { shop } });
    await db.shopSettings.deleteMany({ where: { shop } });
  });

  it("shows the order only when the email matches", async () => {
    await db.shopSettings.create({ data: { shop } });
    await db.shipment.create({
      data: { shop, orderId: order.id, orderName: "#1042", fulfillmentId: "f77", shippedAt: new Date(), status: "IN_TRANSIT", risk: "delayed", carrier: "DHL", trackingUrl: "https://dhl.de/t" },
    });
    const ok = await trackOrder({ admin: admin([order]), shop, orderInput: "1042", emailInput: "lena@example.de ", lang: "de" });
    expect(ok.kind).toBe("order");
    if (ok.kind === "order") {
      expect(ok.parcels).toHaveLength(1);
      expect(ok.notice).toBeTruthy();
    }
    const wrong = await trackOrder({ admin: admin([order]), shop, orderInput: "1042", emailInput: "someone@else.com", lang: "de" });
    expect(wrong).toEqual({ kind: "error", message: "notFound" });
  });
  it("gives the same answer for unknown orders and bad input", async () => {
    expect(await trackOrder({ admin: admin([]), shop, orderInput: "9999", emailInput: "a@b.co", lang: "en" })).toEqual({ kind: "error", message: "notFound" });
    expect(await trackOrder({ admin: admin([order]), shop, orderInput: "#1042\"", emailInput: "lena@example.de", lang: "en" })).toEqual({ kind: "error", message: "notFound" });
    expect(await trackOrder({ admin: undefined, shop, orderInput: "1042", emailInput: "lena@example.de", lang: "en" })).toEqual({ kind: "error", message: "notFound" });
  });
  it("says when nothing has shipped yet", async () => {
    const r = await trackOrder({ admin: admin([{ ...order, id: "gid://shopify/Order/78", displayFulfillmentStatus: "UNFULFILLED" }]), shop, orderInput: "#1042", emailInput: "lena@example.de", lang: "en" });
    expect(r.kind === "order" && r.shipped === false && r.parcels.length === 0).toBe(true);
  });
});
