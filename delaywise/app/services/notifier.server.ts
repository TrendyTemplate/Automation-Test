import type { Shipment, ShopSettings } from "@prisma/client";
import { randomBytes } from "node:crypto";
import db from "../db.server";
import { baseLanguage } from "../lib/language";
import type { Plan } from "../lib/plans";
import type { NotifiableRisk } from "../lib/risk";
import { gql, type AdminApi } from "./admin-types";
import { writeDelayEmail } from "./ai-writer.server";
import { sendEmail } from "./email.server";
import { getUsage } from "./settings.server";
import { CREATE_DISCOUNT_MUTATION, ORDER_CONTACT_QUERY } from "./shopify-queries.server";

const DISCOUNT_VALID_DAYS = 60;

/** Creates a single-use "sorry" discount code in the merchant's store. */
export async function createSorryDiscount(
  admin: AdminApi,
  orderName: string,
  percent: number,
  now = new Date(),
): Promise<string | null> {
  const code = `SORRY-${randomBytes(3).toString("hex").toUpperCase()}`;
  const data = await gql<{
    discountCodeBasicCreate: { userErrors: { message: string }[] } | null;
  }>(admin, CREATE_DISCOUNT_MUTATION, {
    basicCodeDiscount: {
      title: `Delaywise apology for ${orderName}`,
      code,
      startsAt: now.toISOString(),
      endsAt: new Date(now.getTime() + DISCOUNT_VALID_DAYS * 86_400_000).toISOString(),
      context: { all: "ALL" },
      customerGets: {
        value: { percentage: Math.min(50, Math.max(1, percent)) / 100 },
        items: { all: true },
      },
      usageLimit: 1,
      appliesOncePerCustomer: true,
    },
  });
  const errors = data.discountCodeBasicCreate?.userErrors ?? [];
  if (errors.length) {
    console.error("[notifier] discount errors", errors.map((e) => e.message).join("; "));
    return null;
  }
  return code;
}

export async function createNotification(args: {
  admin: AdminApi;
  shipment: Shipment;
  kind: NotifiableRisk;
  daysLate: number;
  settings: ShopSettings;
  plan: Plan;
}): Promise<string> {
  const { admin, shipment, kind, daysLate, settings, plan } = args;
  const storeName = settings.brandName || settings.shopName || "Our store";

  let discount: { code: string; percent: number } | null = null;
  const wantsDiscount =
    plan.compensation &&
    settings.compensationEnabled &&
    (kind === "delayed" || kind === "lost") &&
    daysLate >= settings.compensationMinDaysLate;
  if (wantsDiscount) {
    const code = await createSorryDiscount(admin, shipment.orderName, settings.compensationPercent);
    if (code) discount = { code, percent: settings.compensationPercent };
  }

  const email = await writeDelayEmail({
    kind,
    language: baseLanguage(shipment.customerLocale),
    tone: settings.tone,
    storeName,
    orderName: shipment.orderName,
    trackingUrl: shipment.trackingUrl,
    carrier: shipment.carrier,
    daysLate,
    discount,
    signature: settings.signature,
  });

  const message = await db.message.create({
    data: {
      shop: shipment.shop,
      shipmentId: shipment.id,
      kind,
      language: email.language,
      subject: email.subject,
      body: email.body,
      generatedBy: email.generatedBy,
      discountCode: discount?.code ?? null,
    },
  });
  await db.shipment.update({ where: { id: shipment.id }, data: { notifiedRisk: kind } });

  if (settings.mode === "autopilot" && plan.autopilot) {
    await sendMessage(admin, message.id);
  }
  return message.id;
}

/**
 * Sends a stored message. The customer's email is read from Shopify just
 * for this send and never written to our database.
 */
export async function sendMessage(
  admin: AdminApi,
  messageId: string,
  edits?: { subject?: string; body?: string },
): Promise<{ ok: boolean; error?: string }> {
  const message = await db.message.findUnique({
    where: { id: messageId },
    include: { shipment: true },
  });
  if (!message) return { ok: false, error: "Message not found" };
  if (message.status === "sent") return { ok: true };

  const settings = await db.shopSettings.findUnique({ where: { shop: message.shop } });
  const subject = edits?.subject?.trim() || message.subject;
  const body = edits?.body?.trim() || message.body;

  try {
    const data = await gql<{ order: { email: string | null } | null }>(admin, ORDER_CONTACT_QUERY, {
      id: message.shipment.orderId,
    });
    const to = data.order?.email;
    if (!to) {
      await db.message.update({
        where: { id: messageId },
        data: { status: "failed", error: "This order has no customer email", subject, body },
      });
      return { ok: false, error: "This order has no customer email" };
    }

    await sendEmail({
      to,
      fromName: settings?.brandName || settings?.shopName || "Store updates",
      replyTo: settings?.replyToEmail,
      subject,
      text: body,
    });
    await db.message.update({
      where: { id: messageId },
      data: { status: "sent", sentAt: new Date(), error: null, subject, body },
    });
    const usage = await getUsage(message.shop);
    await db.usageMonth.update({
      where: { id: usage.id },
      data: { messagesSent: { increment: 1 } },
    });
    return { ok: true };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await db.message.update({
      where: { id: messageId },
      data: { status: "failed", error: text.slice(0, 500), subject, body },
    });
    return { ok: false, error: text };
  }
}

export async function skipMessage(shop: string, messageId: string): Promise<void> {
  await db.message.updateMany({
    where: { id: messageId, shop, status: { in: ["pending_approval", "failed"] } },
    data: { status: "skipped" },
  });
}
