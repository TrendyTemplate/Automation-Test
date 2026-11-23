import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { allowDaily } from "../lib/rate-limit";
import { proxyPath, renderTrackPage, trackLang } from "../lib/tracking-page";
import { trackOrder } from "../services/track-lookup.server";

/**
 * T1: yourstore.com/apps/track, served through the Shopify app proxy and
 * rendered inside the store's own theme. Shopify signs every proxied request;
 * authenticate.public.appProxy rejects anything unsigned.
 */
const PER_VISITOR_DAILY = 30;
const PER_SHOP_DAILY = 5000;

function pageFor(request: Request) {
  const url = new URL(request.url);
  return {
    action: proxyPath(url.searchParams.get("path_prefix")),
    lang: trackLang(request.headers.get("accept-language")),
  };
}

const NO_STORE = { "Cache-Control": "private, no-store" };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid } = await authenticate.public.appProxy(request);
  const { action, lang } = pageFor(request);
  return liquid(renderTrackPage({ kind: "form" }, lang, action), { layout: true, headers: NO_STORE });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { liquid, admin, session } = await authenticate.public.appProxy(request);
  const { action, lang } = pageFor(request);
  const form = await request.formData();
  const orderInput = String(form.get("order") ?? "").slice(0, 64);
  const emailInput = String(form.get("email") ?? "").slice(0, 254);
  const shop = session?.shop ?? new URL(request.url).searchParams.get("shop") ?? "unknown";
  const visitor = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

  const respond = (html: string) => liquid(html, { layout: true, headers: NO_STORE });

  if (!allowDaily(`track:${shop}:${visitor}`, PER_VISITOR_DAILY) || !allowDaily(`track:${shop}`, PER_SHOP_DAILY)) {
    return respond(renderTrackPage({ kind: "error", message: "tooMany" }, lang, action, orderInput));
  }
  try {
    const result = await trackOrder({ admin, shop, orderInput, emailInput, lang });
    return respond(renderTrackPage(result, lang, action, orderInput));
  } catch (error) {
    console.error(`[track] ${shop}`, error);
    return respond(renderTrackPage({ kind: "error", message: "notFound" }, lang, action, orderInput));
  }
};
