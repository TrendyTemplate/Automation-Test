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

describe("rate limit memory", () => {
  it("forgets earlier days and counts without recording", async () => {
    const { allowDaily, dailyCount, bucketCountForTests } = await import("../app/lib/rate-limit");
    const d1 = new Date("2026-01-01T10:00:00Z");
    const d2 = new Date("2026-01-02T10:00:00Z");
    for (let i = 0; i < 100; i++) allowDaily(`spoof-${i}`, 5, d1);
    expect(dailyCount("spoof-1", d1)).toBe(1);
    expect(dailyCount("spoof-1", d1)).toBe(1);
    allowDaily("fresh", 5, d2);
    expect(bucketCountForTests()).toBe(1);
  });
});
