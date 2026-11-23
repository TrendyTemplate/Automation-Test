import styles from "./_index/styles.module.css";

// Public privacy policy, linked from the App Store listing.
// Replace the bracketed company details before submitting.
export default function Privacy() {
  return (
    <div className={styles.index}>
      <div className={styles.content} style={{ textAlign: "left", maxWidth: 760 }}>
        <h1 className={styles.heading}>Delaywise privacy policy</h1>
        <p>Last updated: November 2026</p>
        <p>
          Delaywise (“the App”) is provided by [YOUR COMPANY NAME], [ADDRESS] (“we”). This policy explains what data
          the App processes when a merchant installs it on a Shopify store.
        </p>
        <h2>What we access and why</h2>
        <ul>
          <li>
            <strong>Orders and fulfillments</strong> (order number, order total, customer language, destination
            country, carrier, tracking number and tracking status), to detect late or stalled parcels.
          </li>
          <li>
            <strong>Customer email address</strong>, read from Shopify only at the moment a shipping update is sent,
            to deliver that email. We do not store customer email addresses, names, phone numbers or street
            addresses.
          </li>
          <li>
            <strong>Discounts</strong>: if the merchant turns on apology discounts, the App creates single-use
            discount codes in the merchant’s store.
          </li>
          <li>
            <strong>Store details</strong> (store name, contact email, country, time zone), to set up the App and
            send the merchant an optional daily summary.
          </li>
        </ul>
        <h2>Service providers</h2>
        <ul>
          <li>Anthropic (Claude API), to write the text of shipping-update emails. No customer contact details are sent.</li>
          <li>Ship24, to look up carrier tracking status using tracking numbers, when Shopify has no tracking data.</li>
          <li>Our email delivery provider, to send the emails the merchant approves or enables.</li>
          <li>
            Klaviyo, only if the merchant connects their own Klaviyo account: shipment events, including the
            customer&apos;s email address, are sent to the merchant&apos;s Klaviyo account. The merchant&apos;s API key is
            stored encrypted.
          </li>
          <li>Our hosting and database provider.</li>
        </ul>
        <h2>Retention and deletion</h2>
        <p>
          Shipment records are deleted 90 days after shipping and email records after 180 days. When a merchant
          uninstalls the App, we stop all
          processing, and we delete all of the store’s data when Shopify sends the shop data erasure request (48 hours
          after uninstall). We honour customer data erasure requests from Shopify by deleting the related order
          records.
        </p>
        <h2>Your rights</h2>
        <p>
          Customers of a store should contact the store directly. Merchants can contact us at [SUPPORT EMAIL] for
          access, correction or deletion requests.
        </p>
      </div>
    </div>
  );
}
