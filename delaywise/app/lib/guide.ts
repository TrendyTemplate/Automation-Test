/**
 * The short "Finish setting up" checklist on the home page (Shopify's
 * setup guide pattern). Some steps tick themselves; the rest the merchant
 * ticks. It disappears once everything is done or the merchant hides it.
 */
export type GuideStepId = "summary" | "notice" | "test" | "tracking";

export interface GuideStep {
  id: GuideStepId;
  title: string;
  detail: string;
  action: { label: string; href: string; external?: boolean };
  done: boolean;
}

export interface GuideInput {
  guideDone: string | null;
  digestEmail: string | null;
  orderStatusNotice: boolean;
  /** The store's tracking page, e.g. https://acme.myshopify.com/apps/track */
  trackUrl?: string;
}

export function parseGuideDone(raw: string | null): Set<string> {
  return new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export function addGuideDone(raw: string | null, id: string): string {
  const set = parseGuideDone(raw);
  set.add(id);
  return [...set].join(",").slice(0, 200);
}

export function guideSteps(input: GuideInput): GuideStep[] {
  const done = parseGuideDone(input.guideDone);
  const steps: GuideStep[] = [
    {
      id: "summary",
      title: "Get a daily summary by email",
      detail: "One short email on days when something needs you. Nothing on quiet days.",
      action: { label: "Add my email", href: "/app/settings" },
      done: Boolean(input.digestEmail?.trim()) || done.has("summary"),
    },
    {
      id: "test",
      title: "See what your customers will get",
      detail: "Look at an example email in any language, or send one to yourself.",
      action: { label: "See an example", href: "/app/settings" },
      done: done.has("test"),
    },
    {
      id: "tracking",
      title: "Add the tracking page to your store",
      detail: `Customers type their order number and email to see where their parcel is. Add ${input.trackUrl ?? "/apps/track"} to your store menu.`,
      action: { label: "Open navigation", href: "shopify://admin/menus", external: true },
      done: done.has("tracking"),
    },
  ];
  if (input.orderStatusNotice) {
    steps.splice(2, 0, {
      id: "notice",
      title: "Show delivery updates on the order page",
      detail: "Add the “Delivery update” block in your customer account editor. It only shows when a parcel is late.",
      action: { label: "Open customer accounts", href: "shopify://admin/settings/customer_accounts", external: true },
      done: done.has("notice"),
    });
  }
  return steps;
}

export function guideVisible(input: GuideInput): boolean {
  if (parseGuideDone(input.guideDone).has("hidden")) return false;
  return guideSteps(input).some((s) => !s.done);
}
