import { Prisma } from "@prisma/client";
import db from "../db.server";

/** S5: retained like messages (see retention.server.ts). */
export const AUDIT_RETENTION_DAYS = 180;

export type Actor = string; // staff user id, "Autopilot" or "System"

/** Staff user from an embedded admin request's session token. */
export function actorFrom(sessionToken: { sub?: unknown } | undefined): Actor {
  const sub = sessionToken?.sub ? String(sessionToken.sub) : "";
  return sub ? `Staff ${sub.split("/").pop()}` : "Staff";
}

/** Writes one audit entry. Never throws: auditing must not break the action. */
export async function audit(shop: string, actor: Actor, action: string, detail?: string): Promise<void> {
  try {
    await db.auditLog.create({
      data: { shop, actor: actor.slice(0, 80), action: action.slice(0, 80), detail: detail?.slice(0, 500) },
    });
  } catch (error) {
    console.error(`[audit] ${shop}: could not record "${action}"`, error);
  }
}

export async function recentAudit(shop: string, take = 50) {
  return db.auditLog.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take });
}

/** Names of settings that differ (values are not logged: they may be personal). */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

/**
 * S4: true the first time a webhook delivery is seen. Shopify retries and can
 * deliver the same webhook more than once; repeats are acknowledged and ignored.
 */
export async function firstDelivery(webhookId: string | undefined, shop: string, topic: string): Promise<boolean> {
  if (!webhookId) return true;
  try {
    await db.processedWebhook.create({ data: { webhookId, shop, topic } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}
