/**
 * L10: deterministic checks on AI-written emails. Anything that fails falls
 * back to the fixed template, so a bad generation never reaches a customer.
 */
export interface GuardInput {
  subject: string;
  body: string;
  trackingUrl?: string | null;
  discountCode?: string | null;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

export function emailProblems(e: GuardInput): string[] {
  const problems: string[] = [];
  const subject = e.subject.trim();
  const body = e.body.trim();
  if (!subject) problems.push("empty subject");
  if (subject.length > 150 || /[\r\n]/.test(subject)) problems.push("subject too long or multi-line");
  if (body.length < 40) problems.push("body too short");
  if (body.length > 1600) problems.push("body too long");
  if (e.trackingUrl && !body.includes(e.trackingUrl)) problems.push("tracking link missing");
  if (e.discountCode && !body.includes(e.discountCode)) problems.push("discount code missing");
  const allowed = e.trackingUrl ?? "";
  for (const url of body.match(URL_RE) ?? []) {
    const clean = url.replace(/[.,;:!?]+$/, "");
    if (!allowed || clean !== allowed) problems.push(`unexpected link ${clean.slice(0, 60)}`);
  }
  if (/<\/?[a-z][^>]*>/i.test(body)) problems.push("contains HTML");
  return problems;
}
