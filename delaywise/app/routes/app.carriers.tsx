import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings } from "../services/settings.server";
import { carrierScorecard } from "../lib/scorecard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const rows = await db.shipment.findMany({
    where: { shop: session.shop },
    select: {
      carrier: true,
      destinationCountry: true,
      status: true,
      risk: true,
      expectedBy: true,
      deliveredAt: true,
      orderValue: true,
    },
  });
  return { scores: carrierScorecard(rows, settings.graceHours), total: rows.length };
};

export default function Carriers() {
  const { scores, total } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Carrier scorecard">
      <s-section heading="Which carriers keep their promises?">
        <s-paragraph color="subdued">
          Based on {total} shipments from the last 45 days. On-time means delivered within your grace period of the
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
