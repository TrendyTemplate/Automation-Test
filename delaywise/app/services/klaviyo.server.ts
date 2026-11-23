/**
 * R3: optional Klaviyo integration. Sends "Delaywise Shipment At Risk" and
 * "Delaywise Delayed Shipment Delivered" events to the merchant's own Klaviyo
 * account (with their private API key), so they can run branded flows there.
 *
 * Verify the request shape against Klaviyo's current Events API docs before
 * launch: https://developers.klaviyo.com/en/reference/create_event
 */

const ENDPOINT = "https://a.klaviyo.com/api/events";
const REVISION = "2024-10-15";

export const KLAVIYO_METRICS = {
  atRisk: "Delaywise Shipment At Risk",
  delivered: "Delaywise Delayed Shipment Delivered",
} as const;

export interface KlaviyoEvent {
  metric: string;
  email: string;
  uniqueId: string;
  time: Date;
  properties: Record<string, string | number | boolean | null>;
}

export function klaviyoBody(e: KlaviyoEvent) {
  return {
    data: {
      type: "event",
      attributes: {
        properties: e.properties,
        time: e.time.toISOString(),
        unique_id: e.uniqueId,
        metric: { data: { type: "metric", attributes: { name: e.metric } } },
        profile: { data: { type: "profile", attributes: { email: e.email } } },
      },
    },
  };
}

export function looksLikeKlaviyoPrivateKey(key: string): boolean {
  return /^pk_[A-Za-z0-9]{20,}$/.test(key.trim());
}

export async function sendKlaviyoEvent(apiKey: string, event: KlaviyoEvent): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: REVISION,
      accept: "application/vnd.api+json",
      "content-type": "application/vnd.api+json",
    },
    body: JSON.stringify(klaviyoBody(event)),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status !== 202 && !res.ok) {
    throw new Error(`Klaviyo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
