import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { supportEmail: process.env.SUPPORT_EMAIL || "" };
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "When does Delaywise email a customer?",
    a: "Only when a parcel really has a problem: no tracking update for a few days, later than promised, a carrier problem, or probably lost. Parcels that are on time never get an email. You choose how early in Settings.",
  },
  {
    q: "Will customers get emails without my OK?",
    a: "Not unless you choose “Send automatically”. By default every email waits for you on the Emails page. VIP customers always wait for you.",
  },
  {
    q: "Which languages are supported?",
    a: "Emails are written in the customer's own language, based on the language of their order. If a language isn't available, the email is in English.",
  },
  {
    q: "Where does the tracking information come from?",
    a: "From the tracking numbers on your Shopify fulfillments. If Shopify has no recent update, Delaywise asks a tracking service (included in your plan).",
  },
  {
    q: "What does a “carrier problem” alert mean?",
    a: "Several of your parcels with one carrier to one country got stuck at the same time. That's usually a strike, bad weather or a hub problem, so you can update all those customers at once.",
  },
  {
    q: "What happens to my data if I uninstall?",
    a: "Delaywise stops all emails right away. Shopify asks apps to delete a store's data 48 hours after uninstall, and Delaywise deletes everything then. Customer email addresses are never stored.",
  },
];

export default function Help() {
  const { supportEmail } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [reviewNote, setReviewNote] = useState("");

  const askForReview = async () => {
    try {
      const result = await shopify.reviews.request();
      if (!result.success) setReviewNote("Thanks! Shopify will show the review form a little later.");
    } catch {
      setReviewNote("Thanks! Shopify will show the review form a little later.");
    }
  };

  return (
    <s-page heading="Help">
      <s-section heading="How Delaywise works">
        <s-ordered-list>
          <s-list-item>Every hour, Delaywise checks the tracking of every parcel you&apos;ve shipped.</s-list-item>
          <s-list-item>
            When a parcel runs into trouble, it writes a short, honest email to that customer in their own language.
          </s-list-item>
          <s-list-item>You approve it with one click, or let it go out on its own. Your customer knows before they ask.</s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section heading="Common questions">
        <s-stack direction="block" gap="base">
          {FAQ.map((item) => (
            <s-stack key={item.q} direction="block" gap="small-300">
              <s-text type="strong">{item.q}</s-text>
              <s-paragraph color="subdued">{item.a}</s-paragraph>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Still stuck?">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {supportEmail
              ? `Write to us and a person replies within one business day.`
              : "Support contact details are being set up."}
          </s-paragraph>
          {supportEmail && (
            <s-stack direction="inline" gap="base">
              <s-button variant="primary" href={`mailto:${supportEmail}?subject=Delaywise%20help`} target="_blank">
                Email support
              </s-button>
              <s-text color="subdued">{supportEmail}</s-text>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Happy with Delaywise?">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">A short review helps other store owners find it.</s-paragraph>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={askForReview}>Leave a review</s-button>
            {reviewNote && <s-text color="subdued">{reviewNote}</s-text>}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
