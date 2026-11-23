import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhooks can arrive more than once, and after the app is already uninstalled.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  // Stop sending anything for this shop. Remaining data is deleted when
  // Shopify sends shop/redact (48 hours after uninstall).
  await db.message.updateMany({
    where: { shop, status: "pending_approval" },
    data: { status: "skipped" },
  });
  await db.shopSettings.updateMany({ where: { shop }, data: { plan: "free", mode: "approval" } });

  return new Response();
};
