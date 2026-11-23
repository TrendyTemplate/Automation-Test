import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { refreshShopInfo } from "../services/settings.server";
import { PLANS, TRIAL_DAYS } from "../lib/plans";

/**
 * Plans are configured in the Partner Dashboard with Shopify App Pricing
 * (managed pricing). Merchants choose and pay on Shopify's own plan page;
 * the app reads the active plan from currentAppInstallation.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await refreshShopInfo(admin, session.shop);
  const storeHandle = session.shop.replace(/\.myshopify\.com$/, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "delaywise";
  return {
    current: settings.plan,
    pricingUrl: `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`,
    plans: Object.values(PLANS),
    trialDays: TRIAL_DAYS,
  };
};

const FEATURES: Record<string, string[]> = {
  free: [
    "50 shipments a month",
    "AI emails in your customer's language",
    "Approve every email",
    "Carrier scorecard, daily summary, Shopify Flow trigger",
  ],
  starter: ["500 shipments a month", "300 extra carrier lookups", "Autopilot sending", "Sorry discount codes"],
  growth: ["2,000 shipments a month", "1,000 extra carrier lookups", "Autopilot sending", "Sorry discount codes"],
  pro: ["5,000 shipments a month", "2,500 extra carrier lookups", "Autopilot sending", "Sorry discount codes"],
};

export default function Plans() {
  const { current, pricingUrl, plans, trialDays } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Plans">
      <s-section>
        <s-paragraph>
          Paid plans include a {trialDays}-day free trial. Billing is handled by Shopify and appears on your Shopify
          invoice. You can change or cancel anytime.
        </s-paragraph>
      </s-section>
      <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
        {plans.map((p) => (
          <s-section key={p.id} heading={p.label}>
            <s-stack direction="block" gap="base">
              <s-heading>{p.priceUsd === 0 ? "Free" : `$${p.priceUsd} / month`}</s-heading>
              <s-unordered-list>
                {FEATURES[p.id].map((f) => (
                  <s-list-item key={f}>{f}</s-list-item>
                ))}
              </s-unordered-list>
              {current === p.id ? (
                <s-badge tone="success">Current plan</s-badge>
              ) : (
                <s-button href={pricingUrl} target="_top" variant={p.id === "growth" ? "primary" : "secondary"}>
                  {p.priceUsd === 0 ? "Switch to Free" : `Choose ${p.label}`}
                </s-button>
              )}
            </s-stack>
          </s-section>
        ))}
      </s-grid>
      <s-section>
        <s-paragraph color="subdued">
          “Extra carrier lookups” are used only when Shopify has no tracking scans for a parcel. When they run out,
          Delaywise keeps working with Shopify’s own tracking data and never charges you more.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
