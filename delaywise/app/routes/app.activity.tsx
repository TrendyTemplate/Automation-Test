import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { recentAudit } from "../services/audit.server";

/** S5: the merchant's activity log (last 100 actions, kept 180 days). */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rows = await recentAudit(session.shop, 100);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      when: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
      actor: r.actor,
      action: r.action,
      detail: r.detail ?? "",
    })),
  };
};

export default function Activity() {
  const { rows } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Activity">
      <s-section heading="Who did what">
        <s-paragraph color="subdued">
          Every email sent or skipped, every settings change and every plan change, kept for 180 days. Times are UTC.
        </s-paragraph>
        {rows.length === 0 ? (
          <s-paragraph>Nothing yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">When</s-table-header>
              <s-table-header>Who</s-table-header>
              <s-table-header>What</s-table-header>
              <s-table-header>Details</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{r.when}</s-table-cell>
                  <s-table-cell>{r.actor}</s-table-cell>
                  <s-table-cell>{r.action}</s-table-cell>
                  <s-table-cell>{r.detail}</s-table-cell>
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
