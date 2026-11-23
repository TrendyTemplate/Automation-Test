import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings, getUsage, planFor } from "../services/settings.server";
import { ScanInProgressError, syncShop } from "../services/sync.server";
import { toCsv } from "../lib/csv";
import { roiSummary } from "../services/roi.server";
import { STATUS_LABEL, type ShipmentStatus } from "../lib/status";
import { detectIncidents, INCIDENT_WINDOW_HOURS } from "../lib/incidents";
import { sendMessage, setHandled } from "../services/notifier.server";
import { actorFrom, audit } from "../services/audit.server";
import { z } from "zod";
import { PRESETS, type PresetId } from "../lib/presets";
import { runQuickSetup } from "../services/quick-setup.server";

/** S6: dashboard actions and their inputs. */
const DashboardAction = z.object({
  intent: z.enum(["scan", "export", "handle", "unhandle", "incident_send", "quick_setup"]),
  preset: z.enum(["gentle", "balanced", "proactive"]).optional().default("balanced"),
  autopilot: z.enum(["true", "false"]).optional().default("false"),
  ids: z
    .string()
    .max(20_000)
    .optional()
    .transform((v) => (v ? v.split(",").filter((id) => /^[a-z0-9]{10,40}$/i.test(id)).slice(0, 500) : [])),
});

const AT_RISK = ["stalled", "delayed", "exception", "lost"];

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
  watch: "Check manually",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const now = new Date();
  const settings = await getSettings(shop);
  const plan = planFor(settings);
  const usage = await getUsage(shop);

  // L5: counts and aggregates instead of loading every shipment.
  const openWhere = { shop, status: { notIn: ["DELIVERED", "CANCELED"] } };
  const atRiskWhere = { ...openWhere, risk: { in: AT_RISK } };
  const [watching, flagged, atRiskTotals, anyShipment, pendingCount, sentCount, totalShipments, roi] = await Promise.all([
    db.shipment.count({ where: openWhere }),
    db.shipment.findMany({
      where: { ...openWhere, risk: { not: "none" } },
      orderBy: { riskSince: "desc" },
      take: 300,
    }),
    db.shipment.aggregate({ where: atRiskWhere, _count: { _all: true }, _sum: { orderValue: true } }),
    db.shipment.findFirst({ where: { shop }, select: { currency: true }, orderBy: { createdAt: "desc" } }),
    db.message.count({ where: { shop, status: "pending_approval" } }),
    db.message.count({ where: { shop, status: "sent" } }),
    db.shipment.count({ where: { shop } }),
    roiSummary(shop),
  ]);
  // U3: carrier incidents from problems that started in the last few days.
  const recent = await db.shipment.findMany({
    where: { ...openWhere, risk: { in: AT_RISK }, riskSince: { gte: new Date(now.getTime() - INCIDENT_WINDOW_HOURS * 3_600_000) } },
    select: { id: true, carrier: true, destinationCountry: true, risk: true, riskSince: true, orderValue: true, excluded: true, handledAt: true },
    take: 2000,
  });
  const incidents = detectIncidents(recent, settings.incidentThreshold, now).map((i) => ({
    ...i,
    since: i.since.toISOString(),
    ids: i.shipmentIds.join(","),
  }));

  const atRisk = flagged
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
      excluded: s.excluded,
      excludedReason: s.excludedReason,
      vip: s.vip,
      handled: Boolean(s.handledAt),
    }));

  // Order values are in the shop's currency (shopMoney), so one total is correct.
  const money = { orders: atRiskTotals._count._all, value: atRiskTotals._sum.orderValue ?? 0 };
  return {
    settings: {
      mode: settings.mode,
      onboardingCompleted: settings.onboardingCompleted,
      setupDone: Boolean(settings.setupDoneAt),
      lastScanAt: settings.lastScanAt ? settings.lastScanAt.toISOString() : null,
      lastScanError: settings.lastScanError,
    },
    roi,
    plan: {
      label: plan.label,
      shipmentLimit: plan.shipmentLimit,
      includedPaidLookups: plan.includedPaidLookups,
      autopilot: plan.autopilot,
    },
    usage: { shipmentsTracked: usage.shipmentsTracked, paidLookups: usage.paidLookups, messagesSent: usage.messagesSent },
    stats: {
      watching,
      atRiskOrders: money.orders,
      atRiskValue: money.value.toFixed(2),
      currency: anyShipment?.currency ?? "",
      pendingCount,
      sentCount,
      totalShipments,
    },
    atRisk,
    incidents,
  };
};

function riskOrder(risk: string): number {
  return ["none", "watch", "stalled", "delayed", "exception", "lost"].indexOf(risk);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticate.admin(request);
  const form = await request.formData();
  const parsed = DashboardAction.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { scanError: "Invalid request" };
  const { intent, ids } = parsed.data;
  const actor = actorFrom(sessionToken);

  // U1: everything a new merchant needs, in one click.
  if (intent === "quick_setup") {
    const result = await runQuickSetup({
      admin,
      shop: session.shop,
      preset: parsed.data.preset,
      autopilot: parsed.data.autopilot === "true",
      actor,
    });
    return { setup: { ...result, atRisk: result.summary?.atRisk ?? 0, seen: result.summary?.shipmentsSeen ?? 0 } };
  }

  // U5: mark orders handled (or undo).
  if (intent === "handle" || intent === "unhandle") {
    const count = await setHandled(session.shop, ids, actor, intent === "handle");
    return { handled: count, intent };
  }

  // U3: approve the drafted emails for every order in an incident (max 25 per click).
  if (intent === "incident_send") {
    const drafts = await db.message.findMany({
      where: { shop: session.shop, shipmentId: { in: ids }, status: "pending_approval" },
      select: { id: true },
      take: 25,
    });
    let sent = 0;
    for (const d of drafts) if ((await sendMessage(admin, session.shop, d.id)).ok) sent++;
    await audit(session.shop, actor, "Incident emails sent", `${sent} of ${drafts.length}`);
    return { incidentSent: sent, incidentTotal: drafts.length };
  }

  // F10: CSV of every open at-risk shipment (for carrier claims, 3PLs, reports).
  if (intent === "export") {
    const rows = await db.shipment.findMany({
      where: { shop: session.shop, risk: { not: "none" }, status: { notIn: ["DELIVERED", "CANCELED"] } },
      orderBy: { shippedAt: "asc" },
    });
    const csv = toCsv(
      ["Order", "Risk", "Reason", "Carrier", "Tracking number", "Tracking URL", "Status", "Shipped", "Expected", "Destination", "Value", "Currency", "Excluded"],
      rows.map((r) => [
        r.orderName,
        r.risk,
        r.riskReason,
        r.carrier,
        r.trackingNumber,
        r.trackingUrl,
        STATUS_LABEL[r.status as ShipmentStatus] ?? r.status,
        r.shippedAt.toISOString().slice(0, 10),
        r.expectedBy?.toISOString().slice(0, 10),
        r.destinationCountry,
        r.orderValue.toFixed(2),
        r.currency,
        r.excluded ? "yes" : "no",
      ]),
    );
    return { csv };
  }

  // M1: a failed or overlapping scan shows a message, never an error page.
  try {
    const summary = await syncShop(admin, session.shop);
    return { summary };
  } catch (error) {
    const message =
      error instanceof ScanInProgressError
        ? error.message
        : "The scan couldn't finish. Shopify may be busy; Delaywise will retry automatically within the hour.";
    console.error(`[scan] ${session.shop}`, error);
    return { scanError: message };
  }
};

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `delaywise-at-risk-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const exporter = useFetcher<typeof action>();
  const actions = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    const d = actions.data;
    if (!d) return;
    if ("handled" in d) shopify.toast.show(d.intent === "handle" ? `${d.handled} order(s) marked as handled` : "Undone");
    if ("incidentSent" in d) shopify.toast.show(`${d.incidentSent} of ${d.incidentTotal} customer update(s) sent`);
  }, [actions.data, shopify]);

  useEffect(() => {
    if (exporter.data && "csv" in exporter.data && exporter.data.csv) downloadCsv(exporter.data.csv);
  }, [exporter.data]);
  const scanning = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && "scanError" in fetcher.data && fetcher.data.scanError) {
      shopify.toast.show(fetcher.data.scanError, { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    const s = fetcher.data && "summary" in fetcher.data ? fetcher.data.summary : null;
    if (s) {
      shopify.toast.show(
        `Checked ${s.shipmentsSeen} shipments · ${s.atRisk} at risk · ${s.messagesCreated} new messages`,
      );
    }
  }, [fetcher.data, shopify]);

  const scan = () => fetcher.submit({ intent: "scan" }, { method: "POST" });
  const { stats, usage, plan } = data;
  const nearLimit = usage.shipmentsTracked >= plan.shipmentLimit * 0.9;

  return (
    <s-page heading="Delaywise">
      <s-button slot="primary-action" variant="primary" onClick={scan} {...(scanning ? { loading: true } : {})}>
        Scan shipments now
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => exporter.submit({ intent: "export" }, { method: "POST" })}
        {...(exporter.state !== "idle" ? { loading: true } : {})}
      >
        Export at-risk orders (CSV)
      </s-button>

      {data.incidents.map((i) => (
        <s-banner key={i.key} tone="critical" heading={`Possible carrier incident: ${i.carrier} → ${i.country}`}>
          <s-stack direction="block" gap="small">
            <s-text>
              {`${i.count} parcels with ${i.carrier} to ${i.country} ran into trouble at the same time (worth ${i.orderValue.toFixed(2)} ${data.stats.currency}). This usually means a strike, weather or a hub problem, not ${i.count} separate issues.`}
            </s-text>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={() => actions.submit({ intent: "incident_send", ids: i.ids }, { method: "POST" })}
                {...(actions.state !== "idle" ? { loading: true } : {})}
              >
                Send the waiting updates to these customers
              </s-button>
              <s-button onClick={() => actions.submit({ intent: "handle", ids: i.ids }, { method: "POST" })}>
                Mark all as handled
              </s-button>
            </s-stack>
          </s-stack>
        </s-banner>
      ))}

      {data.settings.lastScanError && (
        <s-banner heading="The last scan ran into a problem" tone="critical">
          {data.settings.lastScanError} We will try again automatically within the hour.
        </s-banner>
      )}

      {!data.settings.setupDone && <QuickSetup autopilotAllowed={data.plan.autopilot} />}

      {nearLimit && (
        <s-banner heading="You're close to your monthly shipment limit" tone="warning">
          {usage.shipmentsTracked} of {plan.shipmentLimit} shipments used on the {plan.label} plan.{" "}
          <s-link href="/app/plans">See plans</s-link>
        </s-banner>
      )}

      <s-section heading="Today">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
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
              <s-table-header>Action</s-table-header>
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
                    <s-stack direction="inline" gap="small-200">
                      <s-badge tone={RISK_TONE[s.risk] ?? "info"}>{RISK_LABEL[s.risk] ?? s.risk}</s-badge>
                      {s.excluded && <s-badge tone="neutral">{`No emails: ${s.excludedReason ?? "excluded"}`}</s-badge>}
                      {s.vip && <s-badge tone="info">VIP · you approve</s-badge>}
                      {s.handled && <s-badge tone="success">Handled</s-badge>}
                    </s-stack>
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
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      onClick={() => actions.submit({ intent: s.handled ? "unhandle" : "handle", ids: s.id }, { method: "POST" })}
                    >
                      {s.handled ? "Undo handled" : "Mark handled"}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Results so far">
        <s-stack direction="block" gap="small">
          <s-text>Customer updates sent: {data.roi.emailsSent}</s-text>
          <s-text>
            Apology discounts used: {data.roi.discountsRedeemed} of {data.roi.discountsSent}
          </s-text>
          <s-text>
            Revenue from those orders: <s-text type="strong">{`${data.roi.revenueRecovered.toFixed(2)} ${stats.currency}`}</s-text>
          </s-text>
          <s-text color="subdued">Last scan: {timeAgo(data.settings.lastScanAt)}</s-text>
        </s-stack>
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

/** U1: the whole setup on one card: pick a style, pick how emails go out, done. */
function QuickSetup({ autopilotAllowed }: { autopilotAllowed: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [preset, setPreset] = useState<PresetId>("balanced");
  const [autopilot, setAutopilot] = useState(false);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const setup = fetcher.data && "setup" in fetcher.data ? fetcher.data.setup : undefined;
    if (!setup) return;
    const learned = setup.learnedCarriers.length ? ` Learned delivery times for ${setup.learnedCarriers.join(", ")}.` : "";
    shopify.toast.show(
      setup.scanned
        ? `You're all set. Checked ${setup.seen} shipments; ${setup.atRisk} need attention.${learned}`
        : `You're all set. Your first scan is already running.${learned}`,
    );
  }, [fetcher.data, shopify]);

  return (
    <s-section heading="Set up Delaywise in one click">
      <s-stack direction="block" gap="base">
        <s-paragraph>
          Pick a style and how emails go out. Delaywise does the rest: it checks your shipped orders, learns how long
          your carriers really take, and turns on the daily summary and the delivery notice on your customers&apos;
          order page. You can change anything later in Settings.
        </s-paragraph>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => (
            <s-clickable
              key={id}
              onClick={() => setPreset(id)}
              padding="base"
              borderRadius="base"
              border="base"
              background={preset === id ? "subdued" : "transparent"}
              accessibilityLabel={`Choose ${PRESETS[id].label}`}
            >
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">{`${preset === id ? "● " : "○ "}${PRESETS[id].label}`}</s-text>
                <s-text color="subdued">{PRESETS[id].description}</s-text>
              </s-stack>
            </s-clickable>
          ))}
        </s-grid>
        <s-checkbox
          label={autopilotAllowed ? "Send emails automatically (Autopilot)" : "Send emails automatically (Autopilot, on paid plans)"}
          details="Off: every email waits for your approval in Messages. VIP orders always wait for you."
          checked={autopilot}
          onChange={(e) => setAutopilot(Boolean((e.currentTarget as unknown as { checked: boolean }).checked))}
          {...(autopilotAllowed ? {} : { disabled: true })}
        ></s-checkbox>
        <s-stack direction="inline" gap="base">
          <s-button
            variant="primary"
            onClick={() => fetcher.submit({ intent: "quick_setup", preset, autopilot: String(autopilot) }, { method: "POST" })}
            {...(busy ? { loading: true } : {})}
          >
            Set it up for me
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
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
