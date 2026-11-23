import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

// Public landing page. Installs happen from the Shopify App Store, so there is
// intentionally no "enter your shop domain" form here (App Store requirement).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export default function Landing() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Delaywise: tell customers about late parcels before they ask</h1>
        <p className={styles.text}>
          Delaywise watches every shipment. When a parcel stalls, runs late or hits a carrier problem, it sends your
          customer a short, friendly update in their own language, with an optional apology discount.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Early warning</strong>. Spots stalled parcels days before the delivery date passes.
          </li>
          <li>
            <strong>Speaks your customer’s language</strong>. Natural emails in dozens of languages, in your brand’s
            tone. You approve each one or switch on Autopilot.
          </li>
          <li>
            <strong>Carrier scorecard</strong>. See which carriers keep their promises and how much order value is at
            risk right now.
          </li>
        </ul>
        <p className={styles.text}>
          <a href="/privacy">Privacy policy</a>
        </p>
      </div>
    </div>
  );
}
