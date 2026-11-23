import { describe, expect, it } from "vitest";
import { emailProblems } from "../app/lib/email-guard";

const ok = {
  subject: "Your order #1001 is running late",
  body: "Hi there,\n\nYour parcel is taking longer than expected. Track it here: https://t.test/1. Use SORRY-ABC123 next time.\n\nThanks,\nAcme",
  trackingUrl: "https://t.test/1",
  discountCode: "SORRY-ABC123",
};

describe("L10 AI email guard", () => {
  it("accepts a good email (trailing punctuation after the link is fine)", () => {
    expect(emailProblems(ok)).toEqual([]);
  });
  it("rejects extra links, HTML, missing code and bad lengths", () => {
    expect(emailProblems({ ...ok, body: `${ok.body} Visit www.evil.test now` })[0]).toContain("unexpected link");
    expect(emailProblems({ ...ok, body: `${ok.body} <a href=x>hi</a>` })).toContain("contains HTML");
    expect(emailProblems({ ...ok, discountCode: "SORRY-ZZZ" })).toContain("discount code missing");
    expect(emailProblems({ ...ok, body: "Hi" })).toContain("body too short");
    expect(emailProblems({ ...ok, subject: "a\nb" })).toContain("subject too long or multi-line");
  });
  it("rejects any link when there is no tracking link", () => {
    expect(emailProblems({ ...ok, trackingUrl: null, body: ok.body })[0]).toContain("unexpected link");
  });
});
