import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings } from "../services/settings.server";
import { carrierScorecard, suggestTransitDays } from "../lib/scorecard";
import { parseCarrierTransit, transitDaysFor } from "../lib/rules";
import { actorFrom, audit } from "../services/audit.server";

async function loadRows(shop: string) {
  return db.shipment.findMany({
    where: { shop },
    select: {
      carrier: true,
      destinationCountry: true,
      status: true,
      risk: true,
      shippedAt: true,
      expectedBy: true,
      deliveredAt: true,
      orderValue: true,
    },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const rows = await loadRows(session.shop);
  const table = parseCarrierTransit(settings.carrierTransitDays);
  const suggestions = suggestTransitDays(rows).map((s) => ({
    ...s,
    current: transitDaysFor(s.carrier, table, settings.defaultTransitDays),
  }));
  return { scores: carrierScorecard(rows, settings.graceHours), total: rows.length, suggestions };
};

/** R2: save the learned delivery times as per-carrier transit days. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const rows = await loadRows(session.shop);
  const table = parseCarrierTransit(settings.carrierTransitDays);
  for (const s of suggestTransitDays(rows)) table[s.carrier.toLowerCase()] = s.suggestedBusinessDays;
  await db.shopSettings.update({
    where: { shop: session.shop },
    data: { carrierTransitDays: Object.keys(table).length ? JSON.stringify(table) : null },
  });
  await audit(session.shop, actorFrom(sessionToken), "Learned delivery times applied", Object.keys(table).join(", "));
  return { applied: true };
};

export default function Carriers() {
  const { scores, total, suggestions } = useLoaderData<typeof loader>();
  const apply = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const changes = suggestions.filter((s) => s.suggestedBusinessDays !== s.current);

  useEffect(() => {
    if (apply.data?.applied) shopify.toast.show("Delivery times updated");
  }, [apply.data, shopify]);

  const sentence = changes
    .slice(0, 3)
    .map((s) => `${s.carrier} usually takes ${s.suggestedBusinessDays} business days (you say ${s.current})`)
    .join(". ");

  return (
    <s-page heading="Carriers">
      <s-section>
        <s-stack direction="block" gap="small">
          <s-heading>How your carriers are doing</s-heading>
          <s-paragraph color="subdued">{`Based on your own ${total} parcels from the last 90 days.`}</s-paragraph>
        </s-stack>
      </s-section>

      {changes.length > 0 && (
        <s-banner
          tone="info"
          heading={changes.length === 1 ? "1 delivery promise is too short" : `${changes.length} delivery promises are too short`}
        >
          <s-stack direction="block" gap="base">
            <s-text>{`${sentence}. Fixing this means fewer false alarms and earlier warnings when a parcel really is late.`}</s-text>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={() => apply.submit({}, { method: "post" })}
                {...(apply.state !== "idle" ? { loading: true } : {})}
              >
                {changes.length === 1 ? "Fix it" : `Fix all ${changes.length}`}
              </s-button>
            </s-stack>
          </s-stack>
        </s-banner>
      )}

      <s-section>
        {scores.length === 0 ? (
          <s-paragraph color="subdued">No parcels yet. Carriers appear here after your first shipped orders.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="none">
            {scores.map((s, index) => (
              <s-box key={s.carrier}>
                {index > 0 && <s-divider />}
                <s-box paddingBlock="base">
                  <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                    <s-stack direction="block" gap="small-300">
                      <s-text type="strong">{s.carrier}</s-text>
                      <s-text color="subdued">
                        {[
                          `${s.shipments} parcels`,
                          s.avgDaysLate ? `late ones arrive ${s.avgDaysLate} days late on average` : null,
                          s.problems ? `${s.problems} with problems` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </s-text>
                    </s-stack>
                    {s.onTimeRate === null ? (
                      <s-text color="subdued">Not enough deliveries yet</s-text>
                    ) : (
                      <s-badge tone={s.onTimeRate >= 95 ? "success" : s.onTimeRate >= 85 ? "warning" : "critical"}>
                        {`${s.onTimeRate}% on time`}
                      </s-badge>
                    )}
                  </s-grid>
                </s-box>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
