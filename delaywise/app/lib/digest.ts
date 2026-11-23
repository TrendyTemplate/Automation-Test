/** F3: the merchant's daily summary email (pure builder, unit tested). */

export interface DigestShipment {
  orderName: string;
  risk: string;
  reason: string | null;
  carrier: string | null;
  orderValue: number;
  currency: string;
}

export interface DigestInput {
  storeName: string;
  appUrl: string;
  atRisk: DigestShipment[];
  pendingApprovals: number;
  sentYesterday: number;
}

const LABEL: Record<string, string> = {
  stalled: "Stalled",
  delayed: "Late",
  exception: "Carrier problem",
  lost: "Probably lost",
};
const ORDER = ["lost", "exception", "delayed", "stalled"];

export function shouldSendDigest(input: DigestInput): boolean {
  return input.atRisk.length > 0 || input.pendingApprovals > 0;
}

export function buildDigest(input: DigestInput): { subject: string; text: string } {
  const sorted = [...input.atRisk].sort((a, b) => ORDER.indexOf(a.risk) - ORDER.indexOf(b.risk));
  const value = sorted.reduce((sum, s) => sum + s.orderValue, 0);
  const currency = sorted[0]?.currency ?? "";
  const counts = ORDER.map((r) => [r, sorted.filter((s) => s.risk === r).length] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n} ${LABEL[r].toLowerCase()}`)
    .join(", ");

  const lines = [
    `Good morning! Here's today's shipping summary for ${input.storeName}.`,
    "",
    sorted.length
      ? `${sorted.length} order(s) need attention (${counts}), worth ${value.toFixed(2)} ${currency}.`
      : "No parcels are at risk right now.",
  ];
  if (input.pendingApprovals > 0) {
    lines.push(`${input.pendingApprovals} customer email(s) are waiting for your approval.`);
  }
  lines.push(`${input.sentYesterday} customer update(s) were sent in the last 24 hours.`);

  if (sorted.length) {
    lines.push("", "Top orders:");
    for (const s of sorted.slice(0, 15)) {
      lines.push(
        `- ${s.orderName} · ${LABEL[s.risk] ?? s.risk} · ${s.carrier ?? "Unknown carrier"} · ${s.reason ?? ""}`.trim(),
      );
    }
    if (sorted.length > 15) lines.push(`…and ${sorted.length - 15} more.`);
  }
  lines.push("", `Open Delaywise: ${input.appUrl}`, "", "You can turn this summary off in Delaywise → Settings.");

  const subject = sorted.length
    ? `${sorted.length} order(s) at risk today, ${input.storeName}`
    : `${input.pendingApprovals} email(s) waiting for approval, ${input.storeName}`;
  return { subject, text: lines.join("\n") };
}

/** "2026-11-20" in the shop's timezone, to send at most one digest per local day. */
export function localDateKey(date: Date, timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
