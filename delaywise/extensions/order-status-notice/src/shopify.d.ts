// Local copy of the declaration Shopify CLI generates, so `npm run typecheck:extensions`
// can check this extension. The CLI regenerates it on `shopify app dev`.
import "@shopify/ui-extensions";

declare module "./OrderStatusBlock.tsx" {
  const shopify: import("@shopify/ui-extensions/customer-account.order-status.block.render").Api;
  const globalThis: { shopify: typeof shopify };
}
