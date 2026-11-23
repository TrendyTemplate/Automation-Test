import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../services/settings.server";

/**
 * Mandatory privacy (compliance) webhooks: customers/data_request,
 * customers/redact and shop/redact. HMAC is verified by authenticate.webhook,
 * which returns 401 for invalid signatures.
 *
 * Delaywise stores no customer names, emails, phone numbers or addresses, only
 * order/fulfillment IDs, shipping status and the text of emails sent.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const body = payload as {
    orders_requested?: number[];
    orders_to_redact?: number[];
  };

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // We hold no personal data beyond order references. Log the request so
      // the merchant can be answered if they contact support.
      // M7: we keep no customer contact data; the only customer-related records
      // are shipment statuses and the text of emails sent about these orders.
      // Log their counts so support can export them for the merchant on request.
      const ids = (body.orders_requested ?? []).map((id) => `gid://shopify/Order/${id}`);
      const messages = ids.length
        ? await db.message.count({ where: { shop, shipment: { orderId: { in: ids } } } })
        : 0;
      console.log(`[compliance] data request for ${shop}: ${ids.length} order(s), ${messages} stored email(s)`);
      break;
    }
    case "CUSTOMERS_REDACT": {
      const ids = (body.orders_to_redact ?? []).map((id) => `gid://shopify/Order/${id}`);
      if (ids.length) {
        // Messages cascade with their shipments. M7: remember the orders so
        // the next scan never imports them again.
        await db.shipment.deleteMany({ where: { shop, orderId: { in: ids } } });
        for (const orderId of ids) {
          await db.redactedOrder.upsert({
            where: { shop_orderId: { shop, orderId } },
            update: {},
            create: { shop, orderId },
          });
        }
      }
      break;
    }
    case "SHOP_REDACT": {
      await deleteShopData(shop);
      break;
    }
    default:
      console.log(`[compliance] unhandled topic ${topic} for ${shop}`);
  }
  return new Response();
};
