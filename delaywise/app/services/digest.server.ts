import db from "../db.server";
import { buildDigest, localDateKey, shouldSendDigest } from "../lib/digest";
import { isAtRisk } from "../lib/risk";
import { localHour } from "../lib/rules";
import { sendEmail } from "./email.server";

/**
 * F3: sends the merchant one summary email per local day, after the start of
 * their send window, and only when something needs attention.
 */
export async function maybeSendDigest(shop: string, now = new Date()): Promise<boolean> {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.merchantDigest || !settings.digestEmail) return false;
  if (localHour(now, settings.timezone) < settings.sendWindowStart) return false;
  if (settings.lastDigestAt && localDateKey(settings.lastDigestAt, settings.timezone) === localDateKey(now, settings.timezone)) {
    return false;
  }

  const [open, pendingApprovals, sentYesterday] = await Promise.all([
    db.shipment.findMany({
      // L5: only the at-risk rows, bounded.
      where: {
        shop,
        excluded: false,
        status: { notIn: ["DELIVERED", "CANCELED"] },
        risk: { in: ["stalled", "delayed", "exception", "lost"] },
      },
      take: 500,
    }),
    db.message.count({ where: { shop, status: "pending_approval" } }),
    db.message.count({ where: { shop, status: "sent", sentAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
  ]);
  const storeHandle = shop.replace(/\.myshopify\.com$/, "");
  const input = {
    storeName: settings.brandName || settings.shopName || shop,
    appUrl: `https://admin.shopify.com/store/${storeHandle}/apps/${process.env.SHOPIFY_APP_HANDLE || "delaywise"}`,
    atRisk: open
      .filter((s) => isAtRisk(s.risk))
      .map((s) => ({
        orderName: s.orderName,
        risk: s.risk,
        reason: s.riskReason,
        carrier: s.carrier,
        orderValue: s.orderValue,
        currency: s.currency,
      })),
    pendingApprovals,
    sentYesterday,
  };
  if (!shouldSendDigest(input)) return false;

  const { subject, text } = buildDigest(input);
  await sendEmail({ to: settings.digestEmail, fromName: "Delaywise", subject, text });
  await db.shopSettings.update({ where: { shop }, data: { lastDigestAt: now } });
  return true;
}
