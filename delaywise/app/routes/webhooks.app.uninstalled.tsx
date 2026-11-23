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
  // M5: nothing queued may go out later, even after a quick reinstall.
  await db.message.updateMany({
    where: { shop, status: { in: ["pending_approval", "scheduled", "failed", "sending"] } },
    data: { status: "skipped", error: "App was uninstalled" },
  });
  await db.shopSettings.updateMany({
    where: { shop },
    data: { plan: "free", mode: "approval", lastScanAt: null, scanLockUntil: null },
  });

  return new Response();
};
