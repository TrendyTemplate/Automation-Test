import type { LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { noticeForCustomer } from "../services/order-notice.server";

/**
 * R4: called by the "Delivery update" block on the customer's order-status
 * page (extensions/order-status-notice). Authenticated with the customer
 * account session token; CORS handled by the Shopify helper.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  const url = new URL(request.url);
  const dest = String(sessionToken.dest ?? "");
  const shop = dest.startsWith("http") ? new URL(dest).hostname : dest;
  try {
    const { admin } = await unauthenticated.admin(shop);
    const notice = await noticeForCustomer({
      admin,
      shop,
      orderId: url.searchParams.get("orderId") ?? "",
      customerId: sessionToken.sub ? String(sessionToken.sub) : null,
      viewerLanguage: url.searchParams.get("lang"),
    });
    return cors(Response.json({ notice }));
  } catch (error) {
    console.error(`[order-status] ${shop}`, error);
    return cors(Response.json({ notice: null }));
  }
};
