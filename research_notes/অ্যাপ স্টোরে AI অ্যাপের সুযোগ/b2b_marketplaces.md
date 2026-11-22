# AI Agent App Opportunities on B2B Software Marketplaces (late 2026), for a Bangladesh-based solo founder

Method note: The research used about 17 tool calls. WebFetch was blocked by DNS or network allowlisting for gohighlevel.com, marketplace.gohighlevel.com and indiehackers.com, so most findings come from **WebSearch result summaries, not full pages**. Snippets can lose context. Treat every figure as "reported in a search snippet" unless it is marked as an official doc. These sources were not reached or not searched at all: Reddit threads (no r/gohighlevel or r/hubspot threads surfaced), HubSpot's ideas forum, the Notion and Airtable marketplaces, and Facebook groups.

## Q1. Marketplace mechanics: buyer base, discovery, billing, revenue share, review

### Takeaway
Only **HighLevel** and **monday.com** offer built-in billing that a non-US solo developer can realistically use. HighLevel currently takes **0% commission (until 31 Dec 2026)** and lets agencies mark up and resell an app to their sub-accounts. monday.com takes **0% until $200k lifetime revenue, then 15%**, and pays out via Payoneer. HubSpot, Google Workspace, Slack, Zapier and Make give distribution only: you must bring your own billing, and Zapier/Make pay nothing to integration builders.

### Cited Findings
**HighLevel (GHL)**
- HighLevel's marketplace landing page reportedly says it will charge no commission on developer revenue until December 31, 2026. A help article modified in June 2026 says it "currently do[es] not deduct any commission." Neither source says what happens after that date. — [HighLevel landing page (search snippet)](https://www.gohighlevel.com/landing-marketplace); [Set Up Your App Pricing (HL help)](https://help.gohighlevel.com/support/solutions/articles/155000001217-set-up-your-app-pricing)
- Developers receive the entire customer payment. Agencies can mark up the price when they resell to their sub-accounts, and the agency keeps the markup. The 0%-to-HighLevel split comes from an unofficial wiki. — [HL help](https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000001217-set-up-your-app-pricing); [unofficial wiki (low quality)](https://jc-aiwiki.pages.dev/gohighlevel/marketplace-app-listing)
- Usage-based billing is supported through billing meters (a Custom Event API with dynamic pricing). Agencies can also resell usage-priced apps. — [Agency reselling for usage-based apps (HL help)](https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000005501-agency-reselling-for-apps-with-usage-based-pricing)
- HighLevel is temporarily waiving its "premium action/trigger" charges for some marketplace apps, as an experiment. — [HL help](https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000004719-experiment-waiving-premium-action-trigger-charges-for-selected-marketplace-apps)
- Payouts go through **Tipalti**. Eligible developers get an email invitation to register, and funds arrive 1–3 days after a payout shows as "submitted." An unofficial wiki claims payouts happen on the 15th of each month for the prior month; this is unverified. — [HL docs via search snippet](https://marketplace.gohighlevel.com/docs/MarketplacePolicies/RefundPolicy); [wiki](https://jc-aiwiki.pages.dev/gohighlevel/marketplace-app-listing)
- Apps install at either the agency level or the sub-account level. HighLevel's go-to-market model is agency-driven. A recent change lets users view and install sub-account-level apps directly. — [Agency vs Sub-Account doc](https://marketplace.gohighlevel.com/docs/oauth/AgencyVsSubAccount.md); [changelog](https://ideas.gohighlevel.com/changelog/introducing-the-ability-to-view-and-install-subaccount-level-marketplace-apps-wi)
- Scale: at LevelUp 2025, HighLevel reported "375 total apps published, including 402 AI agents (341 voice-powered and 61 conversation-based)." The numbers are internally inconsistent as summarized, so the wording is probably garbled. I found no 2026 agency count. — [Newswire/Barchart press release, LevelUp 2025](https://www.newswire.com/news/highlevel-ushers-in-the-era-of-agentic-ai-at-levelup-2025-22659767)
- App review guidelines exist, but I couldn't fetch them and found no stated review timeline. — [App Review Guidelines](https://marketplace.gohighlevel.com/docs/2023-02-21/oauth/AppReviewGuidelines)
- HighLevel runs support tickets for marketplace apps, and agencies can now sell snapshots on the marketplace, which adds more competition from agencies themselves. — [changelog](https://ideas.gohighlevel.com/changelog/support-tickets-for-marketplace-apps); [pricing guide](https://www.apexure.com/blog/gohighlevel-pricing)

**HubSpot App Marketplace**
- Listing is free: "no fees to become a partner or list an app." I found no official revenue-share statement. — [HubSpot ecosystem resources](https://www.hubspot.com/app/ecosystem-resources)
- HubSpot does **not** process app payments. The developer handles subscriptions, billing and access control with their own Stripe or PayPal, and the pricing in the listing is display-only. This comes from community moderator and member answers, not official docs. — [HubSpot Community: Public App Pricing Plans](https://community.hubspot.com/t/public-app-pricing-plans/144166); [App Billing & Licensing thread](https://community.hubspot.com/t5/APIs-Integrations/Hubspot-App-Billing-amp-Licensing/td-p/1234404)
- Certification requirements (official doc):
  - Use the OAuth authorization code flow, verify a domain, and keep one app ID per use case.
  - Show activity from unaffiliated accounts over the past 30 days.
  - Keep the success rate above 95%.
  - Submit a demo video.
  - Classic CRM cards have been unsupported since June 16, 2025.
  - Certification lasts 2 years.
  - An older version required 6 months of listing before certification.
  — [HubSpot certification requirements](https://developers.hubspot.com/docs/apps/developer-platform/list-apps/apply-for-certification/certification-requirements)

**Google Workspace Marketplace**
- There is no native billing. Developers use Stripe and link to a customer portal from inside the add-on. This comes from a dated vendor guide. — [Mailmeteor: monetize your add-on](https://mailmeteor.com/blog/monetize-google-workspace-addon); [dev.to](https://dev.to/frenchcooc/how-to-monetize-your-google-workspace-add-on-1k0a)
- Publishing requires OAuth verification plus Marketplace approval. Restricted scopes (for example, Gmail read) need an **annual third-party security assessment (CASA)** that "can take several weeks." Older sources put the cost at $15k–$75k, and a freeCodeCamp article says the self-scan Tier 2 is free. Current pricing is unconfirmed. — [Google: Gmail add-on scopes](https://developers.google.com/gmail/add-ons/concepts/scopes); [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification); [freeCodeCamp CASA Tier 2](https://www.freecodecamp.org/news/tier-casa-security-assessment); [2019 Apps Script forum](https://groups.google.com/g/google-apps-script-community/c/ZS2_NCEzdQ8)

**monday.com**
- Built-in monetization has been **mandatory for new marketplace apps since July 2024**. Revenue share starts only after $200,000 in lifetime revenue, after which monday.com keeps 15%. Payouts are monthly in USD via **Payoneer**. — [monday dev docs: subscriptions & billing](https://developer.monday.com/apps/docs/subscriptions-payments-and-billing); [monetization changelog](https://developer.monday.com/apps/changelog/new-monetization-requirements-for-marketplace-approval); [Payoneer payouts community thread](https://developer-community.monday.com/api-apps-framework-4/app-payouts-payoneer-2035)

**Slack Marketplace**
- Paid apps are allowed, but the developer handles payments. Listings can show Paid, Paid with free trial, or Included-with-subscription. — [Is your app ready for Slack Marketplace](https://docs.slack.dev/slack-marketplace/is-your-slack-app-ready-for-the-slack-marketplace)
- **Key constraint for AI agents:** since May 29, 2025, commercially distributed apps that are *not* Marketplace-approved are limited to **1 request per minute** on `conversations.history` and `conversations.replies`. This was extended to existing unlisted installs on March 3, 2026. In practice, Marketplace approval is now required for any AI agent that reads Slack history. — [Slack changelog 2025-05](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps); [rate limits clarity 2025-06](https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity)

**Zapier / Make**
- Zapier pays integration developers nothing for app usage and charges them no fees. Its partner tiers (Bronze through Platinum) give directory placement and a "Learn More" lead link. Revenue exists only in the separate Solution Partner (services) track. Zapier lists 8,000+ integrations. — [Zapier community answer](https://community.zapier.com/how-do-i-3/do-i-get-any-revenue-as-my-app-is-used-23345); [Zapier benefits guide](https://docs.zapier.com/platform/publish/benefits-guide); [Zapier partner program](https://zapier.com/developer-platform/partner-program)

**Microsoft commercial marketplace (AppSource)**
- Bangladesh appears in Microsoft's geographic availability table (USD base). Transactable SaaS offers need a validated tax profile and payout profile in Partner Center. I didn't find Bangladesh-specific payout rules. — [MS geo availability](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/marketplace-geo-availability-currencies); [Set up payout account](https://learn.microsoft.com/en-us/partner-center/set-up-your-payout-account)

### Inferences
- For a solo founder who wants built-in billing and no Stripe dependency, the realistic shortlist is **HighLevel (agency resale, 0% fee through 2026) and monday.com (Payoneer, 0% until $200k)**. Microsoft is possible but carries enterprise-grade onboarding overhead.
- Zapier/Make are distribution channels for an existing SaaS, not standalone businesses.
- Google Workspace add-ons that touch Gmail content carry a recurring compliance cost that is heavy for a solo developer. Sticking to non-restricted scopes (Sheets, Docs, Calendar) avoids most of it.

### Gaps
- I found no official HighLevel commission terms after Dec 31, 2026; this is a key risk to verify.
- I found no HighLevel review timeline and no current agency or sub-account counts. (Older public figures are not cited here because I couldn't verify them.)
- I found no buyer-base figures for HubSpot, Google Workspace, Slack, Notion, Airtable or monday in these searches.
- I didn't research Notion or Airtable marketplace billing: the one search returned nothing.
- I found no Make.com app-ecosystem terms.

## Q2. Payout feasibility for a Bangladesh resident

### Takeaway
monday.com (Payoneer) is the clearest fit, because Payoneer works in Bangladesh. HighLevel pays via Tipalti, and Bangladesh appears to be limited to **wire or check** (anecdotal). Anything that needs your own billing (HubSpot, Google, Slack) runs into the fact that **Stripe does not support Bangladesh**. That pushes you to a merchant of record (Paddle, Lemon Squeezy, Dodo) or a US LLC.

### Cited Findings
- I found no official Tipalti list confirming Bangladesh support. One user report says that selecting Bangladesh in Tipalti blocks ACH and allows only wire or check. — [Skool user report (anecdotal)](https://www.skool.com/amino-club-affiliates-1417/payment-method-3); [Tipalti coverage](https://tipalti.com/press/tipalti-expands-international-ach-global-payments-coverage/)
- monday.com pays out via Payoneer in USD. — [monday dev docs](https://developer.monday.com/apps/docs/subscriptions-payments-and-billing)
- Bangladesh is not on Stripe's supported-countries list, so a Bangladesh-registered business can't open a Stripe account. Lemon Squeezy lists Bangladesh for bank payouts. Paddle has no published restriction but may review accounts. MoR fees are about 5% + 50¢. Sources are vendor and dev blogs of medium-low quality. — [Fungies 2026 guide](https://fungies.io/non-us-founders-sell-saas-globally-2026/); [dev.to fee comparison 2026](https://dev.to/jettfu/stripe-vs-paddle-vs-lemon-squeezy-fee-comparison-2026-2c77); [GlobalSolo BD guide](https://www.globalsolo.global/blog/us-bank-account-bangladeshi-founder-getting-paid-2026); [IH: bypassing Stripe in Bangladesh](https://www.indiehackers.com/post/how-i-bypassed-stripe-the-bangladesh-problem-to-ship-in-8-days-3a6d47a0eb)
- Payoneer withdrawals to bKash and local BD bank accounts are reported. — [GlobalSolo](https://www.globalsolo.global/blog/us-bank-account-bangladeshi-founder-getting-paid-2026)
- Microsoft lists Bangladesh as a marketplace geography; payout mechanics for BD weren't confirmed. — [MS geo availability](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/marketplace-geo-availability-currencies)

### Inferences
- A HighLevel payout by wire to a BD bank account is probably workable but slower and has fees. Registering for Tipalti early (before building) is a cheap way to confirm the options.
- For HubSpot and Google, budget for a merchant of record (about 5% plus FX) or a US LLC plus a US bank. That reduces the attractiveness of those two relative to built-in-billing marketplaces.

### Gaps
- I didn't confirm Tipalti's Bangladesh support officially, and I didn't verify whether HighLevel allows Payoneer as a Tipalti method.
- I didn't verify current Paddle or Lemon Squeezy KYC acceptance for BD individuals.

## Q3. AI agent niches requested by users, where existing apps are weak or missing

### Takeaway
In HighLevel, documented demand clusters around **voice AI gaps**: robotic voice, no caller recognition, no context on past bookings, no IVR-to-AI handoff, and outbound limits. Agencies already work around these with Vapi, Retell or Synthflow, which means demand exists, but the space is crowded and HighLevel is shipping fixes itself. Review-reply AI has already been built natively. I couldn't extract specific high-vote, weakly-served niches for HubSpot or Google.

### Cited Findings
- HighLevel's ideas board: the top three Voice AI issues have 443 combined upvotes. These are robotic voice quality (178), no caller recognition (174) and spam-call pollution of the CRM (91). The source is a third-party dev.to post (medium quality). — [dev.to: GHL Voice AI vs Hermes](https://dev.to/alfredo_romero_fc4afdcb68/ghl-voice-ai-vs-hermes-8-things-gohighlevel-still-wont-do-in-2026-1ln5)
- Requests on HighLevel's official ideas board:
  - IVR buttons that route a live caller to an AI voice agent
  - Appointment booking and contact lookup by Voice AI agents
  - Voice AI workflow triggers based on customer responses
  - Global outbound Voice AI without opt-in restrictions
  — [IVR→AI](https://ideas.gohighlevel.com/lcphonesystem/p/allow-ivr-buttons-to-route-callers-to-an-ai-voice-agent-during-a-live-call); [booking](https://ideas.gohighlevel.com/voice-ai/p/enable-appointment-booking-for-voice-ai-agents); [triggers](https://highlevel.canny.io/voice-ai/p/voice-ai-agent-workflow-triggers-based-on-customer-responses); [outbound](https://ideas.gohighlevel.com/ai-employee/p/enable-global-voice-ai-outbound-calling-without-opt-in-restrictions)
- Agencies commonly swap native Voice AI for Synthflow, VAPI or Retell via webhook, and freelancers sell such builds on Fiverr. — [thestackinsiders (affiliate, low quality)](https://www.thestackinsiders.com/blog/gohighlevel-voice-ai-problems); [Fiverr listing](https://fiverr.com/angelshayla/build-ai-voice-agent-and-calling-agent-in-gohighlevel)
- A vertical rebuild exists: Agent CRM targets insurance agents who are leaving GHL. This is a vendor blog. — [Agent CRM blog](https://blog.agent-crm.com/already-using-gohighlevel-for-insurance-heres-why-power-users-are-moving-to-agent-crm/)
- Review-reply AI is native now: Reviews AI agents, Facebook review replies, and price cuts. Remaining requests are about per-agent customization and filtering. — [Reviews AI changelog](https://ideas.gohighlevel.com/changelog/new-feature-say-hello-to-reviews-ai-agents); [Facebook replies](https://ideas.gohighlevel.com/changelog/reviews-ai-now-supports-facebook-replies); [filtering request](https://ideas.gohighlevel.com/reviews-ai/p/more-customizable-filtering-settings-for-the-review-ai)
- HighLevel has a dedicated "Marketplace new app request" board. Visible requests are integrations such as BambooHR (March 2026) and Microsoft Teams, not AI agents. The board appears low-volume (about 19 posts in one capture). — [Marketplace new app request board](https://ideas.gohighlevel.com/marketplace-new-app-request); [BambooHR](https://ideas.gohighlevel.com/marketplace-new-app-request/p/bamboohr-integration); [MS Teams](https://ideas.gohighlevel.com/marketplace-new-app-request/p/microsoft-teams-integration)
- Integration-shaped gaps (connecting GHL to tools it lacks) are another pattern seen on the request board. — same as above

### Inferences
- The strongest opening for a solo developer is likely **narrow "glue + AI" apps** that fill a capability HighLevel's native AI lacks, sold as agency-resellable sub-account apps with usage-metered billing. One example is a caller-context or CRM-memory layer for voice and chat agents. Another is vertical agent templates (for example, a niche like insurance or home services) that agencies mark up.
- Head-on voice AI competition (against native Voice AI, Vapi and Retell) looks crowded.
- Requests on HighLevel's ideas board are a double-edged signal: HighLevel often ships them natively, as review-reply AI showed.

### Gaps
- No Reddit or Facebook-group evidence of agency requests was retrieved.
- I found no HubSpot ideas-forum AI requests, no Google Workspace add-on gap analysis, and no data on poorly rated existing apps (ratings weren't accessible).

## Q4. Platform risk (HubSpot Breeze, HighLevel AI Employee, Copilot, Gemini)

### Takeaway
Platform risk is high everywhere. HighLevel bundles an AI Employee at about $50–$97 per sub-account per month and keeps absorbing popular requests. HubSpot's Breeze Marketplace lists only HubSpot-built agents, and third parties can contribute only "agent tools" (beta). I did not research Copilot or Gemini in this pass.

### Cited Findings
- HighLevel's AI Employee is reported at $50 per month (Growth: 1,000 responses and 100 voice minutes) or $97 per month (Unlimited) per sub-account. Outbound Voice AI and phone charges are still billed on usage. These figures come from third-party pricing guides that conflict with each other. — [Apexure pricing guide](https://www.apexure.com/blog/gohighlevel-pricing); [saascrmreview](https://saascrmreview.com/?p=18883)
- At LevelUp 2025, HighLevel positioned itself around "agentic AI." — [Newswire](https://www.newswire.com/news/highlevel-ushers-in-the-era-of-agentic-ai-at-levelup-2025-22659767)
- HubSpot's Breeze Marketplace lists HubSpot-built agents and assistants. Developers can expose app actions as "agent tools" on the new developer platform (beta). HubSpot says it "will always invest in world-class first-party agents" while opening the ecosystem. — [HubSpot AI tools beta](https://developers.hubspot.com/ai-tools-beta); [HubSpot open ecosystem post](https://www.hubspot.com/company-news/our-vision-for-building-an-open-ecosystem-for-the-agent-era); [eesel.ai (third-party)](https://www.eesel.ai/blog/breeze-marketplace)
- Commission figures for third-party Breeze agents (20–30%) are speculative and unsourced; do not rely on them. — [Monetizely (speculative)](https://www.getmonetizely.com/articles/hubspot-breeze-marketplace-how-third-party-breeze-agents-could-become-hubspots-next-monetization-flywheel)
- HubSpot announced 200+ updates at INBOUND 2025, much of it agentic AI. — [BusinessWire](https://businesswire.com/news/home/20250903907062/en/HubSpot-unveils-blueprint-to-building-hybrid-human-AI-teams-with-200-product-updates-at-INBOUND-2025); [TechTarget](https://www.techtarget.com/searchcustomerexperience/news/366630028/HubSpot-adds-200-features-to-platform-much-of-it-agentic-AI)
- Slack's 2025 rate-limit change is itself a platform-control move: AI agents reading history need Marketplace approval. — [Slack changelog](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps)

### Inferences
- Generic horizontal agents (review replies, chat or voice receptionists, email drafting) are the most exposed to platform bundling. Narrow vertical or workflow-specific agents, and integrations the platform won't prioritize, are less exposed.
- On HubSpot, the "agent tool" route turns your app into a supplier to Breeze rather than a standalone agent product.

### Gaps
- I did not research Microsoft Copilot or Gemini in Workspace overlap.
- I found no HighLevel roadmap statements for 2026.

## Q5. Documented indie revenue examples (2024–2026)

### Takeaway
Hard indie revenue numbers are scarce. The best available are an Indie Hackers HubSpot analysis (median about $26k MRR for paid third-party products, estimated), a monday.com app portfolio at $30k MRR (published by monday.com itself), and an Atlassian app at $4,149 MRR. For HighLevel, I found only install counts (GoGHL.ai), with no revenue figures.

### Cited Findings
- **HubSpot:** an Indie Hackers analysis ("Indies are making $280k ARR on HubSpot in 2024") estimates that paid third-party products with a median of 82 installs average $119k MRR, with a $26k median. This is a modelled market estimate, and I couldn't fetch the full post. — [Indie Hackers](https://www.indiehackers.com/post/indies-are-making-280k-arr-on-hubspot-in-2024-608dc3fab2)
- **monday.com:** monday's developer blog profiles a developer who scaled a portfolio of marketplace apps to $30k MRR, noting that more reviews led to higher ranking and more organic installs. This is a platform-published success story. — [monday.com dev blog](https://monday.com/appdeveloper/blog/build-30k-saas-monday-marketplace/)
- **HighLevel:** GoGHL.ai, built by an ex-HighLevel employee, reports 3,400+ agencies and about 40,000 installs, and is among the most reviewed apps. No revenue figure is given, and the piece is HighLevel's own promotional post. — [HighLevel blog](https://www.gohighlevel.com/post/yogesh-kumawat-levelup-exhibitor-goghlai-talks-about-building-and-scaling-a-highlevel-marketplace-app)
- **Atlassian (adjacent):** an app reached $4,149 MRR after 18 months. — [Indie Hackers](https://www.indiehackers.com/post/reaching-4149-mrr-in-the-atlassian-marketplace-a3cc93a067)
- **Google Workspace:** I found no verified indie add-on revenue. One developer blog sets a *goal* of $500 per month, which is not a result. — [withjhinna blog](https://withjhinna-com.pages.dev/blog/building-google-workspace-addons.md); [IH thread](https://www.indiehackers.com/post/google-workspace-marketplace-fa065f6ca7)

### Inferences
- The GoGHL.ai example shows that HighLevel's agency multiplier can drive large install counts, since one agency installs across many sub-accounts. It also shows that insider knowledge helped. The founder had no special domain expertise, so channel knowledge would have to be learned.
- The monday.com $30k MRR example is the closest documented proof of the "portfolio of small marketplace apps, with organic installs from reviews" model the founder wants.

### Gaps
- I found no verified HighLevel indie MRR, no Slack, Notion or Airtable indie revenue examples, and no 2025–2026 TrustMRR-verified marketplace app data.
