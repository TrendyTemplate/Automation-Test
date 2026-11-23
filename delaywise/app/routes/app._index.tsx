import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings, getUsage, planFor } from "../services/settings.server";
import { syncShop } from "../services/sync.server";
import { revenueAtRisk } from "../lib/scorecard";
import { STATUS_LABEL, type ShipmentStatus } from "../lib/status";

const RISK_TONE: Record<string, "critical" | "warning" | "caution" | "info"> = {
  lost: "critical",
  exception: "critical",
  delayed: "warning",
  stalled: "caution",
  watch: "info",
};
const RISK_LABEL: Record<string, string> = {
  lost: "Probably lost",
  exception: "Carrier problem",
  delayed: "Late",
  stalled: "Stalled",
  watch: "Due soon",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getSettings(shop);
  const plan = planFor(settings);
  const usage = await getUsage(shop);

  const [open, pendingCount, sentCount, totalShipments] = await Promise.all([
    db.shipment.findMany({
      where: { shop, status: { notIn: ["DELIVERED", "CANCELED"] } },
      orderBy: { riskSince: "desc" },
    }),
    db.message.count({ where: { shop, status: "pending_approval" } }),
    db.message.count({ where: { shop, status: "sent" } }),
    db.shipment.count({ where: { shop } }),
  ]);

  const atRisk = open
    .filter((s) => s.risk !== "none")
    .sort((a, b) => riskOrder(b.risk) - riskOrder(a.risk))
    .slice(0, 50)
    .map((s) => ({
      id: s.id,
      orderId: s.orderId.split("/").pop() ?? "",
      orderName: s.orderName,
      carrier: s.carrier ?? "Unknown",
      status: STATUS_LABEL[s.status as ShipmentStatus] ?? s.status,
      risk: s.risk,
      reason: s.riskReason ?? "",
      trackingUrl: s.trackingUrl,
      value: `${s.orderValue.toFixed(2)} ${s.currency}`,
    }));

  const money = revenueAtRisk(open);
  return {
    settings: { mode: settings.mode, onboardingCompleted: settings.onboardingCompleted },
    plan: { label: plan.label, shipmentLimit: plan.shipmentLimit, includedPaidLookups: plan.includedPaidLookups },
    usage: { shipmentsTracked: usage.shipmentsTracked, paidLookups: usage.paidLookups, messagesSent: usage.messagesSent },
    stats: {
      watching: open.length,
      atRiskOrders: money.orders,
      atRiskValue: money.value.toFixed(2),
      currency: open[0]?.currency ?? "",
      pendingCount,
      sentCount,
      totalShipments,
    },
    atRisk,
  };
};

function riskOrder(risk: string): number {
  return ["none", "watch", "stalled", "delayed", "exception", "lost"].indexOf(risk);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const summary = await syncShop(admin, session.shop);
  return { summary };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const scanning = fetcher.state !== "idle";

  useEffect(() => {
    const s = fetcher.data?.summary;
    if (s) {
      shopify.toast.show(
        `Checked ${s.shipmentsSeen} shipments · ${s.atRisk} at risk · ${s.messagesCreated} new messages`,
      );
    }
  }, [fetcher.data, shopify]);

  const scan = () => fetcher.submit({}, { method: "POST" });
  const { stats, usage, plan } = data;
  const nearLimit = usage.shipmentsTracked >= plan.shipmentLimit * 0.9;

  return (
    <s-page heading="Delaywise">
      <s-button slot="primary-action" variant="primary" onClick={scan} {...(scanning ? { loading: true } : {})}>
        Scan shipments now
      </s-button>

      {!data.settings.onboardingCompleted && (
        <s-banner heading="Welcome! Three quick steps" tone="info">
          <s-ordered-list>
            <s-list-item>Click “Scan shipments now” to load your shipped orders from the last 45 days.</s-list-item>
            <s-list-item>
              Check your store name, reply-to email and tone in <s-link href="/app/settings">Settings</s-link>, then
              preview a sample email.
            </s-list-item>
            <s-list-item>
              Late parcels show up in <s-link href="/app/messages">Messages</s-link> for your approval, or go out
              automatically in Autopilot mode.
            </s-list-item>
          </s-ordered-list>
        </s-banner>
      )}

      {nearLimit && (
        <s-banner heading="You're close to your monthly shipment limit" tone="warning">
          {usage.shipmentsTracked} of {plan.shipmentLimit} shipments used on the {plan.label} plan.{" "}
          <s-link href="/app/plans">See plans</s-link>
        </s-banner>
      )}

      <s-section heading="Today">
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          <Metric label="Shipments in transit" value={String(stats.watching)} />
          <Metric label="Orders at risk" value={String(stats.atRiskOrders)} />
          <Metric label="Order value at risk" value={`${stats.atRiskValue} ${stats.currency}`} />
          <Metric label="Waiting for your approval" value={String(stats.pendingCount)} href="/app/messages" />
        </s-grid>
      </s-section>

      <s-section heading="Shipments that need attention">
        {data.atRisk.length === 0 ? (
          <s-paragraph color="subdued">
            {stats.totalShipments === 0
              ? "No shipments yet. Click “Scan shipments now” to start."
              : "Nothing needs attention. Every parcel is on track."}
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Risk</s-table-header>
              <s-table-header>Why</s-table-header>
              <s-table-header>Carrier</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="currency">Value</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.atRisk.map((s) => (
                <s-table-row key={s.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/orders/${s.orderId}`} target="_top">
                      {s.orderName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={RISK_TONE[s.risk] ?? "info"}>{RISK_LABEL[s.risk] ?? s.risk}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{s.reason}</s-table-cell>
                  <s-table-cell>{s.carrier}</s-table-cell>
                  <s-table-cell>
                    {s.trackingUrl ? (
                      <s-link href={s.trackingUrl} target="_blank">
                        {s.status}
                      </s-link>
                    ) : (
                      s.status
                    )}
                  </s-table-cell>
                  <s-table-cell>{s.value}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="This month">
        <s-stack direction="block" gap="small">
          <s-text>
            Plan: <s-text type="strong">{plan.label}</s-text> (<s-link href="/app/plans">change</s-link>)
          </s-text>
          <s-text>
            Shipments watched: {usage.shipmentsTracked} / {plan.shipmentLimit}
          </s-text>
          <s-text>
            Extra carrier lookups: {usage.paidLookups} / {plan.includedPaidLookups}
          </s-text>
          <s-text>Customer emails sent: {usage.messagesSent}</s-text>
          <s-text>Mode: {data.settings.mode === "autopilot" ? "Autopilot" : "Approve each email"}</s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How Delaywise works">
        <s-paragraph>
          Every hour Delaywise checks your shipped orders. When a parcel stalls, runs late, hits a carrier problem or
          looks lost, it writes a short, friendly update to your customer in their own language, before they have
          to ask “where is my order?”.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

function Metric({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        {href ? (
          <s-link href={href}>
            <s-heading>{value}</s-heading>
          </s-link>
        ) : (
          <s-heading>{value}</s-heading>
        )}
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
