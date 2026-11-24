# PO (PDF/Excel/email) to Shopify draft order apps: live check

Checked: 2026-11-24. Source: live `curl` fetches of apps.shopify.com listing and `/reviews` pages, plus community.shopify.com (Discourse `search.json` and `/t/<id>.json`). All figures below are copied from those pages as served on this date.

## 1. App Store searches: NOT verified

| Query | URL | Result count | Apps |
|---|---|---|---|
| purchase order to draft order | https://apps.shopify.com/search?q=purchase+order+to+draft+order | not obtained | not obtained |
| PDF to order | https://apps.shopify.com/search?q=PDF+to+order | not obtained | not obtained |
| email to order b2b | https://apps.shopify.com/search?q=email+to+order+b2b | not obtained | not obtained |
| wholesale purchase order entry | https://apps.shopify.com/search?q=wholesale+purchase+order+entry | not obtained | not obtained |

Why: the server-rendered search HTML (~100 KB) has no app cards. It only shows "We are having trouble loading your results. Try again". This happened on two separate plain-curl attempts per query, because results load client-side. WebFetch cannot resolve apps.shopify.com in this session (ENOTFOUND). The rest of this file therefore covers only the known candidate listings. No new competitors were found through search. Verifying the result counts and search ranking needs a real browser.

## 2. App listings

### Summary table

| App (handle) | Developer | Launched | Rating | Reviews | Cheapest paid price | Built for Shopify | Languages |
|---|---|---|---|---|---|---|---|
| PDF to Order by LevelOps (`levelops-email-to-order`) | LevelOps (Montréal, CA) | July 3, 2025 | 5.0 | 22 (all 5-star) | $50 one-time (15 orders); $100/mo Starter | **Yes** | English, French |
| POinbox ‑ Purchase Order Entry (`poinbox-purchase-order-entry`) | RippleStep (Pune, IN) | Sept 16, 2026 | 0.0 | **0 reviews** | $29/mo | No | English |
| POClerk: PO to Draft Order (`poclerk`) | MB Croppick (Vilnius, LT) | Aug 13, 2026 | 0.0 | **0 reviews** | $79/mo (founding $49/mo, first 100 stores) | No | English |
| Bay Order: B2B Email to Order (`bay-order-b2b`) | VegaHub Technology Inc. (Oakville, ON, CA) | Nov 16, 2026 | 0.0 | **0 reviews** | Free (only plan shown) | No | English |
| Ordwell: Auto B2B Draft Orders (`noretype`) | Nexus Logic Systems (Wilmington, DE, US) | Oct 6, 2026 | 0.0 | **0 reviews** | $50/mo (14-day trial) | No | English |
| PasteOrder: B2B & Wholesale PO (`pasteorder-1`) | Conversion Guard (Kennewick, WA, US) | Oct 15, 2026 | 0.0 | **0 reviews** | $29/mo | No | English, Portuguese (Brazil), Spanish |
| POMate: PO to Draft Order (`po-to-draft-order`) | moqify | n/a | n/a | n/a | n/a | n/a | **Delisted**: "This app is not currently available on the Shopify App Store." |
| DraftFlow (`draftflow`) | CLYDE | n/a | n/a | n/a | n/a | n/a | **Delisted**: same notice |

BFS was judged from the app's own header block only. The "More apps like this" carousels also show BFS badges for other apps, and those were ignored.

### PDF to Order by LevelOps
- URL: https://apps.shopify.com/levelops-email-to-order (reviews: https://apps.shopify.com/levelops-email-to-order/reviews)
- Tagline: "B2B purchase order automation. Email or PDF to draft order."
- Pricing, exactly as listed:
  - Free: first 5 successful orders free, no expiry; max 50,000 variants; max 50 items per order.
  - Pay as You Go: $50 one-time charge; 15 successful orders included; valid 12 months; email support.
  - Starter: $100/month or $960/year; 33 successful orders included; valid 12 months; email support.
  - Growth: $250/month or $2,400/year; up to 100 orders per month; email and chat support.
  - All plans have the 50,000-variant and 50-items-per-order limits.
- Features: no templates (PDF, Excel, CSV, email); AI product matching by SKU or description; matching to customer, company and ship-to location; B2B catalog pricing on Plus and non-Plus plans; case and unit conversion; email notification when a draft is ready; human approval of every order.
- Works with: Shopify Admin, Dynamics 365 BC, Katana, Odoo, QuickBooks, Sellercloud, ShipStation.
- Reviews: 22, all 5-star. Rating distribution: 5★ 22, 4★ 0, 3★ 0, 2★ 0, 1★ 0. **No reviews of 3 stars or lower.**
- Weaker signals inside the 5-star reviews:
  - Scrub Authority (May 4, 2026): "it was NOT ideal for us out of the box". LevelOps "worked hard over a four week period to improve the tool for our use-case", with weekly calls and Jira updates.
  - Earth Fed Muscle (May 4, 2026): support had to fix "the correct company location is assigned to the order".
  - Sol Soils (May 12, 2026): needed "a custom override… based on how we take orders".
  - Terpene Warehouse (May 18, 2026): "very few hiccups"; a 100+ item order in under 4 minutes.
  - Several reviews say entry time was "cut in half", not eliminated.
  - Reviewers are US wholesale brands (cycling, food and supplements, fabrics, countertops).

### POinbox ‑ Purchase Order Entry
- URL: https://apps.shopify.com/poinbox-purchase-order-entry
- Pricing: Free (5 successful drafts, lifetime); Starter $29/month (40 drafts/month); Growth $79/month (120 drafts/month).
- Features:
  - Reads emailed or uploaded PO files in PDF, Excel, CSV and Word.
  - Matches products and customer-specific SKUs.
  - Matches customers, B2B companies and company locations.
  - Uses catalog pricing and flags differences between PO and store prices.
  - Holds uncertain lines for review.
- Works with: Dynamics 365 BC, Katana, Odoo, QuickBooks, Sellercloud, ShipStation.
- 0 reviews ("No reviews yet").

### POClerk: PO to Draft Order
- URL: https://apps.shopify.com/poclerk
- Pricing:
  - Free: first 10 orders free, no card, no time limit, everything in Starter.
  - Starter: $79/month or $758.40/year (founding price $49/mo for the first 100 stores); 150 orders/month.
  - Growth: $149/month or $1,430.40/year (founding $99/mo); 500 orders/month; per-customer autopilot.
- Features:
  - Input by email, drag-drop, paste, or a per-customer PO link; reads PDF, Excel, CSV, scans and photos.
  - Holds uncertain lines for review ("never guessed").
  - Standing orders: sends a weekly pre-filled order sheet, and the buyer's reply becomes a draft.
  - A revised PO updates its existing order.
  - Remembers aliases per customer; applies pack rules ("2 cases" = 24); flags price mismatches.
  - Sends confirmation replies to buyers.
  - Integrates with Shopify Sidekick.
- Category: Wholesale. 0 reviews.

### Bay Order: B2B Email to Order
- URL: https://apps.shopify.com/bay-order-b2b
- Pricing: "Free" (no paid plan shown).
- Features:
  - Dedicated PO email address issued on install.
  - AI reads PDF, Word, Excel, scans and images with no templates.
  - Extracts PO number, buyer, ship-to, requested date and line items.
  - Matches SKU first, then name; maps buyers to B2B companies.
  - Custom price lists per customer with volume tiers.
  - Reports on order volume, top customers and PO revenue.
- Launched Nov 16, 2026, eight days before this check. 0 reviews.

### Ordwell: Auto B2B Draft Orders
- URL: https://apps.shopify.com/noretype
- The listing copy calls the product "Scribe" in one place.
- Pricing:
  - Free: 3 standing orders; 5 POs read per month.
  - Starter: $50/month or $500/year; 25 standing orders; 100 POs per month; 14-day free trial.
  - Growth: $100/month or $1,000/year; 150 standing orders; 500 POs per month.
  - Scale: $200/month or $2,000/year; unlimited standing orders; 2,000 POs per month; blanket POs shipped in releases; priority support.
- Features:
  - Each line checked against B2B catalog prices, stock and the account's usual order.
  - Duplicate and revised POs held for review.
  - Scheduled standing orders that the buyer can change or skip by email link.
  - Orders on payment terms or invoiced.
- Works with: Customer accounts, Shopify Flow, Shopify Admin, B2B.
- 0 reviews.

### PasteOrder: B2B & Wholesale PO
- URL: https://apps.shopify.com/pasteorder-1
- Pricing:
  - Free: 25 drafts/month; 1 scanned page/month.
  - Starter: $29/month; 300 drafts and 600 scanned pages per month.
  - Growth: $79/month; 1,500 drafts and 3,000 scanned pages per month.
  - Plus: $499/month; unlimited drafts and priority support.
- Features:
  - Paste box and drop zone inside the admin; no email inbox mentioned.
  - Confidence score per matched line ("never a made-up SKU").
  - Buyer-specific rates; stock and quantity-rule flags.
  - Case and pack to unit conversion.
  - Corrections remembered per buyer.
- 0 reviews.

## 3. Shopify Community threads (merchant pain)

Results from `community.shopify.com/search.json`. The HTML search page returned a bot block ("*waves hand* This is not the content you are looking for"). Most hits for "purchase order" are about supplier POs and the Stocky shutdown (Aug 31, 2026), not about customer POs.

1. **Idocs in Shopify**: 2026-02-21. https://community.shopify.com/t/idocs-in-shopify/589143
   A German merchant receives a customer's orders as SAP IDocs with a readable PDF. They "currently must manually create each line item from the PDF in Shopify" and found no native option.
2. **B2B order processing without a Wholesale area**: 2024-06-17 (454 views). https://community.shopify.com/t/b2b-order-processing-without-a-wholesale-area/332292
   Wholesale buyers "prefer to just email, text or call us". The non-Plus merchant wants to enter those orders in Shopify with wholesale pricing and terms, instead of the "old school" process outside Shopify.
3. **PDF data extraction to Shopify order via Make API**: 2022-12-05. https://community.shopify.com/t/pdf-data-extraction-to-shopify-order-via-make-api/173743
   The merchant built a DIY pipeline (PDFDataNet parser plus Make) to turn PDF sales orders into Shopify orders. They are stuck on setting Net 30 payment terms.
4. **Import orders from the ERP**: 2025-12-01 (380 views). https://community.shopify.com/t/import-orders-from-the-erp/577832
   A B2B merchant on Plus wants off-site orders consolidated into Shopify. They are unsure about draft orders versus the Orders API because of performance and inventory side effects.
5. **I want to open a website that only accepts purchase orders, no online payments**: 2025-05-20 (499 views). https://community.shopify.com/t/i-want-to-open-a-website-that-only-accepts-purchase-orders-no-online-payments/415251
   A trade-only site needs orders reviewed before they are accepted. Draft orders are suggested as the mechanism.
6. **How to add customer's PO to invoice**: 2023-07-22 (941 views). https://community.shopify.com/t/how-to-add-customers-po-to-invoice/234724
   Large customers require their PO numbers on invoices. No clean field exists, and notes and $0 line items do not work.
7. **B2B purchase order approval flow (employee → admin) in Shopify Grow plan**: 2026-04-25 (546 views). https://community.shopify.com/t/b2b-purchase-order-approval-flow-employee-admin-in-shopify-grow-plan/614684
   PO-style approval before an order is finalized is missing on non-Plus plans.
8. **How to set up B2B selling without using Shopify Plus?**: 2024-01-02 (3,199 views, 28 posts). https://community.shopify.com/t/how-to-set-up-b2b-selling-without-using-shopify-plus/281450
   The merchant has a ~$25/month app budget for B2B features. This is a signal of price sensitivity.

Observation: LevelOps' founder (`Maxime_Obius`) replies in many of these threads (211651, 281450, 332292, 312982, 173743, 415251, 577832) and links the app. Community seeding is part of its distribution.

## 4. Conclusions

- **Is the niche dominated? No.** No app in this niche has more than 100 reviews.
  - The leader is LevelOps PDF to Order: 22 reviews, 5.0 rating, Built for Shopify, launched July 2025.
  - Every other live candidate has 0 reviews and launched between Aug and Nov 2026: POClerk, POinbox, Ordwell, PasteOrder and Bay Order. Five new entrants in about three months show the category is crowded but unproven.
  - Two earlier entrants, POMate and DraftFlow, are already delisted.
  - Caveat: search ranking and result counts could not be verified (see section 1), so an unseen high-review app cannot be fully ruled out. None appeared in "More apps like this" on the pages fetched.
- **Gaps shown by complaints**: there are no reviews of 3 stars or lower anywhere in the set. The only evidence comes from caveats inside LevelOps' 5-star reviews and from community threads:
  - Not good "out of the box" for some formats; it needed about four weeks of vendor-side tuning or custom overrides. This is a service-heavy model.
  - Matching customers to company and ship-to location was error-prone.
  - The time saving is often "cut in half", not full automation.
  - LevelOps has hard caps: 50 items per order and 50,000 variants.
  - Non-Plus merchants lack native B2B pricing, payment terms and PO approval.
  - There is no PO-number field on invoices.
  - Price sensitivity (about $25/mo budgets) versus LevelOps' $100/mo for 33 orders.
  - Non-English and non-standard formats (SAP IDoc, German PDFs) are underserved. Only LevelOps (EN/FR) and PasteOrder (EN/PT-BR/ES) offer any non-English language.
- **Normal price range**:
  - Entry paid tiers run $29–$100/month: POinbox $29, PasteOrder $29, Ordwell $50, POClerk $79 (founding price $49), LevelOps $100 or $50 one-time.
  - Mid tiers run $79–$250/month.
  - The top tiers are $200 (Ordwell Scale) and $499 (PasteOrder Plus).
  - Every app has a free tier, usually 3–25 orders. Prices are almost always metered per order or draft.
  - Per-order cost ranges from about $3/order (LevelOps Starter) to about $0.10/order (PasteOrder Starter). Newcomers are undercutting LevelOps on price.
