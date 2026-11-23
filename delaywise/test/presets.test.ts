import { describe, expect, it } from "vitest";
import { detectPreset, isPresetId, presetValues } from "../app/lib/presets";

describe("U2 presets", () => {
  it("round-trips each preset and detects custom values", () => {
    for (const id of ["gentle", "balanced", "proactive"] as const) {
      expect(detectPreset(presetValues(id))).toBe(id);
    }
    expect(detectPreset({ ...presetValues("balanced"), graceHours: 30 })).toBe("custom");
    expect(isPresetId("balanced")).toBe(true);
    expect(isPresetId("evil")).toBe(false);
  });
  it("gets gentler from proactive to gentle", () => {
    expect(presetValues("proactive").stallHours).toBeLessThan(presetValues("balanced").stallHours);
    expect(presetValues("gentle").notifyOnStall).toBe(false);
  });
});
