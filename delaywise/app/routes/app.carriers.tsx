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
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const rows = await loadRows(session.shop);
  const table = parseCarrierTransit(settings.carrierTransitDays);
  for (const s of suggestTransitDays(rows)) table[s.carrier.toLowerCase()] = s.suggestedBusinessDays;
  await db.shopSettings.update({
    where: { shop: session.shop },
    data: { carrierTransitDays: Object.keys(table).length ? JSON.stringify(table) : null },
  });
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

  return (
    <s-page heading="Carrier scorecard">
      <s-section heading="Which carriers keep their promises?">
        <s-paragraph color="subdued">
          Based on {total} shipments from the last 90 days. On-time means delivered within your grace period of the
          expected date. Use this to choose carriers, set honest delivery promises, or renegotiate rates.
        </s-paragraph>
        {scores.length === 0 ? (
          <s-paragraph>No shipments yet. Run a scan from the dashboard.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Carrier</s-table-header>
              <s-table-header format="numeric">Shipments</s-table-header>
              <s-table-header format="numeric">Delivered</s-table-header>
              <s-table-header format="numeric">On time</s-table-header>
              <s-table-header format="numeric">Avg. days late</s-table-header>
              <s-table-header format="numeric">Problems</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {scores.map((s) => (
                <s-table-row key={s.carrier}>
                  <s-table-cell>{s.carrier}</s-table-cell>
                  <s-table-cell>{s.shipments}</s-table-cell>
                  <s-table-cell>{s.delivered}</s-table-cell>
                  <s-table-cell>
                    {s.onTimeRate === null ? (
                      "–"
                    ) : (
                      <s-badge tone={s.onTimeRate >= 95 ? "success" : s.onTimeRate >= 85 ? "warning" : "critical"}>
                        {`${s.onTimeRate}%`}
                      </s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>{s.avgDaysLate ?? "–"}</s-table-cell>
                  <s-table-cell>{s.problems}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Real delivery times">
        <s-paragraph color="subdued">
          Learned from your own deliveries (carriers with at least 5). The suggestion covers 80% of parcels, so
          Delaywise only warns customers when a parcel is genuinely late.
        </s-paragraph>
        {suggestions.length === 0 ? (
          <s-paragraph>Not enough delivered parcels yet. Check back after a few weeks of shipping.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Carrier</s-table-header>
                <s-table-header format="numeric">Deliveries</s-table-header>
                <s-table-header format="numeric">Median days</s-table-header>
                <s-table-header format="numeric">Your setting (business days)</s-table-header>
                <s-table-header format="numeric">Suggested (business days)</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {suggestions.map((s) => (
                  <s-table-row key={s.carrier}>
                    <s-table-cell>{s.carrier}</s-table-cell>
                    <s-table-cell>{s.deliveries}</s-table-cell>
                    <s-table-cell>{s.medianDays}</s-table-cell>
                    <s-table-cell>{s.current}</s-table-cell>
                    <s-table-cell>
                      {s.suggestedBusinessDays === s.current ? (
                        s.suggestedBusinessDays
                      ) : (
                        <s-badge tone="info">{String(s.suggestedBusinessDays)}</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            {changes.length > 0 && (
              <s-button
                variant="primary"
                onClick={() => apply.submit({}, { method: "post" })}
                {...(apply.state !== "idle" ? { loading: true } : {})}
              >
                {`Use suggested times for ${changes.length} carrier(s)`}
              </s-button>
            )}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
