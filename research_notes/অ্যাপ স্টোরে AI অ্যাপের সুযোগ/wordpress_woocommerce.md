# WordPress / WooCommerce AI Plugin Opportunities (late 2026) for a Bangladesh-based solo founder

**Method and source-quality note:** Direct page fetches were blocked in this environment. freemius.com, developer.woocommerce.com, digitalapplied.com and api.wordpress.org all failed DNS resolution. So all findings below come from WebSearch result summaries, not from full-page reads. I could not pull live active-install counts, ratings or support-forum data from WordPress.org. Treat install, rating and complaint claims as unverified until someone checks the live wordpress.org pages. Many sources are vendor-written (Freemius, WPML, Payoneer, plugin listings), and I flag them where it matters. The research was done 2026-11-22.

## Q1: Which AI plugin niches show real demand and weak competition? What can be learned from Bangladeshi WP companies?

### Takeaway
Every AI niche I checked is crowded with new, low-review entrants rather than being empty. These include chatbots, product descriptions, semantic search, accessibility/alt-text and translation. The openings are in quality and depth: plugins that safely take real WooCommerce actions, plugins aimed at a regulatory deadline (EAA accessibility), and plugins that sit on the new WP 7.0 and Woo MCP plumbing. "Generic AI content" is not an opening. The Bangladeshi playbook (weDevs and others) is a free WordPress.org plugin, paid add-ons/pro, and then hosted SaaS for recurring revenue.

### Cited Findings
**AI customer support / order actions (WooCommerce)**
- Many WooCommerce AI chatbot plugins claim order-status lookup: onWebChat (live order data), Storebird (order number or email), BeastThemes AI Support (order number + billing email, and explicitly does not let the model invent status), and WebExpertDev (order number + email/ZIP, but no AI model or hosted desk of its own). — [WordPress.org search results summary](https://wordpress.org/plugins/onwebchat/); [Helpmate](https://wordpress.org/plugins/helpmate-ai-chatbot/); [NHB SupportBot](https://wordpress.org/plugins/nhb-supportbot/); [ChatPod AI](https://wordpress.org/plugins/chatpod-ai/)
- Few plugins actually execute refunds. Kognit for WooCommerce issues refunds from its own inbox via WooCommerce REST API read/write keys and relies on external cloud services. Helpmate lists "Refund & Return in Chat Window" but doesn't explain how. Several others only explain refund policy. — [search summary of wordpress.org listings](https://wordpress.org/plugins/helpmate-ai-chatbot/); [Polyreply for WooCommerce](https://wordpress.org/plugins/polyreply-for-woocommerce/?output_format=md)
- WooCommerce's own "AI Support Assistant" documentation is about matching questions to policy pages, not executing actions. — [WooCommerce docs](https://woocommerce.com/document/ai-customer-support/)
- Several of these chatbot listings show "no reviews for this plugin", which suggests many new entrants with little traction yet. — [search summary](https://wordpress.org/plugins/chatpod-ai/) (source quality: search snippet)

**AI product descriptions / product data**
- The `ai-product-description` tag has many entrants: RankHigh, jcodex AI Product Generator, MyStoreForge, DraftLab AI bulk generator, Digital Ebene AI, ProdScribe AI, ShopWriter Lite, CatalogPilot. — [WordPress.org tag page](https://wordpress.org/plugins/tags/ai-product-description/); [jcodex](https://wordpress.org/plugins/jcodex-ai-product-generator-for-woocommerce/); [DraftLab](https://wordpress.org/plugins/draftlab-ai-bulk-description-generator-woocommerce/)
- An example of low traction: "AI Product Tools" (Dogu Pekgoz) shows a 4.7 rating, about 400–500 active installs and about 13.5k downloads after about 2 years. — [WordPress.org API snapshot via search](https://pan.wordpress.org/plugins/wp-json/wp/v2/plugin/192536); [wphive](https://wphive.com/plugins/ai-product-tools/) (the two snapshots differ slightly)

**AI search (semantic product search)**
- Several entrants are active in 2026. Queryra "AI Search for WooCommerce – Semantic Search" was updated March 2026 and is an early WP 7.0 connector. `ai-search` was at v1.25.0 in May 2026. FindAstra has 1 review and a local engine. Appinio Search is another. WooCommerce.com sells "AI Semantic Search", which requires an OpenAI key. — [Queryra](https://wordpress.org/plugins/queryra-ai-search/); [ai-search](https://wordpress.org/plugins/ai-search/); [FindAstra](https://wordpress.org/plugins/findastra/); [Woo AI Semantic Search](https://woocommerce.com/document/ai-semantic-search/)
- An indie WooCommerce AI-search launch reported $0 MRR and 85+ downloads three weeks in. — [Indie Hackers / search summary](https://www.indiehackers.com/Queryra/history/2) (self-reported)

**Accessibility (EAA-driven)**
- The European Accessibility Act has applied since 28 June 2025. WooCommerce core worked toward WCAG 2.2 because of the deadline. — [WooCommerce developer blog](https://developer.woocommerce.com/2025/07/03/a-year-of-accessibility-improvements-in-woocommerce-core/)
- WooCommerce recommends descriptive alt text on all product images. — [WooCommerce accessibility page](https://woocommerce.com/de/accessibility/)
- A vendor guide calls missing alt text the most common EAA failure in EU stores, "by a significant margin". Default WooCommerce output uses only the product title as alt text. — [DEV Community (Altvisor, vendor)](https://dev.to/altvisor_ai_0006d05cc388f/how-to-make-your-e-commerce-store-eaa-compliant-a-developers-checklist-e2l); [AllAccessible guide (vendor)](https://allaccessible.org/blog/woocommerce-accessibility-wcag-compliance-guide)
- Current WooCommerce accessibility plugins are thin. OpenAisle offers a free audit and puts AI alt text in Pro using the merchant's own OpenAI/Gemini key. Tazeen Store Accessibility Kit is free, has an alt-text fix that is off by default, and has no reviews. accessiBe sells an overlay on Woo.com. — [OpenAisle](https://wordpress.org/plugins/openaisle/); [Tazeen](https://wordpress.org/plugins/tazeen-store-accessibility-kit-for-woocommerce/); [accessiBe on Woo](https://woocommerce.com/products/accessibe/)

**AI translation**
- Incumbents are strong. Weglot has 4.8/5 from 1,919 reviews on WordPress.org. TranslatePress AI uses credits (50k words on Personal up to 5M words at €6,990/yr on Extended). WPML says TranslatePress, Weglot and Polylang Pro mostly use DeepL. — [Weglot reviews](https://wordpress.org/support/plugin/weglot/reviews/?filter=3); [Barn2](https://barn2.com/blog/the-hidden-costs-of-automatic-website-translation/); [WPML comparison (competitor)](https://wpml.org/home/best-ai-translation-plugin/)
- A competitor blog says Weglot's per-word/page-view pricing gets expensive on large sites. — [LaraTranslate (competitor)](https://blog.laratranslate.com/weglot-alternatives/)

**General AI frameworks**
- AI Engine (Meow Apps) is a free bring-your-own-key framework covering chatbot, content, forms and MCP. It is the category heavyweight for "general AI in WP". — [WordPress.org](https://wordpress.org/plugins/ai-engine/)
- The AI Power plugin's solo creator names dependence on OpenAI/Azure/Google as the biggest challenge. — [Freemius success story](https://freemius.com/blog/success-story-senol-sahin-ai-power-content-creation-plugin/)
- Barn2's founder says simple utility plugins are "threatened by AI". — [Indie Hackers](https://www.indiehackers.com/post/D8QDyPuDzSuOQS7ux9nR) (IH+ paywalled; snippet only)

**Bangladeshi companies**
- weDevs (Dokan, used by 50,000+ marketplaces, mostly US/EU) releases free plugins on WordPress.org and sells add-ons and premium versions. It added hosted subscription revenue via FlyWP. — [Financial Express BD](https://thefinancialexpress.com.bd/trade/local-startup-goes-global-as-wedevs-hits-50000-marketplaces-1608020199); [WordCamp KL 2018 talk](https://kualalumpur.wordcamp.org/2018/session/growing-big-with-wordpress-theme-plugin-business/); [yespress profile](https://yespress.io/wedevs) (low-quality profile)
- WPXPO (Dhaka, founded 2020, 10–49 staff, WooCommerce-focused plugins) was a WordCamp Dhaka 2025 sponsor and won a BASIS ICT award in 2022. — [Clutch](https://clutch.co/profile/wpxpo); [WordCamp Dhaka 2025](https://dhaka.wordcamp.org/2025/ahsan-elite-sponsor-wpxpo/)
- Themeum (founded 2013, Dhaka, Tutor LMS) is a sister company of Ollyo. — [themedev.net list (competitor blog)](https://themedev.net/pt/blog/best-wordpress-product-based-company-in-bangladesh/); [bdthemes list](https://bdthemes.com/best-wordpress-companies-in-bangladesh/)

### Inferences
- Candidate niches, ranked by fit for a solo Node.js + Claude builder:
  1. **Action-taking WooCommerce support agent.** It would do verified order lookup, returns/refund requests with merchant-approval queues, and address changes, all through Woo MCP abilities or the REST API. Most competitors only answer FAQs or look up status, and very few take refunds safely. A hosted backend (Node + Claude) is a natural fit. Its edge is safety: approval workflows and audit logs.
  2. **EAA/accessibility for WooCommerce.** This means bulk AI alt text plus product-page fixes plus an audit report. A regulatory deadline creates pull demand from EU merchants, and current plugins are thin or unreviewed. Avoid "overlay" positioning, which is reputationally controversial.
  3. **Bulk catalog enrichment / AI product data for agentic commerce.** This covers structured attributes, GTINs, ACP/UCP feed readiness and descriptions. WooCommerce itself says to get products "found to bought" via AI agents, so "make my catalog agent-ready" is a better pitch than "write descriptions", which is saturated.
  4. **Semantic/AI search for mid-size catalogs.** Demand is real but competition is growing quickly. Competing would need non-English/multilingual strength or a pricing advantage.
  5. **Lower priority:** translation (strong, well-rated incumbents), generic chatbot or content (AI Engine and Automattic cover it) and spam/comment moderation (Akismet dominates; no data found).
- The Bangladeshi playbook to copy is a free plugin on .org for discovery, a Pro/add-on for revenue, and later a hosted SaaS for recurring revenue. weDevs ran it at scale. A solo founder can start at the SaaS step, because the plugin calling a hosted API is allowed on .org (see Q4).

### Gaps
- No live active-install counts, star ratings or support-thread counts for the chatbot, alt-text or search plugins, because wordpress.org could not be fetched. Someone should check `api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=...` manually.
- No quantitative data on support-forum complaint frequency for any niche.
- No data found on AI comment-moderation or AI form/lead plugins.
- No reliable revenue data for weDevs, WPXPO or Themeum. A yespress figure of about $8–10k/month is vague and low quality, so I did not include it as fact.

## Q2: WooCommerce 10.x MCP/AI features and Automattic's AI plans (platform risk)

### Takeaway
Automattic is building the AI plumbing (MCP, abilities, WP 7.0 AI Client/Connectors) and its own dashboard assistant ("WooCommerce AI", private beta). It says core will stay neutral and AI products will ship as extensions. The risk is high for generic "chat with your store" admin assistants and lower for specialised, vertical workflows that build on the plumbing.

### Cited Findings
- WooCommerce MCP was in beta from November 2025. Its endpoint is `/wp-json/woocommerce/mcp` and it connects via `@automattic/mcp-wordpress-remote`. — [Woo developer blog: Call for testing MCP beta](https://developer.woocommerce.com/2025/11/03/call-for-testing-woocommerce-mcp-beta/); [Woo MCP post](https://woocommerce.com/posts/woocommerce-mcp/)
- WooCommerce 10.9 (23 June 2026) exposes "seven canonical domain abilities" for products and orders through the WordPress MCP Adapter. It is still described as a developer preview. — [Digital Applied (third-party)](https://www.digitalapplied.com/blog/woocommerce-10-9-mcp-agent-ready-wordpress-store-guide); [Woo: canonical abilities for products and orders](https://developer.woocommerce.com/?p=8770096)
- Woo's agentic commerce direction covers ACP, UCP and MCP. James LePage (Automattic Director of Engineering, AI) says Woo will be a "central orchestration layer" in 2026. — [Woo dev blog: AI & Agentic Commerce](https://developer.woocommerce.com/2025/10/03/ai-agentic-commerce-in-woocommerce/); [LetsDataScience](https://letsdatascience.com/news/woocommerce-becomes-central-ai-orchestration-layer-76277986)
- A "Sidekick-type" assistant will come from Automattic as an extension, not in core, with core staying neutral. — [Search Engine Journal](https://www.searchenginejournal.com/woocommerce-may-gain-sidekick-type-ai-through-extensions/567642)
- "WooCommerce AI" is a conversational dashboard assistant in private beta, invited in waves. It answers store questions, drafts products and lets the merchant review changes, and some features may need WooPayments. — [Woo product page](https://woocommerce.com/products/woocommerce-ai/)
- WordPress 7.0 ships a provider-agnostic AI Client (`wp_ai_client_prompt()`), a Connectors API (site-wide API key storage that third-party services can register into) and an expanded Abilities API. — [Make Core: AI Client](https://make.wordpress.org/core/2026/03/24/introducing-the-ai-client-in-wordpress-7-0/); [Make Core: Connectors API](https://make.wordpress.org/core/2026/03/18/introducing-the-connectors-api-in-wordpress-7-0/); [SEJ](https://www.searchenginejournal.com/wordpress-7-0-launches-with-native-ai-integration/575419/)
- WordPress.com added an opt-in built-in AI assistant in February 2026. Jetpack AI Assistant (2023) is a writing assistant. — [Gigazine](https://gigazine.net/gsc_news/en/20260218-automattic-wordpress-ai-assistant); [TechCrunch 2023](https://techcrunch.com/2023/06/07/automattic-launches-an-ai-writing-assistant-for-wordpress/amp/)
- A third-party "SDX AI Readiness Toolkit" already adds its own MCP server for Woo. — [WordPress.org](https://wordpress.org/plugins/sdx-ai-readiness-toolkit/)

### Inferences
- Avoid building a general "talk to your store" admin copilot or a generic content writer. WooCommerce AI, Jetpack AI and WordPress.com AI target exactly that.
- WP 7.0 Connectors lower the barrier to bring-your-own-key, which commoditises thin "API wrapper" plugins. A hosted-service product needs to add something substantive: workflows, guardrails, a bulk job queue, evaluation, data the merchant lacks, or compliance reports.
- Building on Woo abilities/MCP rather than raw DB access improves compatibility. Registering as a WP 7.0 connector adds discoverability (Queryra already did this).

### Gaps
- No confirmed GA date for WooCommerce AI, its pricing, or whether it will handle customer-facing support and refunds.
- I could not verify the exact list of the seven 10.9 abilities from a primary source (fetch blocked).

## Q3: Freemium model, conversion and pricing, Freemius as merchant of record (Bangladesh payouts), WooCommerce Marketplace terms

### Takeaway
Plan for about 1–2% free-to-paid conversion on a .org freemium plugin. Freemius supports Bangladesh payouts (Payoneer, SWIFT, PayPal, Wise listed) and acts as merchant of record at about 6.1% + 50¢ plus gateway fees for WordPress makers. That makes it the most straightforward checkout from Bangladesh, since Stripe is unavailable. The Woo Marketplace pays 70% to the vendor, monthly, but requires business review, HPOS compatibility, support obligations and no off-marketplace upsell links.

### Cited Findings
- Freemium free-to-paid conversion is typically 1–2% (Freemius). One Freemius trial dataset shows 1.51% free-to-paid on average, 18.78% conversion for trials without a card and 69.66% for trials with a card. — [Freemius blog: freemium model](https://freemius.com/blog/freemium-business-model-wordpress/); [Freemius: more freemium upgrades](https://freemius.com/blog/tag/freemium/) (vendor data, mixed dates)
- Freemius's average selling price was $71.5 in 2022, up from $64.3 in 2020. — [Freemius (via search)](https://freemius.com/blog/?p=11558) (dated)
- About 20% of uninstalls are tied to a bad first-time user experience. 50–60% of freemium plugins are still updated three years after launch, versus 10–20% of free plugins. — [Freemius](https://freemius.com/blog/freemium-wordpress-plugins-outlive-free-ones/) (older vendor data)
- Freemius 2026 pricing is 3.8% + 50¢ plus gateway fees, plus 2.3% for the WordPress-specific solution (6.1% + 50¢ total). The rate falls with volume to as low as 0.5% above $100k/month. The older rate was 4.7%. — [Freemius pricing 2026](https://freemius.com/blog/new-freemius-pricing-2026/); [Freemius pricing docs](https://freemius.com/help/documentation/getting-started/our-pricing/); [2025 pricing post](https://freemius.com/blog/new-freemius-pricing-2025/). A third-party article claims 7%, which is likely outdated: [Fungies](https://fungies.io/freemius-alternatives-wordpress-plugins-themes-2026)
- Freemius is merchant of record for US sales tax and EU/UK VAT, including B2B reverse charge. Its docs conflict on whether the fee applies to VAT. — [Freemius tax compliance](https://freemius.com/tax-compliance/); [pricing docs](https://freemius.com/help/documentation/getting-started/our-pricing/)
- Bangladesh is on Freemius's supported-countries list. Payouts go via PayPal, SWIFT/IBAN, Wise or Payoneer, wire payouts are free (intermediary bank fees may apply), and billing information has been required before payout setup since 31 May 2026. — [Freemius supported countries](https://freemius.com/help/documentation/selling-with-freemius/supported-countries); [Freemius earnings/payouts](https://freemius.com/help/documentation/selling-with-freemius/your-earnings/); [Freemius changelog](https://freemius.com/changelog/billing-information-is-now-required-before-setting-up-a-payout-method/)
- Bangladesh payment rails:
  - Stripe does not open accounts for Bangladeshi businesses.
  - Paddle does not list Bangladesh as unsupported, but onboarding is unconfirmed.
  - Lemon Squeezy reportedly lists Bangladesh for bank payouts.
  - Payoneer is the most common rail and has a bKash partnership. PayPal receiving works via Payoneer since late 2025.
  - Wise is restricted.
  - Bangladesh Bank cleared banks to partner with PayPal and Payoneer (Nov 2026).

  — [GlobalSolo 2026](https://www.globalsolo.global/blog/us-bank-account-bangladeshi-founder-getting-paid-2026.md); [Payoneer–bKash](https://www.payoneer.com/resources/business/weve-partnered-with-bkash-to-streamline-bangladeshi-cross-border-payments/); [bdnews24, Nov 10 2026](https://bdnews24.com/business/b3fe8beb6c7f); [Dhaka Tribune](https://www.dhakatribune.com/business/344575/the-hidden-challenges-of-payments-in-bangladesh-s) (mixed vendor/affiliate sources)
- A WorldFirst page says a Bangladesh Bank circular lets authorised dealer banks repatriate small-value service-export proceeds through recognised online payment gateways. — [WorldFirst](https://www.worldfirst.com/sasia/blog/online-sellers/marketplace-payments-south-asia/) (third-party; confirm with the bank)
- Woo Marketplace terms:
  - The vendor receives 70% of net revenue, paid monthly within 30 days. An older Post Status article cites 60%.
  - It requires an approved vendor account and a business review, HPOS compatibility and WordPress accessibility coding standards.
  - Listings may not link to upsells outside the Marketplace, and vendors must maintain the product and provide merchant support, or face removal.
  - SaaS with external billing may need a separate Partnership Agreement.

  — [Woo Vendor Agreement](https://woocommerce.com/woo-vendor-agreement/); [Woo dev docs: submitting](https://developer.woocommerce.com/docs/woo-marketplace/submitting-your-product/); [Monetization expectations](https://developer.woocommerce.com/docs/woo-marketplace/monetization-expectations/); [Post Status (older)](https://poststatus.com/woocommerce-offering-20-higher-rates-trade-third-party-developers-offering-support/)

### Inferences
- Rough funnel math: 2,000 active installs × 1.5% ≈ 30 paying customers. At about $10–20/month that is about $300–600 MRR. Reaching $3k MRR likely needs about 10k+ active installs, or higher prices aimed at stores (for example $29–99/month tied to order volume or AI usage).
- Freemius is the simplest merchant of record from Bangladesh (Payoneer payout). The Woo Marketplace is a useful second channel: 30% cut, but high-intent buyers and Woo handles billing. Its "no external upsell" rule means a separate SKU, and its "merchant support" obligation is lightweight email support, which conflicts slightly with "no service component".
- Use card-required trials on the Pro/SaaS tier. Freemius data shows a big conversion gap between card-required and no-card trials.

### Gaps
- I found no 2025–2026 Freemius market report with current conversion or ASP numbers. All conversion stats are older vendor data.
- Payout specifics for Bangladesh were not verified: Payoneer fees and whether a SWIFT payout to a Bangladeshi bank needs extra Bangladesh Bank paperwork.
- I could not confirm whether Woo Marketplace pays out to Bangladesh, or its payout method.

## Q4: SaaS-backed plugin vs pure plugin; refund and churn norms

### Takeaway
WordPress.org explicitly allows a free plugin that calls a paid external service ("serviceware") provided the service does substantive work. It forbids locked local code, trials that disable functionality, and license-check-only "services". This suits a Node.js + Claude hosted backend: usage-based subscriptions and the AI cost sit on your server. It makes you responsible for API cost margins and uptime.

### Cited Findings
- WordPress.org guidelines:
  - Plugins may interface with paid third-party services.
  - Included code may not be locked behind payment, and may not be disabled after a trial or quota.
  - The external service must be substantive, not just license validation.
  - Remote calls and required registration must be disclosed in the readme and on the settings page.
  - Premium code should live in add-ons hosted off .org.

  — [Detailed Plugin Guidelines](https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/); [Make Plugins: trialware clarification](https://make.wordpress.org/plugins/2018/08/23/guideline-update-clarifications-to-trialware-and-human-readability/?output_format=md); [moderator forum thread](https://wordpress.org/support/topic/moderators-are-trialware-plugins-allowed-on-the-directory/)
- A moderator has said that a plugin using a service to do the actual work is not considered trialware, and services need not have a free tier. — [WordPress.org support](https://wordpress.org/support/topic/requires-a-paid-subscription-via-api/)
- The alternative, bring-your-own-key, is common: AI Engine charges no markup and the user pays providers directly. WP 7.0 Connectors now make bring-your-own-key standard. — [AI Engine](https://wordpress.org/plugins/ai-engine/); [Make Core Connectors](https://make.wordpress.org/core/2026/03/18/introducing-the-connectors-api-in-wordpress-7-0/)

### Inferences
- The recommended structure is a free .org plugin with a limited free usage quota served by your API (allowed, because the service does the work). Paid tiers would be metered by actions, products or conversations. Billing goes through Freemius (which supports SaaS plans) or Lemon Squeezy/Paddle if they onboard Bangladesh. Offering an optional bring-your-own-Claude-key mode could reduce cost-sensitive objections.
- Main risks are Claude API cost per customer (needs usage caps), uptime obligations, and data-protection obligations for EU merchant/customer data (a DPA is needed for a support agent handling order PII).

### Gaps
- I found no 2025–2026 data on refund rates or churn for WordPress plugin subscriptions. Freemius publishes refund and renewal stats in some posts, but I could not fetch them. Common practice of a 14–30-day money-back guarantee was not sourced in this session.

## Q5: Documented revenue of indie and Bangladeshi WordPress plugin businesses (2024–2026)

### Takeaway
Solid revenue data is scarce and mostly self-reported. The evidence suggests a solo WordPress/AI plugin can realistically reach a few thousand dollars MRR. Larger outcomes come from teams, broad products or SaaS (Barn2 about $1.6–1.7M/yr; FlyPlugins about $24k MRR). Many new AI plugins report near-zero revenue.

### Cited Findings
- Barn2 Plugins reported about $1.6M/yr (plateau) and about $1.7M/yr in one listing. Its founder says the simple-utility plugin category is threatened by AI. — [Indie Hackers (IH+)](https://www.indiehackers.com/post/D8QDyPuDzSuOQS7ux9nR)
- FlyPlugins is reported at about $24K MRR, with co-founders. — [Indie Hackers / search summary](https://www.indiehackers.com/post/building-a-sustainable-wordpress-plugin-business-28b02d55ef) (self-reported)
- WP Multitool (an AI-feature plugin) has $63 MRR from 5 subscriptions. — [TrustMRR](https://trustmrr.com/startup/wp-multitool)
- Pluginery shows $60k MRR but "no active subscriptions", so the figure is inconsistent. — [TrustMRR](https://trustmrr.com/startup/pluginery?metric=mrr) (unreliable)
- A WooCommerce AI search indie reported $0 MRR at 3 weeks. — [Indie Hackers](https://www.indiehackers.com/Queryra/history/2)
- BigIdeasDB (September 2026) reports a median TTM revenue of $57k across only 11 plugin/theme products. It concludes WordPress is "a perfectly normal place to reach a few thousand dollars a month" but below average for exit value. — [BigIdeasDB](https://bigideasdb.com/how-to-sell-a-wordpress-plugin) (tiny sample; the company sells guides)
- Bangladeshi founders on Indie Hackers describe working around "no Stripe, no PayPal" when selling globally. — [IH: Bangladesh micro SaaS](https://www.indiehackers.com/post/building-a-micro-saas-from-bangladesh-to-fight-the-10-platform-tax-c06cc12f62); [IH: competing with Gumroad from Bangladesh](https://www.indiehackers.com/post/competing-with-gumroad-and-stan-store-as-a-solo-founder-from-bangladesh-no-stripe-no-paypal-a42bea1e88)
- weDevs: 50,000+ marketplaces run Dokan. No audited revenue was found. — [Financial Express BD](https://thefinancialexpress.com.bd/trade/local-startup-goes-global-as-wedevs-hits-50000-marketplaces-1608020199)

### Inferences
- Realistic planning target for year 1: $500–3,000 MRR if one niche plugin reaches several thousand active installs. A slow ramp should be expected, because .org discovery takes months of reviews, updates and SEO.

### Gaps
- No verified 2024–2026 revenue for weDevs, WPXPO, Themeum or other Bangladeshi WP firms (they are private and don't publish figures).
- Freemius's annual transparency or market-data reports for 2025–2026 could not be fetched, and no current aggregate figures were found.
