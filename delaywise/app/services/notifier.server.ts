import type { Shipment, ShopSettings } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import db from "../db.server";
import { baseLanguage } from "../lib/language";
import { getPlan, type Plan } from "../lib/plans";
import type { MessageKind } from "../lib/risk";
import { inSendWindow, nextSendTime } from "../lib/rules";
import { isFinal, type ShipmentStatus } from "../lib/status";
import { GraphqlError, gql, type AdminApi } from "./admin-types";
import { writeDelayEmail } from "./ai-writer.server";
import { sendEmail } from "./email.server";
import { getUsage } from "./settings.server";
import { audit } from "./audit.server";
import { CREATE_DISCOUNT_MUTATION, ORDER_CONTACT_QUERY } from "./shopify-queries.server";

const DISCOUNT_VALID_DAYS = 60;
/** L2: autopilot retries failed sends up to this many attempts in total. */
export const MAX_SEND_ATTEMPTS = 3;
/** V-7: bounded work per scan; the rest goes out next run. */
export const MAX_SENDS_PER_RUN = 25;
/** Statuses a message can be claimed for sending from. */
const SENDABLE = ["pending_approval", "failed", "scheduled"];

export function newDiscountCode(): string {
  return `SORRY-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Creates the single-use apology code in the merchant's store. M4: only called
 * when the email is actually being sent, and limited to that order's customer
 * when Shopify gives us the customer.
 */
export async function createSorryDiscount(
  admin: AdminApi,
  args: { code: string; orderName: string; percent: number; customerId: string | null },
  now = new Date(),
): Promise<void> {
  const data = await gql<{
    discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: { message: string }[] } | null;
  }>(admin, CREATE_DISCOUNT_MUTATION, {
    basicCodeDiscount: {
      title: `Delaywise apology for ${args.orderName}`,
      code: args.code,
      startsAt: now.toISOString(),
      endsAt: new Date(now.getTime() + DISCOUNT_VALID_DAYS * 86_400_000).toISOString(),
      context: args.customerId ? { customers: { add: [args.customerId] } } : { all: "ALL" },
      customerGets: {
        value: { percentage: Math.min(50, Math.max(1, args.percent)) / 100 },
        items: { all: true },
      },
      usageLimit: 1,
      appliesOncePerCustomer: true,
    },
  });
  const result = data.discountCodeBasicCreate;
  const errors = result?.userErrors ?? [];
  if (errors.length || !result?.codeDiscountNode?.id) {
    throw new Error(`Could not create the discount code: ${errors.map((e) => e.message).join("; ") || "no discount returned"}`);
  }
}

export async function createNotification(args: {
  admin: AdminApi;
  shipment: Shipment;
  kind: MessageKind;
  daysLate: number;
  settings: ShopSettings;
  plan: Plan;
  now?: Date;
}): Promise<string | null> {
  const { admin, shipment, kind, daysLate, settings, plan } = args;
  const now = args.now ?? new Date();
  const storeName = settings.brandName || settings.shopName || "Our store";

  // H2: never draft the same situation twice for a shipment.
  const existing = await db.message.findUnique({ where: { shipmentId_kind: { shipmentId: shipment.id, kind } } });
  if (existing) return null;

  // M4: choose the code now (it goes into the text), create it in Shopify at send time.
  const wantsDiscount =
    plan.compensation &&
    settings.compensationEnabled &&
    (kind === "delayed" || kind === "lost") &&
    daysLate >= settings.compensationMinDaysLate &&
    // One apology code per shipment, even if it escalates from late to lost
    // (a skipped draft's code doesn't count: nobody received it).
    (await db.message.count({
      where: { shipmentId: shipment.id, discountCode: { not: null }, status: { not: "skipped" } },
    })) === 0;
  const discount = wantsDiscount ? { code: newDiscountCode(), percent: settings.compensationPercent } : null;

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
    brandInstructions: settings.brandInstructions,
  });

  let messageId: string;
  try {
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
        discountPercent: discount?.percent ?? null,
      },
    });
    messageId = message.id;
  } catch (error) {
    // Another scan drafted it first (unique shipmentId + kind).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
  await db.shipment.update({
    where: { id: shipment.id },
    data: kind === "delivered" ? { followUpSent: true } : { notifiedRisk: kind },
  });

  // U4: VIP orders always wait for a person, even on Autopilot.
  if (shipment.vip && settings.mode === "autopilot") {
    await audit(shipment.shop, "Autopilot", "VIP order held for approval", `${kind} · ${shipment.orderName}`);
    return messageId;
  }
  if (settings.mode === "autopilot" && plan.autopilot) {
    // F6: respect the send window; otherwise queue until it opens.
    if (inSendWindow(now, settings.timezone, settings.sendWindowStart, settings.sendWindowEnd)) {
      const r = await sendMessage(admin, shipment.shop, messageId);
      await audit(shipment.shop, "Autopilot", r.ok ? "Email sent" : "Email send failed", `${kind} · ${shipment.orderName}`);
    } else {
      await db.message.update({
        where: { id: messageId },
        data: {
          status: "scheduled",
          scheduledFor: nextSendTime(now, settings.timezone, settings.sendWindowStart, settings.sendWindowEnd),
        },
      });
    }
  }
  return messageId;
}

/** Plain-language reason for a failed send, shown to the merchant. */
function describeSendError(error: unknown): string {
  if (error instanceof GraphqlError && error.accessDenied) {
    return "Shopify hasn't approved this app to read customer emails yet (Partner Dashboard → API access → Protected customer data).";
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Sends a stored message. H2: the message is claimed first, so two requests
 * can never send it twice. H5: messages about a parcel that has since arrived
 * or been cancelled are skipped. The customer's email is read from Shopify
 * just for this send and never written to our database.
 */
export async function sendMessage(
  admin: AdminApi,
  shop: string,
  messageId: string,
  edits?: { subject?: string; body?: string },
): Promise<{ ok: boolean; error?: string }> {
  const claimed = await db.message.updateMany({
    where: { id: messageId, shop, status: { in: SENDABLE } },
    data: { status: "sending", sendingSince: new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    const current = await db.message.findFirst({ where: { id: messageId, shop }, select: { status: true } });
    if (current?.status === "sent") return { ok: true };
    return { ok: false, error: current ? `This message is already ${current.status}` : "Message not found" };
  }

  const message = await db.message.findUniqueOrThrow({ where: { id: messageId }, include: { shipment: true } });
  const settings = await db.shopSettings.findUnique({ where: { shop: message.shop } });
  const subject = edits?.subject?.trim() || message.subject;
  const body = edits?.body?.trim() || message.body;

  if (message.kind !== "delivered" && isFinal(message.shipment.status as ShipmentStatus)) {
    await db.message.update({
      where: { id: messageId },
      data: { status: "skipped", error: "Parcel already delivered or the order was cancelled" },
    });
    return { ok: false, error: "This parcel has already arrived or the order was cancelled, so the email was not sent." };
  }

  try {
    const data = await gql<{ order: { email: string | null; customer: { id: string } | null } | null }>(
      admin,
      ORDER_CONTACT_QUERY,
      { id: message.shipment.orderId },
    );
    const to = data.order?.email;
    if (!to) {
      await db.message.update({
        where: { id: messageId },
        data: { status: "failed", error: "This order has no customer email", subject, body },
      });
      return { ok: false, error: "This order has no customer email" };
    }

    const plan = getPlan(settings?.plan);
    if (message.discountCode && !message.discountCreated && !plan.compensation) {
      // The plan no longer includes apology discounts.
      if (body.includes(message.discountCode)) {
        throw new Error(
          "Apology discounts need a paid plan. Remove the discount code from the email, or upgrade, then send again.",
        );
      }
    } else if (message.discountCode && !message.discountCreated) {
      await createSorryDiscount(admin, {
        code: message.discountCode,
        orderName: message.shipment.orderName,
        percent: message.discountPercent ?? settings?.compensationPercent ?? 10,
        customerId: data.order?.customer?.id ?? null,
      });
      await db.message.update({ where: { id: messageId }, data: { discountCreated: true } });
    }

    await sendEmail({
      to,
      fromName: settings?.brandName || settings?.shopName || "Store updates",
      replyTo: settings?.replyToEmail,
      subject,
      text: body,
    });
  } catch (error) {
    const text = describeSendError(error);
    await db.message.update({
      where: { id: messageId },
      data: { status: "failed", sendingSince: null, error: text, subject, body },
    });
    return { ok: false, error: text };
  }

  // V-H1: the email is out. Record that first and on its own, so a later
  // bookkeeping error can never make it look unsent (and be sent again).
  await db.message.update({
    where: { id: messageId },
    data: { status: "sent", sentAt: new Date(), sendingSince: null, error: null, subject, body },
  });
  try {
    const usage = await getUsage(message.shop);
    await db.usageMonth.update({ where: { id: usage.id }, data: { messagesSent: { increment: 1 } } });
  } catch (error) {
    console.error(`[notifier] ${message.shop}: could not count a sent email`, error);
  }
  return { ok: true };
}

/** V-M1: a claimed send older than this was interrupted (crash, redeploy). */
export const STUCK_SEND_MS = 10 * 60 * 1000;

/**
 * V-M1: interrupted sends become "failed" so the merchant sees them. They are
 * not retried automatically: the email may or may not have gone out.
 */
export async function recoverStuckSends(shop: string, now = new Date()): Promise<number> {
  const result = await db.message.updateMany({
    where: { shop, status: "sending", sendingSince: { lt: new Date(now.getTime() - STUCK_SEND_MS) } },
    data: {
      status: "failed",
      sendingSince: null,
      attempts: MAX_SEND_ATTEMPTS,
      error: "Sending was interrupted. Check whether the customer received it before sending again.",
    },
  });
  return result.count;
}

/**
 * F6 + L2 + M10: sends autopilot emails whose send window has opened and
 * retries failed autopilot sends. If the shop is no longer on a plan with
 * Autopilot, queued emails go back to the approval queue instead.
 */
export async function sendDueScheduled(admin: AdminApi, shop: string, now = new Date()): Promise<number> {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const plan = getPlan(settings?.plan);
  if (!settings || settings.mode !== "autopilot" || !plan.autopilot) {
    await db.message.updateMany({
      where: { shop, status: "scheduled" },
      data: { status: "pending_approval", scheduledFor: null },
    });
    return 0;
  }
  if (!inSendWindow(now, settings.timezone, settings.sendWindowStart, settings.sendWindowEnd)) return 0;

  const due = await db.message.findMany({
    where: {
      shop,
      OR: [
        { status: "scheduled", scheduledFor: { lte: now } },
        { status: "failed", attempts: { lt: MAX_SEND_ATTEMPTS }, error: { not: "This order has no customer email" } },
      ],
    },
    take: MAX_SENDS_PER_RUN,
  });
  let sent = 0;
  for (const m of due) {
    const result = await sendMessage(admin, shop, m.id);
    if (result.ok) sent++;
    await audit(shop, "Autopilot", result.ok ? "Scheduled email sent" : "Scheduled email failed", m.kind);
  }
  return sent;
}

/** H5: drafts about a parcel that has since arrived or was cancelled are dropped. */
export async function skipResolvedMessages(shop: string): Promise<number> {
  const result = await db.message.updateMany({
    where: {
      shop,
      kind: { not: "delivered" },
      status: { in: SENDABLE },
      shipment: { status: { in: ["DELIVERED", "CANCELED"] } },
    },
    data: { status: "skipped", error: "Parcel arrived or the order was cancelled before this was sent" },
  });
  return result.count;
}

/**
 * U5: the merchant has taken care of these orders (refund, reship, call).
 * Unsent drafts are dropped and nothing more is sent; undo clears the mark.
 */
export async function setHandled(shop: string, shipmentIds: string[], actor: string, handled: boolean): Promise<number> {
  const ids = shipmentIds.slice(0, 500);
  const result = await db.shipment.updateMany({
    where: { shop, id: { in: ids } },
    data: handled ? { handledAt: new Date(), handledBy: actor.slice(0, 80) } : { handledAt: null, handledBy: null },
  });
  if (handled) {
    await db.message.updateMany({
      where: { shop, shipmentId: { in: ids }, status: { in: SENDABLE } },
      data: { status: "skipped", error: "Marked as handled by the store" },
    });
  }
  await audit(shop, actor, handled ? "Marked as handled" : "Unmarked as handled", `${result.count} order(s)`);
  return result.count;
}

export async function skipMessage(shop: string, messageId: string): Promise<void> {
  await db.message.updateMany({
    where: { id: messageId, shop, status: { in: SENDABLE } },
    data: { status: "skipped" },
  });
}
