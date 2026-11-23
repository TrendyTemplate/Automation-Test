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
import { headlineFor } from "../lib/headline";
import { addGuideDone, guideSteps, guideVisible } from "../lib/guide";

/** S6: dashboard actions and their inputs. */
const DashboardAction = z.object({
  intent: z.enum(["scan", "export", "handle", "unhandle", "incident_send", "quick_setup", "guide_done", "guide_hide"]),
  step: z.enum(["summary", "notice", "test", "tracking"]).optional(),
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
  watch: "Check it yourself",
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
  const [openAtRisk, watching, flagged, atRiskTotals, anyShipment, pendingCount, sentCount, totalShipments, roi] = await Promise.all([
    db.shipment.count({ where: { ...atRiskWhere, handledAt: null } }),
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
    guide: {
      visible: guideVisible(settings),
      steps: guideSteps({ ...settings, trackUrl: `https://${shop}/apps/track` }).map(({ id, title, detail, action, done }) => ({ id, title, detail, action, done })),
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
      openAtRisk,
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

  // Setup guide: tick a step, or hide the whole guide.
  if (intent === "guide_done" || intent === "guide_hide") {
    const current = await db.shopSettings.findUnique({ where: { shop: session.shop }, select: { guideDone: true } });
    const id = intent === "guide_hide" ? "hidden" : parsed.data.step;
    if (!id) return { scanError: "Invalid request" };
    await db.shopSettings.update({
      where: { shop: session.shop },
      data: { guideDone: addGuideDone(current?.guideDone ?? null, id) },
    });
    return { guide: id };
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
    if (s) shopify.toast.show(`Checked ${s.shipmentsSeen} parcels. ${s.atRisk} need attention.`);
  }, [fetcher.data, shopify]);

  const scan = () => fetcher.submit({ intent: "scan" }, { method: "POST" });
  const { stats, usage, plan } = data;
  const nearLimit = usage.shipmentsTracked >= plan.shipmentLimit * 0.9;
  const headline = headlineFor(stats, stats.openAtRisk, data.settings.mode === "autopilot");

  if (!data.settings.setupDone) {
    return (
      <s-page heading="Welcome to Delaywise">
        <QuickSetup autopilotAllowed={data.plan.autopilot} />
      </s-page>
    );
  }

  return (
    <s-page heading="Home">
      <s-button slot="secondary-actions" onClick={scan} {...(scanning ? { loading: true } : {})}>
        Check again now
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => exporter.submit({ intent: "export" }, { method: "POST" })}
        {...(exporter.state !== "idle" ? { loading: true } : {})}
      >
        Download late orders (CSV)
      </s-button>

      {data.settings.lastScanError && (
        <s-banner heading="The last check didn't finish" tone="critical">
          {data.settings.lastScanError} Delaywise tries again on its own within the hour.
        </s-banner>
      )}
      {nearLimit && (
        <s-banner heading="You're close to this month's limit" tone="warning">
          {`${usage.shipmentsTracked} of ${plan.shipmentLimit} parcels used on the ${plan.label} plan. `}
          <s-link href="/app/plans">See plans</s-link>
        </s-banner>
      )}

      {/* One sentence that says what's going on, and the one thing to do next. */}
      <s-section>
        <s-stack direction="block" gap="base">
          <s-text color="subdued">{`Checked ${timeAgo(data.settings.lastScanAt)}`}</s-text>
          <s-heading>{headline.title}</s-heading>
          <s-paragraph color="subdued">{headline.detail}</s-paragraph>
          {stats.pendingCount > 0 && (
            <s-stack direction="inline" gap="base">
              <s-button variant="primary" href="/app/messages">
                {stats.pendingCount === 1 ? "Review 1 email" : `Review ${stats.pendingCount} emails`}
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {data.guide.visible && <SetupGuide steps={data.guide.steps} />}

      {data.incidents.map((i) => (
        <s-banner key={i.key} tone="critical" heading={`${i.carrier} is slow to ${i.country} right now`}>
          <s-stack direction="block" gap="base">
            <s-text>
              {`${i.count} of your parcels got stuck at the same time, so it's one carrier problem, not ${i.count} separate ones. Updates for these customers are ready.`}
            </s-text>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={() => actions.submit({ intent: "incident_send", ids: i.ids }, { method: "POST" })}
                {...(actions.state !== "idle" ? { loading: true } : {})}
              >
                {`Send update to all ${i.count}`}
              </s-button>
              <s-button onClick={() => actions.submit({ intent: "handle", ids: i.ids }, { method: "POST" })}>
                I&apos;ll handle it myself
              </s-button>
            </s-stack>
          </s-stack>
        </s-banner>
      ))}

      {data.atRisk.length > 0 && (
        <s-section heading="Needs you">
          <s-stack direction="block" gap="none">
            {data.atRisk.map((s, index) => (
              <s-box key={s.id}>
                {index > 0 && <s-divider />}
                <s-box paddingBlock="base">
                  <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                    <s-stack direction="block" gap="small-300">
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <s-link href={`shopify://admin/orders/${s.orderId}`} target="_top">
                          {s.orderName}
                        </s-link>
                        <s-badge tone={RISK_TONE[s.risk] ?? "info"}>{RISK_LABEL[s.risk] ?? s.risk}</s-badge>
                        {s.vip && <s-badge>VIP</s-badge>}
                        {s.handled && <s-badge tone="success">Handled</s-badge>}
                      </s-stack>
                      <s-text color="subdued">
                        {[s.reason, s.carrier !== "Unknown" ? s.carrier : null, s.excluded ? "No emails for this order" : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="small">
                      {s.trackingUrl && (
                        <s-button variant="tertiary" href={s.trackingUrl} target="_blank">
                          Track
                        </s-button>
                      )}
                      <s-button
                        onClick={() => actions.submit({ intent: s.handled ? "unhandle" : "handle", ids: s.id }, { method: "POST" })}
                      >
                        {s.handled ? "Undo" : "Mark handled"}
                      </s-button>
                    </s-stack>
                  </s-grid>
                </s-box>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
        <Metric label="Parcels on the way" value={String(stats.watching)} />
        <Metric label="Customers updated" value={String(data.roi.emailsSent)} />
        <Metric label="Earned back from sorry codes" value={`${data.roi.revenueRecovered.toFixed(2)} ${stats.currency}`} />
      </s-grid>
    </s-page>
  );
}

type GuideView = ReturnType<typeof useLoaderData<typeof loader>>["guide"]["steps"];

function SetupGuide({ steps }: { steps: GuideView }) {
  const fetcher = useFetcher<typeof action>();
  const left = steps.filter((s) => !s.done).length;
  return (
    <s-section heading={`Finish setting up · ${steps.length - left} of ${steps.length} done`}>
      <s-stack direction="block" gap="none">
        {steps.map((step, index) => (
          <s-box key={step.id}>
            {index > 0 && <s-divider />}
            <s-box paddingBlock="base">
              <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
                <s-icon type={step.done ? "check-circle-filled" : "circle"} tone={step.done ? "success" : "neutral"} />
                <s-stack direction="block" gap="small-300">
                  <s-text type="strong">{step.title}</s-text>
                  {!step.done && <s-text color="subdued">{step.detail}</s-text>}
                </s-stack>
                {!step.done && (
                  <s-stack direction="inline" gap="small">
                    <s-button href={step.action.href} {...(step.action.external ? { target: "_top" } : {})}>
                      {step.action.label}
                    </s-button>
                    {step.id !== "summary" && (
                      <s-button
                        variant="tertiary"
                        onClick={() => fetcher.submit({ intent: "guide_done", step: step.id }, { method: "POST" })}
                      >
                        Done
                      </s-button>
                    )}
                  </s-stack>
                )}
              </s-grid>
            </s-box>
          </s-box>
        ))}
        <s-box paddingBlockStart="small">
          <s-button variant="tertiary" onClick={() => fetcher.submit({ intent: "guide_hide" }, { method: "POST" })}>
            Hide this list
          </s-button>
        </s-box>
      </s-stack>
    </s-section>
  );
}

/** U1: the whole setup in one question. */
function QuickSetup({ autopilotAllowed }: { autopilotAllowed: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [preset, setPreset] = useState<PresetId>("balanced");
  const [approve, setApprove] = useState(true);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const setup = fetcher.data && "setup" in fetcher.data ? fetcher.data.setup : undefined;
    if (!setup) return;
    shopify.toast.show(
      setup.scanned
        ? `You're all set. Checked ${setup.seen} parcels; ${setup.atRisk} need attention.`
        : "You're all set. Your first check is running.",
    );
  }, [fetcher.data, shopify]);

  return (
    <s-section>
      <s-stack direction="block" gap="large">
        <s-stack direction="block" gap="small">
          <s-heading>Tell late-parcel customers before they ask</s-heading>
          <s-paragraph color="subdued">
            Pick how often customers should hear from you. Everything else is set up for you, and you can change it
            later.
          </s-paragraph>
        </s-stack>
        <s-choice-list
          label="How often"
          labelAccessibilityVisibility="exclusive"
          onChange={(e) => {
            const values = (e.currentTarget as unknown as { values: string[] }).values;
            if (values[0] && values[0] in PRESETS) setPreset(values[0] as PresetId);
          }}
        >
          {(Object.keys(PRESETS) as PresetId[]).map((id) => (
            <s-choice key={id} value={id} {...(preset === id ? { selected: true } : {})}>
              {PRESETS[id].label}
              <s-text slot="details">{PRESETS[id].description}</s-text>
            </s-choice>
          ))}
        </s-choice-list>
        <s-switch
          label="Let me approve each email first"
          details={
            autopilotAllowed
              ? "Turn this off to send emails automatically. VIP orders always wait for you."
              : "Automatic sending is on paid plans. VIP orders always wait for you."
          }
          checked={approve}
          onChange={(e) => setApprove(Boolean((e.currentTarget as unknown as { checked: boolean }).checked))}
          {...(autopilotAllowed ? {} : { disabled: true })}
        ></s-switch>
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              onClick={() =>
                fetcher.submit(
                  { intent: "quick_setup", preset, autopilot: String(autopilotAllowed && !approve) },
                  { method: "POST" },
                )
              }
              {...(busy ? { loading: true } : {})}
            >
              Start Delaywise
            </s-button>
          </s-stack>
          <s-text color="subdued">Nothing is sent to customers until a parcel is actually late.</s-text>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <s-section>
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
