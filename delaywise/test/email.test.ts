import { afterEach, describe, expect, it } from "vitest";
import { formatFrom, sendEmail } from "../app/services/email.server";

describe("M3 + L3 email sender", () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
  });
  it("quotes display names with commas and strips header-breaking characters", () => {
    expect(formatFrom("Acme, Inc.", "u@x.test")).toBe('"Acme, Inc." <u@x.test>');
    expect(formatFrom('Evil"\r\nBcc: a@b <x>', "u@x.test")).toBe('"EvilBcc: a@b x" <u@x.test>');
    expect(formatFrom("   ", "u@x.test")).toBe('"Store updates" <u@x.test>');
  });
  it("refuses to fake-send in production without an email key", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "production";
    await expect(sendEmail({ to: "a@b.test", fromName: "A", subject: "s", text: "t" })).rejects.toThrow(/not configured/);
  });
});
