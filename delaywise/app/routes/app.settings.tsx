import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings, planFor } from "../services/settings.server";
import { writeDelayEmail } from "../services/ai-writer.server";
import { sendEmail } from "../services/email.server";
import type { MessageKind } from "../lib/risk";
import { carrierTransitToText } from "../lib/rules";
import { cleanEmail, cleanText, parseSettingsForm } from "../lib/settings-form";

const KINDS: MessageKind[] = ["stalled", "delayed", "exception", "lost", "delivered"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const plan = planFor(settings);
  return {
    settings: {
      mode: settings.mode,
      tone: settings.tone,
      brandName: settings.brandName ?? settings.shopName ?? "",
      replyToEmail: settings.replyToEmail ?? "",
      signature: settings.signature ?? "",
      brandInstructions: settings.brandInstructions ?? "",
      defaultTransitDays: settings.defaultTransitDays,
      graceHours: settings.graceHours,
      stallHours: settings.stallHours,
      notifyOnStall: settings.notifyOnStall,
      notifyOnDelay: settings.notifyOnDelay,
      notifyOnException: settings.notifyOnException,
      deliveredFollowUp: settings.deliveredFollowUp,
      compensationEnabled: settings.compensationEnabled,
      compensationPercent: settings.compensationPercent,
      compensationMinDaysLate: settings.compensationMinDaysLate,
      excludedTags: settings.excludedTags ?? "",
      excludedCountries: settings.excludedCountries ?? "",
      minOrderValue: settings.minOrderValue,
      sendWindowStart: settings.sendWindowStart,
      sendWindowEnd: settings.sendWindowEnd,
      carrierTransit: carrierTransitToText(settings.carrierTransitDays),
      merchantDigest: settings.merchantDigest,
      digestEmail: settings.digestEmail ?? "",
      flowTriggerEnabled: settings.flowTriggerEnabled,
    },
    timezone: settings.timezone ?? "UTC",
    plan: { label: plan.label, autopilot: plan.autopilot, compensation: plan.compensation },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const settings = await getSettings(session.shop);
  const plan = planFor(settings);
  const intent = form.get("intent");

  if (intent === "preview" || intent === "test") {
    const kindValue = String(form.get("kind"));
    const kind = (KINDS as string[]).includes(kindValue) ? (kindValue as MessageKind) : "delayed";
    const email = await writeDelayEmail({
      kind,
      language: String(form.get("language") || "en"),
      tone: String(form.get("tone") || settings.tone),
      storeName: cleanText(form.get("brandName"), 80) ?? settings.shopName ?? "Your store",
      orderName: "#1042",
      trackingUrl: "https://example.com/track/1042",
      carrier: "UPS",
      daysLate: 3,
      discount:
        form.get("compensationEnabled") === "true" && kind !== "delivered" && kind !== "stalled"
          ? { code: "SORRY-1A2B3C", percent: Number(form.get("compensationPercent")) || 10 }
          : null,
      signature: cleanText(form.get("signature"), 200),
      brandInstructions: cleanText(form.get("brandInstructions"), 500),
    });
    if (intent === "preview") return { preview: email };

    // F8: send the sample to the merchant (never to a customer).
    const to = cleanEmail(form.get("digestEmail")) ?? settings.digestEmail ?? settings.replyToEmail;
    if (!to) return { testError: "Add an email address under “Daily summary” first." };
    try {
      await sendEmail({
        to,
        fromName: cleanText(form.get("brandName"), 80) ?? settings.shopName ?? "Delaywise",
        replyTo: cleanEmail(form.get("replyToEmail")),
        subject: `[TEST] ${email.subject}`,
        text: email.body,
      });
      return { preview: email, testSentTo: to };
    } catch (error) {
      return { testError: error instanceof Error ? error.message : "Could not send the test email" };
    }
  }

  await db.shopSettings.update({
    where: { shop: session.shop },
    data: parseSettingsForm(form, plan),
  });
  return { saved: true };
};

type SettingsState = ReturnType<typeof useLoaderData<typeof loader>>["settings"];

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const save = useFetcher<typeof action>();
  const preview = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [s, setS] = useState<SettingsState>(data.settings);
  const [previewLang, setPreviewLang] = useState("en");
  const [previewKind, setPreviewKind] = useState("delayed");

  const set = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));
  const text = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
  const payload = () =>
    Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as Record<string, string>;
  const runPreview = (intent: "preview" | "test") =>
    preview.submit({ ...payload(), intent, language: previewLang, kind: previewKind }, { method: "post" });

  useEffect(() => {
    if (save.data && "saved" in save.data) shopify.toast.show("Settings saved");
  }, [save.data, shopify]);
  useEffect(() => {
    if (!preview.data) return;
    if ("testSentTo" in preview.data && preview.data.testSentTo) shopify.toast.show(`Test email sent to ${preview.data.testSentTo}`);
    if ("testError" in preview.data && preview.data.testError) shopify.toast.show(preview.data.testError, { isError: true });
  }, [preview.data, shopify]);

  const previewEmail = preview.data && "preview" in preview.data ? preview.data.preview : null;
  const busy = preview.state !== "idle";

  return (
    <s-page heading="Settings">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => save.submit(payload(), { method: "post" })}
        {...(save.state !== "idle" ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-section heading="Sending">
        <s-stack direction="block" gap="base">
          <s-select label="How should emails go out?" value={s.mode} onChange={(e) => set("mode", text(e))}>
            <s-option value="approval">I approve each email first (recommended to start)</s-option>
            <s-option value="autopilot" {...(data.plan.autopilot ? {} : { disabled: true })}>
              Autopilot: send automatically{data.plan.autopilot ? "" : " (paid plans)"}
            </s-option>
          </s-select>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-select label="Send emails from" value={String(s.sendWindowStart)} onChange={(e) => set("sendWindowStart", Number(text(e)))}>
              {HOURS.map((h) => (
                <s-option key={h} value={String(h)}>{hourLabel(h)}</s-option>
              ))}
            </s-select>
            <s-select label="Until" value={String(s.sendWindowEnd)} onChange={(e) => set("sendWindowEnd", Number(text(e)))}>
              {HOURS.map((h) => (
                <s-option key={h} value={String(h)}>{hourLabel(h)}</s-option>
              ))}
            </s-select>
          </s-grid>
          <s-text color="subdued">
            Your store&apos;s time zone ({data.timezone}). Autopilot emails found outside these hours wait until the
            window opens. Pick the same hour twice to send any time.
          </s-text>
          <s-select label="Tone of voice" value={s.tone} onChange={(e) => set("tone", text(e))}>
            <s-option value="friendly">Friendly</s-option>
            <s-option value="professional">Professional</s-option>
            <s-option value="playful">Playful</s-option>
          </s-select>
          <s-text-field label="Store name shown to customers" value={s.brandName} onInput={(e) => set("brandName", text(e))}></s-text-field>
          <s-email-field
            label="Reply-to email"
            details="Customer replies go here."
            value={s.replyToEmail}
            onInput={(e) => set("replyToEmail", text(e))}
          ></s-email-field>
          <s-text-field label="Sign-off" placeholder="The Acme team" value={s.signature} onInput={(e) => set("signature", text(e))}></s-text-field>
          <s-text-area
            label="Extra guidance for the writer (optional)"
            details="For example: “Mention that we offer free returns for 30 days.” Up to 500 characters."
            rows={3}
            maxLength={500}
            value={s.brandInstructions}
            onInput={(e) => set("brandInstructions", text(e))}
          ></s-text-area>
        </s-stack>
      </s-section>

      <s-section heading="When to tell the customer">
        <s-stack direction="block" gap="base">
          <s-checkbox label="Parcel has stalled (no carrier scans for a while)" checked={s.notifyOnStall} onChange={(e) => set("notifyOnStall", checked(e))}></s-checkbox>
          <s-checkbox label="Parcel is late or probably lost" checked={s.notifyOnDelay} onChange={(e) => set("notifyOnDelay", checked(e))}></s-checkbox>
          <s-checkbox label="Carrier problem or failed delivery attempt" checked={s.notifyOnException} onChange={(e) => set("notifyOnException", checked(e))}></s-checkbox>
          <s-checkbox
            label="When a late parcel finally arrives, send a short “it’s arrived, thanks for your patience” note"
            checked={s.deliveredFollowUp}
            onChange={(e) => set("deliveredFollowUp", checked(e))}
          ></s-checkbox>
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <s-number-field label="Usual delivery time (business days)" min={1} max={30} value={String(s.defaultTransitDays)} onInput={(e) => set("defaultTransitDays", Number(text(e)))}></s-number-field>
            <s-number-field label="Grace period (hours)" min={0} max={168} value={String(s.graceHours)} onInput={(e) => set("graceHours", Number(text(e)))}></s-number-field>
            <s-number-field label="Stalled after (hours without a scan)" min={24} max={336} value={String(s.stallHours)} onInput={(e) => set("stallHours", Number(text(e)))}></s-number-field>
          </s-grid>
          <s-text-field
            label="Delivery time per carrier (optional)"
            placeholder="USPS: 5, DHL Express: 2, Royal Mail: 3"
            details="Business days. Overrides the usual delivery time for these carriers."
            value={s.carrierTransit}
            onInput={(e) => set("carrierTransit", text(e))}
          ></s-text-field>
        </s-stack>
      </s-section>

      <s-section heading="Never email these orders">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Order tags"
            placeholder="wholesale, vip, no-delay-email"
            value={s.excludedTags}
            onInput={(e) => set("excludedTags", text(e))}
          ></s-text-field>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-text-field
              label="Destination countries (ISO codes)"
              placeholder="CA, MX"
              value={s.excludedCountries}
              onInput={(e) => set("excludedCountries", text(e))}
            ></s-text-field>
            <s-number-field
              label="Minimum order value"
              min={0}
              value={String(s.minOrderValue)}
              onInput={(e) => set("minOrderValue", Number(text(e)))}
            ></s-number-field>
          </s-grid>
          <s-text color="subdued">Excluded orders still show on the dashboard, but customers get no emails.</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Say sorry with a discount">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            For late or lost parcels, Delaywise can add a single-use discount code to the email. The dashboard shows how
            many codes were used and how much revenue they brought back.
          </s-paragraph>
          <s-switch
            label="Add a single-use discount code"
            checked={s.compensationEnabled}
            onChange={(e) => set("compensationEnabled", checked(e))}
            {...(data.plan.compensation ? {} : { disabled: true })}
          ></s-switch>
          {!data.plan.compensation && <s-text color="subdued">Available on paid plans.</s-text>}
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-number-field label="Discount (%)" min={1} max={50} value={String(s.compensationPercent)} onInput={(e) => set("compensationPercent", Number(text(e)))}></s-number-field>
            <s-number-field label="Only when at least this many days late" min={1} max={30} value={String(s.compensationMinDaysLate)} onInput={(e) => set("compensationMinDaysLate", Number(text(e)))}></s-number-field>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Daily summary and automations">
        <s-stack direction="block" gap="base">
          <s-checkbox
            label="Email me a daily summary when orders need attention"
            checked={s.merchantDigest}
            onChange={(e) => set("merchantDigest", checked(e))}
          ></s-checkbox>
          <s-email-field label="Summary email address" value={s.digestEmail} onInput={(e) => set("digestEmail", text(e))}></s-email-field>
          <s-checkbox
            label="Start Shopify Flow workflows when a shipment becomes at risk"
            details="In Shopify Flow, choose the trigger “Shipment at risk” to tag orders, alert your team on Slack or open a help-desk ticket."
            checked={s.flowTriggerEnabled}
            onChange={(e) => set("flowTriggerEnabled", checked(e))}
          ></s-checkbox>
        </s-stack>
      </s-section>

      <s-section heading="Preview and test">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-select label="Customer language" value={previewLang} onChange={(e) => setPreviewLang(text(e))}>
              <s-option value="en">English</s-option>
              <s-option value="es">Spanish</s-option>
              <s-option value="fr">French</s-option>
              <s-option value="de">German</s-option>
              <s-option value="it">Italian</s-option>
              <s-option value="pt">Portuguese</s-option>
              <s-option value="nl">Dutch</s-option>
              <s-option value="ja">Japanese</s-option>
              <s-option value="ar">Arabic</s-option>
              <s-option value="hi">Hindi</s-option>
            </s-select>
            <s-select label="Situation" value={previewKind} onChange={(e) => setPreviewKind(text(e))}>
              <s-option value="stalled">Stalled</s-option>
              <s-option value="delayed">Late</s-option>
              <s-option value="exception">Carrier problem</s-option>
              <s-option value="lost">Probably lost</s-option>
              <s-option value="delivered">Arrived after a delay</s-option>
            </s-select>
          </s-grid>
          <s-stack direction="inline" gap="base">
            <s-button onClick={() => runPreview("preview")} {...(busy ? { loading: true } : {})}>
              Preview
            </s-button>
            <s-button onClick={() => runPreview("test")} {...(busy ? { disabled: true } : {})}>
              Send me a test email
            </s-button>
          </s-stack>
          {previewEmail && (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-text type="strong">{previewEmail.subject}</s-text>
                <s-text>
                  <span style={{ whiteSpace: "pre-wrap" }}>{previewEmail.body}</span>
                </s-text>
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
