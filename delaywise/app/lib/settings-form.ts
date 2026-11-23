import type { Plan } from "./plans";
import { carrierTransitFromText } from "./rules";
import { detectPreset } from "./presets";

/**
 * Turns the settings form into safe database values: clamps numbers, trims
 * and limits text, and enforces plan limits (Autopilot and discounts are paid
 * features). Pure, so it is unit tested.
 */

type FormLike = { get(name: string): FormDataEntryValue | null };

export const clampInt = (v: FormDataEntryValue | null, min: number, max: number, fallback: number) => {
  if (v === null || String(v).trim() === "") return fallback;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const cleanText = (v: FormDataEntryValue | null, max: number) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s.length ? s : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const cleanEmail = (v: FormDataEntryValue | null) => {
  const s = cleanText(v, 200);
  return s && EMAIL.test(s) ? s : null;
};

const bool = (form: FormLike, name: string) => form.get(name) === "true";

export function parseSettingsForm(form: FormLike, plan: Plan) {
  const tone = String(form.get("tone"));
  const minOrderValue = Number(form.get("minOrderValue"));
  const vipMin = Number(form.get("vipMinOrderValue"));
  const thresholds = {
    stallHours: clampInt(form.get("stallHours"), 24, 336, 72),
    graceHours: clampInt(form.get("graceHours"), 0, 168, 24),
    notifyOnStall: bool(form, "notifyOnStall"),
    notifyOnDelay: bool(form, "notifyOnDelay"),
    notifyOnException: bool(form, "notifyOnException"),
  };
  return {
    ...thresholds,
    // U2: the style is whatever preset the thresholds match.
    preset: detectPreset(thresholds),
    vipTags: cleanText(form.get("vipTags"), 300),
    vipMinOrderValue: Number.isFinite(vipMin) && vipMin > 0 ? Math.min(vipMin, 1_000_000) : 0,
    incidentThreshold: clampInt(form.get("incidentThreshold"), 2, 50, 5),
    mode: form.get("mode") === "autopilot" && plan.autopilot ? "autopilot" : "approval",
    tone: ["friendly", "professional", "playful"].includes(tone) ? tone : "friendly",
    brandName: cleanText(form.get("brandName"), 80),
    replyToEmail: cleanEmail(form.get("replyToEmail")),
    signature: cleanText(form.get("signature"), 200),
    brandInstructions: cleanText(form.get("brandInstructions"), 500),
    defaultTransitDays: clampInt(form.get("defaultTransitDays"), 1, 30, 5),
    deliveredFollowUp: bool(form, "deliveredFollowUp"),
    compensationEnabled: plan.compensation && bool(form, "compensationEnabled"),
    compensationPercent: clampInt(form.get("compensationPercent"), 1, 50, 10),
    compensationMinDaysLate: clampInt(form.get("compensationMinDaysLate"), 1, 30, 3),
    excludedTags: cleanText(form.get("excludedTags"), 500),
    excludedCountries: cleanText(String(form.get("excludedCountries") ?? "").toUpperCase(), 300),
    minOrderValue: Number.isFinite(minOrderValue) && minOrderValue > 0 ? Math.min(minOrderValue, 1_000_000) : 0,
    sendWindowStart: clampInt(form.get("sendWindowStart"), 0, 23, 8),
    sendWindowEnd: clampInt(form.get("sendWindowEnd"), 0, 23, 20),
    carrierTransitDays: carrierTransitFromText(String(form.get("carrierTransit") ?? "")),
    extraTransitDays: clampInt(form.get("extraTransitDays"), 0, 14, 0),
    merchantDigest: bool(form, "merchantDigest"),
    digestEmail: cleanEmail(form.get("digestEmail")),
    flowTriggerEnabled: bool(form, "flowTriggerEnabled"),
    orderStatusNotice: bool(form, "orderStatusNotice"),
  };
}
