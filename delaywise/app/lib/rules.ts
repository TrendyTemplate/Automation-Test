/**
 * Merchant-configurable rules: exclusions (F5), per-carrier transit days (F7)
 * and the send window (F6). Pure functions, unit tested.
 */

export function parseList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[,\n]/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export interface ExclusionSettings {
  excludedTags: string | null;
  excludedCountries: string | null;
  minOrderValue: number;
}

export function exclusionReason(
  order: { tags: string[]; countryCode: string | null; orderValue: number },
  settings: ExclusionSettings,
): string | null {
  const tags = new Set(order.tags.map((t) => t.trim().toLowerCase()));
  const hit = parseList(settings.excludedTags).find((t) => tags.has(t));
  if (hit) return `Order tagged "${hit}"`;
  const country = order.countryCode?.toLowerCase();
  if (country && parseList(settings.excludedCountries).includes(country)) {
    return `Ships to excluded country ${order.countryCode}`;
  }
  if (settings.minOrderValue > 0 && order.orderValue < settings.minOrderValue) {
    return `Order value below ${settings.minOrderValue}`;
  }
  return null;
}

/** Parses {"usps": 5, "dhl express": 2}; ignores anything invalid. */
export function parseCarrierTransit(json: string | null | undefined): Record<string, number> {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(v);
      if (k.trim() && Number.isFinite(n) && n >= 1 && n <= 60) out[k.trim().toLowerCase()] = Math.round(n);
    }
    return out;
  } catch {
    return {};
  }
}

/** "USPS: 5, DHL Express: 2" (as typed in settings) → JSON string for storage. */
export function carrierTransitFromText(text: string): string | null {
  const out: Record<string, number> = {};
  for (const line of text.split(/[,\n]/)) {
    const m = /^\s*(.+?)\s*[:=]\s*(\d{1,2})\s*$/.exec(line);
    if (m) out[m[1].toLowerCase()] = Math.min(60, Math.max(1, Number(m[2])));
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

export function carrierTransitToText(json: string | null | undefined): string {
  return Object.entries(parseCarrierTransit(json))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

/** Transit days for a carrier: exact name match first, then partial match. */
export function transitDaysFor(
  carrier: string | null | undefined,
  table: Record<string, number>,
  fallback: number,
): number {
  const name = (carrier ?? "").trim().toLowerCase();
  if (!name) return fallback;
  if (table[name] !== undefined) return table[name];
  const partial = Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .find((k) => name.includes(k) || k.includes(name));
  return partial ? table[partial] : fallback;
}

/** Local hour (0–23) in a timezone; falls back to UTC for unknown zones. */
export function localHour(date: Date, timezone: string | null | undefined): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
    return Number(parts.find((p) => p.type === "hour")?.value ?? date.getUTCHours());
  } catch {
    return date.getUTCHours();
  }
}

/** True if `date` is inside [start, end) local hours. start === end means always. */
export function inSendWindow(date: Date, timezone: string | null | undefined, start: number, end: number): boolean {
  if (start === end) return true;
  const h = localHour(date, timezone);
  return start < end ? h >= start && h < end : h >= start || h < end;
}

/** The next moment (15-minute steps) that falls inside the send window. */
export function nextSendTime(date: Date, timezone: string | null | undefined, start: number, end: number): Date {
  if (inSendWindow(date, timezone, start, end)) return date;
  const step = 15 * 60 * 1000;
  let t = Math.ceil(date.getTime() / step) * step;
  for (let i = 0; i < 4 * 48; i++, t += step) {
    if (inSendWindow(new Date(t), timezone, start, end)) return new Date(t);
  }
  return date;
}
