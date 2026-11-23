import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings, planFor } from "../services/settings.server";
import { writeDelayEmail } from "../services/ai-writer.server";
import type { NotifiableRisk } from "../lib/risk";

const clampInt = (v: FormDataEntryValue | null, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const cleanText = (v: FormDataEntryValue | null, max: number) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s.length ? s : null;
};

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
      defaultTransitDays: settings.defaultTransitDays,
      graceHours: settings.graceHours,
      stallHours: settings.stallHours,
      notifyOnStall: settings.notifyOnStall,
      notifyOnDelay: settings.notifyOnDelay,
      notifyOnException: settings.notifyOnException,
      compensationEnabled: settings.compensationEnabled,
      compensationPercent: settings.compensationPercent,
      compensationMinDaysLate: settings.compensationMinDaysLate,
    },
    plan: { label: plan.label, autopilot: plan.autopilot, compensation: plan.compensation },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const settings = await getSettings(session.shop);
  const plan = planFor(settings);

  if (form.get("intent") === "preview") {
    const kind = (["stalled", "delayed", "exception", "lost"].includes(String(form.get("kind")))
      ? String(form.get("kind"))
      : "delayed") as NotifiableRisk;
    const email = await writeDelayEmail({
      kind,
      language: String(form.get("language") || "en"),
      tone: String(form.get("tone") || settings.tone),
      storeName: cleanText(form.get("brandName"), 80) ?? settings.shopName ?? "Your store",
      orderName: "#1042",
      trackingUrl: "https://example.com/track/1042",
      carrier: "UPS",
      daysLate: 3,
      discount: form.get("compensationEnabled") === "true" ? { code: "SORRY-1A2B3C", percent: 10 } : null,
      signature: cleanText(form.get("signature"), 200),
    });
    return { preview: email };
  }

  const mode = form.get("mode") === "autopilot" && plan.autopilot ? "autopilot" : "approval";
  const tone = ["friendly", "professional", "playful"].includes(String(form.get("tone")))
    ? String(form.get("tone"))
    : "friendly";
  await db.shopSettings.update({
    where: { shop: session.shop },
    data: {
      mode,
      tone,
      brandName: cleanText(form.get("brandName"), 80),
      replyToEmail: cleanText(form.get("replyToEmail"), 200),
      signature: cleanText(form.get("signature"), 200),
      defaultTransitDays: clampInt(form.get("defaultTransitDays"), 1, 30, 5),
      graceHours: clampInt(form.get("graceHours"), 0, 168, 24),
      stallHours: clampInt(form.get("stallHours"), 24, 336, 72),
      notifyOnStall: form.get("notifyOnStall") === "true",
      notifyOnDelay: form.get("notifyOnDelay") === "true",
      notifyOnException: form.get("notifyOnException") === "true",
      compensationEnabled: plan.compensation && form.get("compensationEnabled") === "true",
      compensationPercent: clampInt(form.get("compensationPercent"), 1, 50, 10),
      compensationMinDaysLate: clampInt(form.get("compensationMinDaysLate"), 1, 30, 3),
    },
  });
  return { saved: true };
};

type SettingsState = ReturnType<typeof useLoaderData<typeof loader>>["settings"];

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

  useEffect(() => {
    if (save.data && "saved" in save.data) shopify.toast.show("Settings saved");
  }, [save.data, shopify]);

  const previewEmail = preview.data && "preview" in preview.data ? preview.data.preview : null;

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
          <s-text-field
            label="Sign-off"
            placeholder="The Acme team"
            value={s.signature}
            onInput={(e) => set("signature", text(e))}
          ></s-text-field>
        </s-stack>
      </s-section>

      <s-section heading="When to tell the customer">
        <s-stack direction="block" gap="base">
          <s-checkbox label="Parcel has stalled (no carrier scans for a while)" checked={s.notifyOnStall} onChange={(e) => set("notifyOnStall", checked(e))}></s-checkbox>
          <s-checkbox label="Parcel is late or probably lost" checked={s.notifyOnDelay} onChange={(e) => set("notifyOnDelay", checked(e))}></s-checkbox>
          <s-checkbox label="Carrier problem or failed delivery attempt" checked={s.notifyOnException} onChange={(e) => set("notifyOnException", checked(e))}></s-checkbox>
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <s-number-field label="Usual delivery time (business days)" min={1} max={30} value={String(s.defaultTransitDays)} onInput={(e) => set("defaultTransitDays", Number(text(e)))}></s-number-field>
            <s-number-field label="Grace period (hours)" min={0} max={168} value={String(s.graceHours)} onInput={(e) => set("graceHours", Number(text(e)))}></s-number-field>
            <s-number-field label="Stalled after (hours without a scan)" min={24} max={336} value={String(s.stallHours)} onInput={(e) => set("stallHours", Number(text(e)))}></s-number-field>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Say sorry with a discount">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            For late or lost parcels, Delaywise can add a single-use discount code to the email. A small gesture
            often turns an angry customer into a repeat one.
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

      <s-section heading="Preview an email">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="1fr 1fr auto" gap="base" alignItems="end">
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
            </s-select>
            <s-button
              onClick={() =>
                preview.submit({ ...payload(), intent: "preview", language: previewLang, kind: previewKind }, { method: "post" })
              }
              {...(preview.state !== "idle" ? { loading: true } : {})}
            >
              Preview
            </s-button>
          </s-grid>
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
