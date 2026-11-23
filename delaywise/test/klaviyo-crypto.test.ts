import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptionAvailable, encryptSecret, maskSecret } from "../app/lib/crypto";
import { KLAVIYO_METRICS, klaviyoBody, looksLikeKlaviyoPrivateKey } from "../app/services/klaviyo.server";

const KEY = "11".repeat(32);

describe("R3 secret encryption", () => {
  afterEach(() => {
    delete process.env.APP_ENCRYPTION_KEY;
  });

  it("round-trips and rejects tampering", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    expect(encryptionAvailable()).toBe(true);
    const token = encryptSecret("pk_secret_value_1234567890");
    expect(token).not.toContain("pk_secret");
    expect(decryptSecret(token)).toBe("pk_secret_value_1234567890");
    expect(decryptSecret(token, "other-shop")).toBeNull();
    const parts = token.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(decryptSecret(parts.join("."))).toBeNull();
  });

  it("refuses to work without a valid key", () => {
    expect(encryptionAvailable()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/APP_ENCRYPTION_KEY/);
    process.env.APP_ENCRYPTION_KEY = "too-short";
    expect(encryptionAvailable()).toBe(false);
  });

  it("masks secrets for display", () => {
    expect(maskSecret("pk_abcdefghijklmnop")).toBe("pk_…mnop");
    expect(maskSecret(null)).toBe("");
  });
});

describe("R3 Klaviyo event", () => {
  it("builds a JSON:API event body", () => {
    const body = klaviyoBody({
      metric: KLAVIYO_METRICS.atRisk,
      email: "buyer@example.test",
      uniqueId: "shop:f1:delayed",
      time: new Date("2026-11-20T00:00:00Z"),
      properties: { order_name: "#1001", risk: "delayed" },
    });
    expect(body.data.type).toBe("event");
    expect(body.data.attributes.metric.data.attributes.name).toBe("Delaywise Shipment At Risk");
    expect(body.data.attributes.profile.data.attributes.email).toBe("buyer@example.test");
    expect(body.data.attributes.unique_id).toBe("shop:f1:delayed");
  });
  it("recognises private keys", () => {
    expect(looksLikeKlaviyoPrivateKey("pk_0123456789abcdefghijKLMN")).toBe(true);
    expect(looksLikeKlaviyoPrivateKey("AbC123")).toBe(false);
  });
});
