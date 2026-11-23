import { baseLanguage } from "./language";
import { isAtRisk, riskRank, type NotifiableRisk } from "./risk";
import { noticeLine } from "./templates";

/**
 * R4: what to show on the customer's order-status page. Only shipments the
 * app is confident about (carrier-confirmed risk), never excluded orders.
 */
export interface NoticeShipment {
  risk: string;
  status: string;
  excluded: boolean;
  trackingUrl: string | null;
  customerLocale: string | null;
}

export interface CustomerNotice {
  kind: NotifiableRisk;
  text: string;
  language: string;
  trackingUrl: string | null;
}

export function customerNotice(
  shipments: NoticeShipment[],
  viewerLanguage: string | null | undefined,
): CustomerNotice | null {
  const candidates = shipments.filter(
    (s) => !s.excluded && isAtRisk(s.risk) && s.status !== "DELIVERED" && s.status !== "CANCELED",
  );
  if (!candidates.length) return null;
  const worst = candidates.sort((a, b) => riskRank(b.risk) - riskRank(a.risk))[0];
  const kind = worst.risk as NotifiableRisk;
  const { text, language } = noticeLine(kind, baseLanguage(viewerLanguage ?? worst.customerLocale));
  return { kind, text, language, trackingUrl: worst.trackingUrl };
}
