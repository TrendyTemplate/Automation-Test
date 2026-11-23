import db from "../db.server";

/** F13: how long we keep data. Matches the privacy policy. */
export const SHIPMENT_RETENTION_DAYS = 90;
export const MESSAGE_RETENTION_DAYS = 180;

export async function applyRetention(now = new Date()): Promise<{ shipments: number; messages: number }> {
  const day = 86_400_000;
  const messages = await db.message.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - MESSAGE_RETENTION_DAYS * day) } },
  });
  // Messages cascade when their shipment is deleted.
  const shipments = await db.shipment.deleteMany({
    where: { shippedAt: { lt: new Date(now.getTime() - SHIPMENT_RETENTION_DAYS * day) } },
  });
  return { shipments: shipments.count, messages: messages.count };
}
