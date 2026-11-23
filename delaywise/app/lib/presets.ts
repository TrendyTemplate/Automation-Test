/**
 * U2: three ready-made styles instead of five separate thresholds.
 * "custom" means the merchant changed something by hand.
 */
export type PresetId = "gentle" | "balanced" | "proactive";

export interface PresetValues {
  stallHours: number;
  graceHours: number;
  notifyOnStall: boolean;
  notifyOnDelay: boolean;
  notifyOnException: boolean;
}

export const PRESETS: Record<PresetId, PresetValues & { label: string; description: string }> = {
  gentle: {
    label: "Gentle",
    description: "Only email when a parcel is clearly late or the carrier reports a problem. Fewest emails.",
    stallHours: 96,
    graceHours: 48,
    notifyOnStall: false,
    notifyOnDelay: true,
    notifyOnException: true,
  },
  balanced: {
    label: "Balanced (recommended)",
    description: "Email when a parcel stops moving for 3 days, runs a day late, or hits a problem.",
    stallHours: 72,
    graceHours: 24,
    notifyOnStall: true,
    notifyOnDelay: true,
    notifyOnException: true,
  },
  proactive: {
    label: "Proactive",
    description: "Tell customers early: after 2 quiet days or a few hours past the expected date.",
    stallHours: 48,
    graceHours: 8,
    notifyOnStall: true,
    notifyOnDelay: true,
    notifyOnException: true,
  },
};

export function isPresetId(v: unknown): v is PresetId {
  return v === "gentle" || v === "balanced" || v === "proactive";
}

export function presetValues(id: PresetId): PresetValues {
  const { stallHours, graceHours, notifyOnStall, notifyOnDelay, notifyOnException } = PRESETS[id];
  return { stallHours, graceHours, notifyOnStall, notifyOnDelay, notifyOnException };
}

/** Which preset the current values match, or "custom". */
export function detectPreset(v: PresetValues): PresetId | "custom" {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const p = presetValues(id);
    if ((Object.keys(p) as (keyof PresetValues)[]).every((k) => p[k] === v[k])) return id;
  }
  return "custom";
}
