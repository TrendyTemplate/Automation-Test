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
import { PRESETS, isPresetId, presetValues, type PresetId } from "../lib/presets";
import { PREVIEW_DAILY_LIMIT, TEST_EMAIL_DAILY_LIMIT, allowDaily } from "../lib/rate-limit";
import { encryptSecret, encryptionAvailable, maskSecret } from "../lib/crypto";
import { klaviyoKeyFor } from "../services/klaviyo-events.server";
import { looksLikeKlaviyoPrivateKey } from "../services/klaviyo.server";
import { actorFrom, audit, changedKeys } from "../services/audit.server";

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
      extraTransitDays: settings.extraTransitDays,
      merchantDigest: settings.merchantDigest,
      digestEmail: settings.digestEmail ?? "",
      flowTriggerEnabled: settings.flowTriggerEnabled,
      orderStatusNotice: settings.orderStatusNotice,
      preset: settings.preset,
      vipTags: settings.vipTags ?? "",
      vipMinOrderValue: settings.vipMinOrderValue,
      incidentThreshold: settings.incidentThreshold,
    },
    timezone: settings.timezone ?? "UTC",
    klaviyo: {
      connected: Boolean(settings.klaviyoApiKeyEnc),
      masked: maskSecret(klaviyoKeyFor({ ...settings, klaviyoEnabled: true })),
      // M11: a stored key we can no longer decrypt (e.g. rotated server key).
      broken: Boolean(settings.klaviyoApiKeyEnc) && !klaviyoKeyFor({ ...settings, klaviyoEnabled: true }),
      canStoreKeys: encryptionAvailable(),
    },
    plan: { label: plan.label, autopilot: plan.autopilot, compensation: plan.compensation },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const actor = actorFrom(sessionToken);
  const form = await request.formData();
  const settings = await getSettings(session.shop);
  const plan = planFor(settings);
  const intent = form.get("intent");

  // R3: connect / disconnect Klaviyo. The key is encrypted and never sent back.
  if (intent === "klaviyo_connect") {
    const key = String(form.get("klaviyoKey") ?? "").trim();
    if (!looksLikeKlaviyoPrivateKey(key)) return { klaviyoError: "That doesn't look like a Klaviyo private API key (it starts with pk_)." };
    if (!encryptionAvailable()) return { klaviyoError: "Secure key storage isn't configured on the server yet." };
    await db.shopSettings.update({
      where: { shop: session.shop },
      data: { klaviyoEnabled: true, klaviyoApiKeyEnc: encryptSecret(key, session.shop) },
    });
    await audit(session.shop, actor, "Klaviyo connected");
    return { klaviyoConnected: true };
  }
  if (intent === "klaviyo_disconnect") {
    await db.shopSettings.update({
      where: { shop: session.shop },
      data: { klaviyoEnabled: false, klaviyoApiKeyEnc: null },
    });
    await audit(session.shop, actor, "Klaviyo disconnected");
    return { klaviyoDisconnected: true };
  }

  if (intent === "preview" || intent === "test") {
    // M6: previews call the AI and tests send real email, so both are limited.
    if (!allowDaily(`${session.shop}:preview`, PREVIEW_DAILY_LIMIT)) {
      return { testError: "Daily preview limit reached. Try again tomorrow." };
    }
    if (intent === "test" && !allowDaily(`${session.shop}:test`, TEST_EMAIL_DAILY_LIMIT)) {
      return { testError: "Daily test email limit reached. Try again tomorrow." };
    }
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

    // F8 + M6: tests only ever go to the store's own saved address.
    const to = settings.digestEmail ?? settings.replyToEmail;
    if (!to) return { testError: "Save a summary email address under “Daily summary” first." };
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

  const next = parseSettingsForm(form, plan);
  await db.shopSettings.update({ where: { shop: session.shop }, data: next });
  const changed = changedKeys(settings as unknown as Record<string, unknown>, next);
  if (changed.length) await audit(session.shop, actor, "Settings changed", changed.join(", "));
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
  const klaviyo = useFetcher<typeof action>();
  const [klaviyoKey, setKlaviyoKey] = useState("");

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

  useEffect(() => {
    const d = klaviyo.data;
    if (!d) return;
    if ("klaviyoConnected" in d) shopify.toast.show("Klaviyo connected");
    if ("klaviyoDisconnected" in d) shopify.toast.show("Klaviyo disconnected");
    if ("klaviyoError" in d && d.klaviyoError) shopify.toast.show(d.klaviyoError, { isError: true });
  }, [klaviyo.data, shopify]);

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

      <s-section heading="The basics">
        <s-stack direction="block" gap="base">
          <s-select
            label="How often customers hear from you"
            details={isPresetId(s.preset) ? PRESETS[s.preset].description : "You've fine-tuned the timing under “When to email”."}
            value={isPresetId(s.preset) ? s.preset : "custom"}
            onChange={(e) => {
              const id = text(e);
              if (isPresetId(id)) setS((prev) => ({ ...prev, ...presetValues(id as PresetId), preset: id }));
            }}
          >
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <s-option key={id} value={id}>
                {PRESETS[id].label}
              </s-option>
            ))}
            <s-option value="custom" disabled>
              Custom
            </s-option>
          </s-select>
          <s-select
            label="How emails go out"
            details="VIP customers always wait for you."
            value={s.mode}
            onChange={(e) => set("mode", text(e))}
          >
            <s-option value="approval">I approve each one</s-option>
            <s-option value="autopilot" {...(data.plan.autopilot ? {} : { disabled: true })}>
              {`Send automatically${data.plan.autopilot ? "" : " (paid plans)"}`}
            </s-option>
          </s-select>
          <s-text-field label="Store name shown to customers" value={s.brandName} onInput={(e) => set("brandName", text(e))}></s-text-field>
          <s-text-field label="Sign emails as" placeholder="The Acme team" value={s.signature} onInput={(e) => set("signature", text(e))}></s-text-field>
          <s-email-field
            label="Send my daily summary to"
            details="Only on days when something needs you. Leave empty to turn it off."
            value={s.digestEmail}
            onInput={(e) => {
              const v = text(e);
              setS((prev) => ({ ...prev, digestEmail: v, merchantDigest: v.trim() !== "" }));
            }}
          ></s-email-field>
        </s-stack>
      </s-section>

      <s-heading>More options</s-heading>

      <More title="Sending hours and tone" summary={`${hourLabel(s.sendWindowStart)} to ${hourLabel(s.sendWindowEnd)} · ${s.tone}`}>
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
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
            Your store&apos;s time zone ({data.timezone}). Pick the same hour twice to send any time.
          </s-text>
          <s-select label="Tone of voice" value={s.tone} onChange={(e) => set("tone", text(e))}>
            <s-option value="friendly">Friendly</s-option>
            <s-option value="professional">Professional</s-option>
            <s-option value="playful">Playful</s-option>
          </s-select>
          <s-email-field
            label="Reply-to email"
            details="Customer replies go here."
            value={s.replyToEmail}
            onInput={(e) => set("replyToEmail", text(e))}
          ></s-email-field>
          <s-text-area
            label="Anything the emails should always mention (optional)"
            details="For example: “We offer free returns for 30 days.” Up to 500 characters."
            rows={3}
            maxLength={500}
            value={s.brandInstructions}
            onInput={(e) => set("brandInstructions", text(e))}
          ></s-text-area>
        </s-stack>
      </More>

      <More title="When to email" summary={`Usual delivery ${s.defaultTransitDays} business days${s.extraTransitDays ? ` + ${s.extraTransitDays} holiday days` : ""}`}>
        <s-stack direction="block" gap="base">
          <s-checkbox label="Parcel has stalled (no carrier scans for a while)" checked={s.notifyOnStall} onChange={(e) => { set("notifyOnStall", checked(e)); set("preset", "custom"); }}></s-checkbox>
          <s-checkbox label="Parcel is late or probably lost" checked={s.notifyOnDelay} onChange={(e) => { set("notifyOnDelay", checked(e)); set("preset", "custom"); }}></s-checkbox>
          <s-checkbox label="Carrier problem or failed delivery attempt" checked={s.notifyOnException} onChange={(e) => { set("notifyOnException", checked(e)); set("preset", "custom"); }}></s-checkbox>
          <s-checkbox
            label="When a late parcel finally arrives, send a short “it’s arrived, thanks for your patience” note"
            checked={s.deliveredFollowUp}
            onChange={(e) => set("deliveredFollowUp", checked(e))}
          ></s-checkbox>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <s-number-field label="Usual delivery time (business days)" min={1} max={30} value={String(s.defaultTransitDays)} onInput={(e) => set("defaultTransitDays", Number(text(e)))}></s-number-field>
            <s-number-field label="Grace period (hours)" min={0} max={168} value={String(s.graceHours)} onInput={(e) => { set("graceHours", Number(text(e))); set("preset", "custom"); }}></s-number-field>
            <s-number-field label="Stalled after (hours without a scan)" min={24} max={336} value={String(s.stallHours)} onInput={(e) => { set("stallHours", Number(text(e))); set("preset", "custom"); }}></s-number-field>
          </s-grid>
          <s-text-field
            label="Delivery time per carrier (optional)"
            placeholder="USPS: 5, DHL Express: 2, Royal Mail: 3"
            details="Business days. Overrides the usual delivery time for these carriers."
            value={s.carrierTransit}
            onInput={(e) => set("carrierTransit", text(e))}
          ></s-text-field>
          <s-number-field
            label="Holiday buffer (extra business days)"
            details="Add 1–3 days during peak season or carrier strikes so normal seasonal slowness doesn't trigger warnings. Set back to 0 afterwards."
            min={0}
            max={14}
            value={String(s.extraTransitDays)}
            onInput={(e) => set("extraTransitDays", Number(text(e)))}
          ></s-number-field>
        </s-stack>
      </More>

      <More title="VIP customers and carrier problems" summary={s.vipTags || s.vipMinOrderValue ? `VIP: ${[s.vipTags, s.vipMinOrderValue ? `orders over ${s.vipMinOrderValue}` : ""].filter(Boolean).join(" or ")}` : "No VIP rule yet"}>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            VIP orders always wait for your approval, even on Autopilot, so a person handles your best customers.
          </s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
            <s-text-field label="VIP order tags" placeholder="vip" value={s.vipTags} onInput={(e) => set("vipTags", text(e))}></s-text-field>
            <s-number-field
              label="…or order value of at least"
              min={0}
              value={String(s.vipMinOrderValue)}
              onInput={(e) => set("vipMinOrderValue", Number(text(e)))}
            ></s-number-field>
          </s-grid>
          <s-number-field
            label="Call it a carrier incident when this many parcels with one carrier to one country run into trouble within 3 days"
            min={2}
            max={50}
            value={String(s.incidentThreshold)}
            onInput={(e) => set("incidentThreshold", Number(text(e)))}
          ></s-number-field>
        </s-stack>
      </More>

      <More title="Never email these orders" summary={[s.excludedTags, s.excludedCountries].filter(Boolean).join(" · ") || "None"}>
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Order tags"
            placeholder="wholesale, vip, no-delay-email"
            value={s.excludedTags}
            onInput={(e) => set("excludedTags", text(e))}
          ></s-text-field>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
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
      </More>

      <More title="Sorry discount" summary={s.compensationEnabled ? `${s.compensationPercent}% off, once per order` : "Off"}>
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
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
            <s-number-field label="Discount (%)" min={1} max={50} value={String(s.compensationPercent)} onInput={(e) => set("compensationPercent", Number(text(e)))}></s-number-field>
            <s-number-field label="Only when at least this many days late" min={1} max={30} value={String(s.compensationMinDaysLate)} onInput={(e) => set("compensationMinDaysLate", Number(text(e)))}></s-number-field>
          </s-grid>
        </s-stack>
      </More>

      <More title="Shopify Flow and the order page" summary={[s.flowTriggerEnabled ? "Flow on" : "Flow off", s.orderStatusNotice ? "order page notice on" : "order page notice off"].join(" · ")}>
        <s-stack direction="block" gap="base">
          <s-checkbox
            label="Start Shopify Flow workflows when a shipment becomes at risk"
            details="In Shopify Flow, choose the trigger “Shipment at risk” to tag orders, alert your team on Slack or open a help-desk ticket."
            checked={s.flowTriggerEnabled}
            onChange={(e) => set("flowTriggerEnabled", checked(e))}
          ></s-checkbox>
          <s-checkbox
            label="Show a delivery update on the customer's order page"
            details="Add the “Delivery update” block in Settings → Customer accounts → Customize. It appears only when a parcel is confirmed late, stalled, stuck or lost."
            checked={s.orderStatusNotice}
            onChange={(e) => set("orderStatusNotice", checked(e))}
          ></s-checkbox>
        </s-stack>
      </More>

      <More title="Klaviyo" summary={data.klaviyo.connected ? "Connected" : "Not connected"}>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Send “Delaywise Shipment At Risk” and “Delaywise Delayed Shipment Delivered” events to your Klaviyo
            account, then build your own branded flows there. Use a private API key with the Events: write scope.
          </s-paragraph>
          {data.klaviyo.broken && (
            <s-banner tone="warning" heading="Reconnect Klaviyo">
              Delaywise can no longer read your saved Klaviyo key, so no events are being sent. Disconnect and connect
              again with your private API key.
            </s-banner>
          )}
          {data.klaviyo.connected ? (
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-badge tone="success">{`Connected (${data.klaviyo.masked || "key stored"})`}</s-badge>
              <s-button
                tone="critical"
                onClick={() => klaviyo.submit({ intent: "klaviyo_disconnect" }, { method: "post" })}
                {...(klaviyo.state !== "idle" ? { loading: true } : {})}
              >
                Disconnect
              </s-button>
            </s-stack>
          ) : data.klaviyo.canStoreKeys ? (
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
              <s-password-field
                label="Klaviyo private API key"
                placeholder="pk_…"
                value={klaviyoKey}
                onInput={(e) => setKlaviyoKey(text(e))}
              ></s-password-field>
              <s-button
                onClick={() => {
                  klaviyo.submit({ intent: "klaviyo_connect", klaviyoKey }, { method: "post" });
                  setKlaviyoKey("");
                }}
                {...(klaviyo.state !== "idle" ? { loading: true } : {})}
              >
                Connect
              </s-button>
            </s-grid>
          ) : (
            <s-text color="subdued">Klaviyo connection isn’t available yet on this server.</s-text>
          )}
        </s-stack>
      </More>

      <More title="See an example email" summary={"Any language, or send a test to yourself"}>
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
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
              Send a test to my saved summary address
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
      </More>

      <s-section>
        <s-link href="/app/activity">See who changed what (activity log)</s-link>
      </s-section>
    </s-page>
  );
}

/** A collapsed settings group: one line with the current value, opens on click. */
function More({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-clickable onClick={() => setOpen((v) => !v)} accessibilityLabel={`${open ? "Close" : "Change"} ${title}`}>
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">{title}</s-text>
              <s-text color="subdued">{summary}</s-text>
            </s-stack>
            <s-text color="subdued">{open ? "Close" : "Change"}</s-text>
          </s-grid>
        </s-clickable>
        {open && children}
      </s-stack>
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
