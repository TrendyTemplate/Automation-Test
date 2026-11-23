/**
 * T1: the public "Track your order" page shown inside the store's theme
 * through the app proxy (yourstore.com/apps/track).
 *
 * Security: the page is returned as Liquid, so every value that isn't our
 * own fixed markup is escaped for HTML *and* Liquid (`{`, `}` and `%` become
 * entities), and the shopper's email is never echoed back.
 */
import type { ShipmentStatus } from "./status";

export type TrackLang = "en" | "es" | "fr" | "de" | "it" | "pt" | "nl";

interface Strings {
  title: string;
  intro: string;
  order: string;
  email: string;
  button: string;
  notFound: string;
  tooMany: string;
  notShipped: string;
  noTracking: string;
  parcel: string;
  expected: string;
  track: string;
  again: string;
  status: Record<"moving" | "out" | "delivered" | "problem" | "waiting" | "pickup" | "canceled", string>;
}

const T: Record<TrackLang, Strings> = {
  en: {
    title: "Track your order",
    intro: "Enter your order number and the email you used at checkout.",
    order: "Order number",
    email: "Email",
    button: "Track",
    notFound: "We couldn't find an order with that number and email. Check both and try again.",
    tooMany: "Too many tries. Please wait a little and try again.",
    notShipped: "Your order hasn't shipped yet. You'll get an email with tracking as soon as it does.",
    noTracking: "Your order has shipped. Tracking details will appear here soon.",
    parcel: "Parcel",
    expected: "Expected by",
    track: "Track with the carrier",
    again: "Track another order",
    status: {
      moving: "On its way",
      out: "Out for delivery",
      delivered: "Delivered",
      problem: "Needs attention",
      waiting: "Waiting for the carrier",
      pickup: "Ready for pickup",
      canceled: "Canceled",
    },
  },
  es: {
    title: "Sigue tu pedido",
    intro: "Introduce tu número de pedido y el correo que usaste al comprar.",
    order: "Número de pedido",
    email: "Correo electrónico",
    button: "Buscar",
    notFound: "No encontramos un pedido con ese número y correo. Revisa ambos e inténtalo de nuevo.",
    tooMany: "Demasiados intentos. Espera un poco y vuelve a intentarlo.",
    notShipped: "Tu pedido aún no se ha enviado. Recibirás un correo con el seguimiento en cuanto salga.",
    noTracking: "Tu pedido ya se envió. Los datos de seguimiento aparecerán aquí pronto.",
    parcel: "Paquete",
    expected: "Llegada prevista",
    track: "Seguir con la empresa de transporte",
    again: "Buscar otro pedido",
    status: {
      moving: "En camino",
      out: "En reparto",
      delivered: "Entregado",
      problem: "Requiere atención",
      waiting: "Esperando a la empresa de transporte",
      pickup: "Listo para recoger",
      canceled: "Cancelado",
    },
  },
  fr: {
    title: "Suivre ma commande",
    intro: "Saisissez votre numéro de commande et l'e-mail utilisé lors de l'achat.",
    order: "Numéro de commande",
    email: "E-mail",
    button: "Suivre",
    notFound: "Aucune commande trouvée avec ce numéro et cet e-mail. Vérifiez-les et réessayez.",
    tooMany: "Trop d'essais. Patientez un peu puis réessayez.",
    notShipped: "Votre commande n'est pas encore expédiée. Vous recevrez un e-mail de suivi dès son envoi.",
    noTracking: "Votre commande est expédiée. Le suivi apparaîtra ici bientôt.",
    parcel: "Colis",
    expected: "Livraison prévue",
    track: "Suivre chez le transporteur",
    again: "Suivre une autre commande",
    status: {
      moving: "En route",
      out: "En cours de livraison",
      delivered: "Livré",
      problem: "Attention requise",
      waiting: "En attente du transporteur",
      pickup: "Prêt à être retiré",
      canceled: "Annulé",
    },
  },
  de: {
    title: "Bestellung verfolgen",
    intro: "Gib deine Bestellnummer und die E-Mail-Adresse aus dem Kauf ein.",
    order: "Bestellnummer",
    email: "E-Mail",
    button: "Verfolgen",
    notFound: "Wir haben keine Bestellung mit dieser Nummer und E-Mail gefunden. Bitte prüfe beides.",
    tooMany: "Zu viele Versuche. Bitte warte kurz und versuche es erneut.",
    notShipped: "Deine Bestellung ist noch nicht versendet. Du bekommst eine E-Mail mit Sendungsverfolgung, sobald es losgeht.",
    noTracking: "Deine Bestellung ist versendet. Die Sendungsdaten erscheinen hier in Kürze.",
    parcel: "Paket",
    expected: "Erwartet bis",
    track: "Beim Versanddienst verfolgen",
    again: "Andere Bestellung verfolgen",
    status: {
      moving: "Unterwegs",
      out: "In Zustellung",
      delivered: "Zugestellt",
      problem: "Braucht Aufmerksamkeit",
      waiting: "Wartet auf den Versanddienst",
      pickup: "Abholbereit",
      canceled: "Storniert",
    },
  },
  it: {
    title: "Traccia il tuo ordine",
    intro: "Inserisci il numero d'ordine e l'email usata al momento dell'acquisto.",
    order: "Numero d'ordine",
    email: "Email",
    button: "Traccia",
    notFound: "Non troviamo un ordine con questo numero ed email. Controlla entrambi e riprova.",
    tooMany: "Troppi tentativi. Attendi un momento e riprova.",
    notShipped: "Il tuo ordine non è ancora stato spedito. Riceverai un'email con il tracciamento appena parte.",
    noTracking: "Il tuo ordine è stato spedito. Il tracciamento apparirà qui a breve.",
    parcel: "Pacco",
    expected: "Consegna prevista",
    track: "Traccia con il corriere",
    again: "Traccia un altro ordine",
    status: {
      moving: "In viaggio",
      out: "In consegna",
      delivered: "Consegnato",
      problem: "Richiede attenzione",
      waiting: "In attesa del corriere",
      pickup: "Pronto per il ritiro",
      canceled: "Annullato",
    },
  },
  pt: {
    title: "Rastrear pedido",
    intro: "Digite o número do pedido e o e-mail usado na compra.",
    order: "Número do pedido",
    email: "E-mail",
    button: "Rastrear",
    notFound: "Não encontramos um pedido com esse número e e-mail. Confira os dois e tente novamente.",
    tooMany: "Muitas tentativas. Aguarde um pouco e tente novamente.",
    notShipped: "Seu pedido ainda não foi enviado. Você receberá um e-mail com o rastreio assim que sair.",
    noTracking: "Seu pedido foi enviado. O rastreio aparecerá aqui em breve.",
    parcel: "Pacote",
    expected: "Previsão de entrega",
    track: "Rastrear na transportadora",
    again: "Rastrear outro pedido",
    status: {
      moving: "A caminho",
      out: "Saiu para entrega",
      delivered: "Entregue",
      problem: "Precisa de atenção",
      waiting: "Aguardando a transportadora",
      pickup: "Pronto para retirada",
      canceled: "Cancelado",
    },
  },
  nl: {
    title: "Bestelling volgen",
    intro: "Vul je bestelnummer in en het e-mailadres dat je bij het afrekenen gebruikte.",
    order: "Bestelnummer",
    email: "E-mail",
    button: "Volgen",
    notFound: "We vinden geen bestelling met dit nummer en e-mailadres. Controleer beide en probeer opnieuw.",
    tooMany: "Te veel pogingen. Wacht even en probeer het opnieuw.",
    notShipped: "Je bestelling is nog niet verzonden. Je krijgt een e-mail met track & trace zodra dat gebeurt.",
    noTracking: "Je bestelling is verzonden. De trackinggegevens verschijnen hier binnenkort.",
    parcel: "Pakket",
    expected: "Verwacht op",
    track: "Volgen bij de vervoerder",
    again: "Andere bestelling volgen",
    status: {
      moving: "Onderweg",
      out: "Wordt vandaag bezorgd",
      delivered: "Bezorgd",
      problem: "Vraagt aandacht",
      waiting: "Wacht op de vervoerder",
      pickup: "Klaar om op te halen",
      canceled: "Geannuleerd",
    },
  },
};

export function trackLang(code: string | null | undefined): TrackLang {
  const base = (code ?? "").toLowerCase().split(/[-_,;]/)[0].trim();
  return (base in T ? base : "en") as TrackLang;
}

export function strings(lang: TrackLang): Strings {
  return T[lang];
}

/** Escapes for HTML and neutralises Liquid delimiters. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/%/g, "&#37;");
}

/** Only http(s) links are ever rendered. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "1042", "#1042", " #1042 " → candidates to look up; null if it can't be an order name. */
export function orderNameCandidates(input: string): string[] | null {
  const v = input.trim();
  if (!/^#?[A-Za-z0-9][A-Za-z0-9_-]{0,30}$/.test(v)) return null;
  const bare = v.replace(/^#/, "");
  return [...new Set([`#${bare}`, bare])];
}

export function normalizeEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/** Proxy prefix/subpath as Shopify sends it ("/apps/track"); anything else falls back. */
export function proxyPath(value: string | null | undefined): string {
  return value && /^\/(a|apps|community|tools)\/[A-Za-z0-9_-]{1,30}$/.test(value) ? value : "/apps/track";
}

export function statusKey(status: string, risk: string): keyof Strings["status"] {
  if (status === "DELIVERED") return "delivered";
  if (status === "CANCELED") return "canceled";
  if (status === "OUT_FOR_DELIVERY") return "out";
  if (status === "PICKUP_READY") return "pickup";
  if (status === "EXCEPTION" || status === "ATTEMPTED" || risk === "exception" || risk === "lost") return "problem";
  if (status === "UNKNOWN" || status === "PRE_TRANSIT") return "waiting";
  return "moving";
}

export interface TrackParcel {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus | string;
  risk: string;
  expectedBy: Date | null;
}

export type TrackResult =
  | { kind: "form" }
  | { kind: "error"; message: "notFound" | "tooMany" }
  | {
      kind: "order";
      orderName: string;
      shipped: boolean;
      canceled?: boolean;
      parcels: TrackParcel[];
      notice: string | null;
    };

function formatDate(d: Date, lang: TrackLang): string {
  try {
    return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "long" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const STYLE = `<style>
.dw-track{max-width:560px;margin:40px auto;padding:0 16px;font:inherit;color:inherit}
.dw-track h1{margin:0 0 8px}
.dw-track p{margin:0 0 16px;line-height:1.5}
.dw-track form{display:flex;flex-direction:column;gap:12px}
.dw-track label{display:flex;flex-direction:column;gap:6px;font-weight:600}
.dw-track input{font:inherit;padding:12px;border:1px solid rgba(0,0,0,.35);border-radius:8px;min-height:44px}
.dw-track button,.dw-track .dw-btn{font:inherit;font-weight:600;padding:12px 18px;border-radius:8px;border:0;background:#1f2328;color:#fff;cursor:pointer;min-height:44px;text-decoration:none;display:inline-block;text-align:center}
.dw-card{border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:16px;margin:0 0 12px}
.dw-status{font-weight:700;font-size:1.15em;margin:0 0 4px}
.dw-muted{opacity:.75}
.dw-notice{border-radius:12px;padding:14px 16px;margin:0 0 16px;background:#fff5ea;border:1px solid #f2c28b;color:#5e3400}
.dw-error{border-radius:12px;padding:14px 16px;margin:0 0 16px;background:#fdecea;border:1px solid #f4b8b0;color:#7a1c10}
</style>`;

function formHtml(s: Strings, action: string, orderValue = ""): string {
  return `<form method="post" action="${esc(action)}" novalidate>
<label>${esc(s.order)}<input name="order" autocomplete="off" inputmode="text" maxlength="32" required value="${esc(orderValue)}" placeholder="#1001"></label>
<label>${esc(s.email)}<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
<button type="submit">${esc(s.button)}</button>
</form>`;
}

export function renderTrackPage(result: TrackResult, lang: TrackLang, action: string, orderValue = ""): string {
  const s = T[lang];
  const parts: string[] = [STYLE, `<div class="dw-track" lang="${esc(lang)}">`, `<h1>${esc(s.title)}</h1>`];

  if (result.kind !== "order") {
    parts.push(`<p class="dw-muted">${esc(s.intro)}</p>`);
    if (result.kind === "error") parts.push(`<div class="dw-error" role="alert">${esc(s[result.message])}</div>`);
    parts.push(formHtml(s, action, result.kind === "error" ? orderValue : ""));
  } else {
    parts.push(`<p class="dw-muted">${esc(result.orderName)}</p>`);
    if (result.notice) parts.push(`<div class="dw-notice" role="status">${esc(result.notice)}</div>`);
    if (result.canceled) {
      parts.push(`<div class="dw-card"><p class="dw-status">${esc(s.status.canceled)}</p></div>`);
    } else if (!result.parcels.length) {
      parts.push(`<div class="dw-card"><p>${esc(result.shipped ? s.noTracking : s.notShipped)}</p></div>`);
    }
    if (!result.canceled) result.parcels.forEach((p, i) => {
      const label = s.status[statusKey(p.status, p.risk)];
      const link = safeUrl(p.trackingUrl);
      const meta = [p.carrier, p.trackingNumber].filter(Boolean).map(esc).join(" · ");
      parts.push(
        `<div class="dw-card">`,
        result.parcels.length > 1 ? `<p class="dw-muted">${esc(s.parcel)} ${i + 1}</p>` : "",
        `<p class="dw-status">${esc(label)}</p>`,
        meta ? `<p class="dw-muted">${meta}</p>` : "",
        p.expectedBy && p.status !== "DELIVERED" ? `<p>${esc(s.expected)}: ${esc(formatDate(p.expectedBy, lang))}</p>` : "",
        link ? `<a class="dw-btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(s.track)}</a>` : "",
        `</div>`,
      );
    });
    parts.push(`<p><a href="${esc(action)}">${esc(s.again)}</a></p>`);
  }
  parts.push(`</div>`);
  return parts.join("\n");
}
