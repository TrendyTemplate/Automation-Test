import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { languageName } from "../lib/language";
import { sendMessage, skipMessage } from "../services/notifier.server";

const BULK_SEND_BATCH = 25;

const KIND_LABEL: Record<string, string> = {
  stalled: "Stalled",
  delayed: "Late",
  exception: "Carrier problem",
  lost: "Probably lost",
  delivered: "Arrived after delay",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [pending, recent] = await Promise.all([
    db.message.findMany({
      where: { shop, status: { in: ["pending_approval", "failed", "scheduled", "sending"] } },
      include: { shipment: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.message.findMany({
      where: { shop, status: { in: ["sent", "skipped"] } },
      include: { shipment: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  const shape = (m: (typeof pending)[number]) => ({
    id: m.id,
    orderName: m.shipment.orderName,
    kind: m.kind,
    language: languageName(m.language),
    subject: m.subject,
    body: m.body,
    status: m.status,
    error: m.error,
    discountCode: m.discountCode,
    generatedBy: m.generatedBy,
    createdAt: m.createdAt.toISOString().slice(0, 16).replace("T", " "),
    sentAt: m.sentAt ? m.sentAt.toISOString().slice(0, 16).replace("T", " ") : null,
    scheduledFor: m.scheduledFor ? m.scheduledFor.toISOString().slice(0, 16).replace("T", " ") : null,
    discountRedeemed: Boolean(m.discountRedeemedAt),
  });
  return { pending: pending.map(shape), recent: recent.map(shape) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = String(form.get("intent") ?? "");

  // F9: bulk actions on everything waiting for approval.
  if (intent === "send_all" || intent === "skip_all") {
    const waiting = await db.message.findMany({
      where: { shop: session.shop, status: "pending_approval" },
      select: { id: true },
      // V-M5: a bounded batch per click so the request never runs for minutes.
      take: intent === "send_all" ? BULK_SEND_BATCH : 500,
    });
    const remaining =
      intent === "send_all"
        ? Math.max(0, (await db.message.count({ where: { shop: session.shop, status: "pending_approval" } })) - waiting.length)
        : 0;
    let done = 0;
    let failed = 0;
    for (const m of waiting) {
      if (intent === "skip_all") {
        await skipMessage(session.shop, m.id);
        done++;
      } else {
        const r = await sendMessage(admin, session.shop, m.id);
        if (r.ok) done++;
        else failed++;
      }
    }
    return {
      ok: failed === 0,
      intent,
      done,
      failed,
      remaining,
      error: failed ? `${failed} email(s) could not be sent` : undefined,
    };
  }

  const message = await db.message.findFirst({ where: { id, shop: session.shop } });
  if (!message) return { ok: false, error: "Message not found" };

  if (intent === "skip") {
    await skipMessage(session.shop, id);
    return { ok: true, intent };
  }
  const result = await sendMessage(admin, session.shop, id, {
    subject: String(form.get("subject") ?? ""),
    body: String(form.get("body") ?? ""),
  });
  return { ...result, intent };
};

export default function Messages() {
  const { pending, recent } = useLoaderData<typeof loader>();
  const bulk = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const waiting = pending.filter((m) => m.status === "pending_approval").length;

  useEffect(() => {
    const d = bulk.data;
    if (!d || !("done" in d)) return;
    const verb = d.intent === "skip_all" ? "skipped" : "sent";
    const more = "remaining" in d && d.remaining ? `. ${d.remaining} left: click Send all again.` : "";
    shopify.toast.show(d.ok ? `${d.done} email(s) ${verb}${more}` : (d.error ?? "Some emails failed"), { isError: !d.ok });
  }, [bulk.data, shopify]);

  return (
    <s-page heading="Customer messages">
      {waiting > 1 && (
        <>
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={() => bulk.submit({ intent: "send_all" }, { method: "post" })}
            {...(bulk.state !== "idle" ? { loading: true } : {})}
          >
            {`Send all ${waiting}`}
          </s-button>
          <s-button
            slot="secondary-actions"
            onClick={() => bulk.submit({ intent: "skip_all" }, { method: "post" })}
            {...(bulk.state !== "idle" ? { disabled: true } : {})}
          >
            Skip all
          </s-button>
        </>
      )}
      <s-section heading={`Waiting (${pending.length})`}>
        {pending.length === 0 ? (
          <s-paragraph color="subdued">
            No messages waiting. When a parcel runs into trouble, its draft appears here.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {pending.map((m) => (
              <PendingMessage key={m.id} message={m} />
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="History">
        {recent.length === 0 ? (
          <s-paragraph color="subdued">Nothing sent yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Language</s-table-header>
              <s-table-header>Subject</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recent.map((m) => (
                <s-table-row key={m.id}>
                  <s-table-cell>{m.orderName}</s-table-cell>
                  <s-table-cell>{KIND_LABEL[m.kind] ?? m.kind}</s-table-cell>
                  <s-table-cell>{m.language}</s-table-cell>
                  <s-table-cell>{m.subject}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={m.status === "sent" ? "success" : "neutral"}>
                      {m.status === "sent" ? `Sent ${m.sentAt ?? ""} UTC` : "Skipped"}
                    </s-badge>
                    {m.discountRedeemed && <s-badge tone="success">Discount used</s-badge>}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

type MessageView = ReturnType<typeof useLoaderData<typeof loader>>["pending"][number];

function PendingMessage({ message: m }: { message: MessageView }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const valueOf = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const submit = (intent: "send" | "skip") =>
    fetcher.submit({ id: m.id, intent, subject, body }, { method: "post" });

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show("intent" in fetcher.data && fetcher.data.intent === "skip" ? "Message skipped" : "Email sent");
    } else {
      shopify.toast.show(fetcher.data.error ?? "Could not send", { isError: true });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text type="strong">{m.orderName}</s-text>
            <s-badge tone="warning">{KIND_LABEL[m.kind] ?? m.kind}</s-badge>
            <s-badge>{m.language}</s-badge>
            {m.discountCode && <s-badge tone="success">Discount {m.discountCode}</s-badge>}
            {m.generatedBy === "template" && <s-badge tone="neutral">Template</s-badge>}
            {m.status === "sending" && <s-badge tone="info">Sending…</s-badge>}
            {m.status === "scheduled" && m.scheduledFor && (
              <s-badge tone="info">{`Autopilot sends at ${m.scheduledFor} UTC`}</s-badge>
            )}
          </s-stack>
          {m.status === "failed" && m.error && (
            <s-banner tone="critical" heading="Last attempt failed">
              {m.error}
            </s-banner>
          )}
          <s-text-field label="Subject" value={subject} onInput={(e) => setSubject(valueOf(e))}></s-text-field>
          <s-text-area label="Email" rows={8} value={body} onInput={(e) => setBody(valueOf(e))}></s-text-area>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={() => submit("send")} {...(busy ? { loading: true } : {})}>
              Send to customer
            </s-button>
            <s-button onClick={() => submit("skip")} {...(busy ? { disabled: true } : {})}>
              Skip
            </s-button>
          </s-stack>
        </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
