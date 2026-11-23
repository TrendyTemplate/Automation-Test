/**
 * Sends customer emails. Uses Resend when RESEND_API_KEY is set; otherwise
 * logs the email (development). The From address must be on a domain you
 * verified with the email provider; replies go to the store's own address.
 */

export interface OutgoingEmail {
  to: string;
  fromName: string;
  replyTo?: string | null;
  subject: string;
  text: string;
}

/** M3: a quoted display name, so "Acme, Inc." stays one sender. */
export function formatFrom(name: string, address: string): string {
  const clean = name.replace(/["\\<>\r\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Store updates";
  return `"${clean}" <${address}>`;
}

export async function sendEmail(email: OutgoingEmail): Promise<{ id: string }> {
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || "updates@example.com";
  const from = formatFrom(email.fromName, fromAddress);

  if (!process.env.RESEND_API_KEY) {
    // L3: never pretend an email went out in production.
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email sending is not configured (RESEND_API_KEY missing)");
    }
    console.log(`[email:dev] to=<redacted> from="${from}" subject="${email.subject}"`);
    return { id: `dev-${Date.now()}` };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Email provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  return { id: json.id ?? "unknown" };
}
