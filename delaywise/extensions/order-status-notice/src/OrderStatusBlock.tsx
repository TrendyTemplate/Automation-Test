import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { APP_URL } from "./config";

interface Notice {
  kind: "stalled" | "delayed" | "exception" | "lost";
  text: string;
  trackingUrl: string | null;
}

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const orderId = shopify.order.value?.id;
  const language = shopify.localization.language.value.isoCode;

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await shopify.sessionToken.get();
        const url = `${APP_URL}/api/order-status?orderId=${encodeURIComponent(orderId)}&lang=${encodeURIComponent(language)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = (await res.json()) as { notice: Notice | null };
        if (!cancelled) setNotice(data.notice);
      } catch {
        // Never break the order page; just show nothing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, language]);

  if (!notice) return null;
  const t = (key: string) => String(shopify.i18n.translate(key));
  return (
    <s-banner heading={t(`heading.${notice.kind}`)} tone={notice.kind === "stalled" ? "info" : "warning"}>
      <s-stack direction="block" gap="small-200">
        <s-text>{notice.text}</s-text>
        {notice.trackingUrl && <s-link href={notice.trackingUrl}>{t("track")}</s-link>}
      </s-stack>
    </s-banner>
  );
}
