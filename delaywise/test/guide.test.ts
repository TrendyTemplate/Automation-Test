import { describe, expect, it } from "vitest";
import { addGuideDone, guideSteps, guideVisible } from "../app/lib/guide";

describe("setup guide", () => {
  const base = { guideDone: null, digestEmail: null, orderStatusNotice: true };
  it("lists four steps with the order-page notice on", () => {
    expect(guideSteps(base).map((s) => s.id)).toEqual(["summary", "test", "notice", "tracking"]);
    expect(guideSteps({ ...base, orderStatusNotice: false }).map((s) => s.id)).not.toContain("notice");
  });
  it("ticks the summary step from settings", () => {
    expect(guideSteps({ ...base, digestEmail: "a@b.co" })[0].done).toBe(true);
  });
  it("hides when all done or hidden", () => {
    const all = ["test", "notice", "tracking"].reduce((acc, id) => addGuideDone(acc, id), null as string | null);
    expect(guideVisible({ ...base, digestEmail: "a@b.co", guideDone: all })).toBe(false);
    expect(guideVisible({ ...base, guideDone: "hidden" })).toBe(false);
    expect(guideVisible(base)).toBe(true);
  });
  it("does not duplicate ids", () => {
    expect(addGuideDone("test", "test")).toBe("test");
  });
});
