import { describe, expect, it } from "vitest";
import { allowDaily } from "../app/lib/rate-limit";

describe("M6 daily limiter", () => {
  it("allows up to the limit per key per day", () => {
    const day1 = new Date("2026-11-20T10:00:00Z");
    expect([1, 2, 3].map(() => allowDaily("shop-a:test", 2, day1))).toEqual([true, true, false]);
    expect(allowDaily("shop-b:test", 2, day1)).toBe(true);
    expect(allowDaily("shop-a:test", 2, new Date("2026-11-21T00:00:01Z"))).toBe(true);
  });
});
