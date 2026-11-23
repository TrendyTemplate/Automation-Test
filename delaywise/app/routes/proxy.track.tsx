import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createHash } from "node:crypto";
import { allowDaily, dailyCount } from "../lib/rate-limit";
import { proxyPath, renderTrackPage, trackLang } from "../lib/tracking-page";
import { trackOrder } from "../services/track-lookup.server";

/**
 * T1: yourstore.com/apps/track, served through the Shopify app proxy and
 * rendered inside the store's own theme. Shopify signs every proxied request;
 * authenticate.public.appProxy rejects anything unsigned.
 */
/**
 * Limits. The visitor IP is only a hint (the forwarding header can be set by
 * the client), so the limits that matter are keyed by what is being guessed:
 * a given email can be tried against at most 10 order numbers a day, and a
 * given order number with at most 10 emails. Only failed lookups count.
 */
const PER_VISITOR_DAILY = 30;
const PER_EMAIL_DAILY = 10;
const PER_ORDER_DAILY = 10;
const PER_SHOP_FAILURES_DAILY = 3000;

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

  const hash = (v: string) => createHash("sha256").update(`${shop}|${v}`).digest("hex").slice(0, 32);
  const keys = [
    [`track:v:${hash(visitor)}`, PER_VISITOR_DAILY],
    [`track:e:${hash(emailInput.trim().toLowerCase())}`, PER_EMAIL_DAILY],
    [`track:o:${hash(orderInput.trim().replace(/^#/, "").toLowerCase())}`, PER_ORDER_DAILY],
    [`track:s:${shop}`, PER_SHOP_FAILURES_DAILY],
  ] as const;
  if (keys.some(([key, limit]) => dailyCount(key) >= limit)) {
    return respond(renderTrackPage({ kind: "error", message: "tooMany" }, lang, action, orderInput));
  }
  const recordFailure = () => keys.forEach(([key, limit]) => allowDaily(key, limit));

  try {
    const result = await trackOrder({ admin, shop, orderInput, emailInput, lang });
    if (result.kind === "error") recordFailure();
    return respond(renderTrackPage(result, lang, action, orderInput));
  } catch (error) {
    console.error(`[track] ${shop}`, error);
    recordFailure();
    return respond(renderTrackPage({ kind: "error", message: "notFound" }, lang, action, orderInput));
  }
};
