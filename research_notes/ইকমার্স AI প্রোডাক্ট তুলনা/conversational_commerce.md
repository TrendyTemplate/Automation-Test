# Conversational Commerce AI: (A) Shopify AI Support Agent vs (B) Social-Seller AI Sales Assistant (Messenger / IG / WhatsApp)

Research date: 2026-11-24. Method: web search only. Direct page fetches were blocked in this session for about.fb.com, apps.shopify.com, gorgias.com and manychat.com, so many pricing figures come from search-result summaries of third-party or competitor blogs (eesel.ai, featurebase, sleekflow, respond.io, etc.). These are flagged as such and must be re-checked on the vendors' live pages before anyone relies on them. A large share of comparison content is written by vendors selling a competing tool, so it is biased.

## Q1. Market size and demand signals

### Takeaway
Demand is real and growing: Gartner reports AI spend in customer service is up 38% while budgets are flat, and Juniper puts conversational-commerce spend at about $43B by 2028. Meta reports 1M+ businesses already using its own Business Agent. But much of the growth goes to platform-native tools (Shopify Inbox, Meta Business Agent). I found no reliable figure for how many ecommerce merchants specifically have adopted AI.

### Cited Findings
- Gartner (service-leader survey, Apr–May 2026, n=199): AI spending by customer service leaders is up 38%, while overall service and support budgets grew 2% — [Gartner, 2026-08-26](https://www.gartner.com/en/newsroom/press-releases/2026-08-26-gartner-survey-finds-ai-spending-by-customer-service-leaders-has-surged-by-38-percent-despite-overall-service-and-support-function-budgets-rising-by-just-2-percent)
- Gartner: 91% of customer service leaders are under pressure to implement AI in 2026 — [Gartner, 2026-02-18](https://gartner.com/en/newsroom/press-releases/2026-02-18-gartner-survey-finds-ninety-one-percent-of-customer-service-leaders-under-pressure-to-implement-ai-in-2026)
- Gartner customer survey (Feb–Mar 2026, n=3,566): 87% of customers say a company using GenAI for service must offer access to a human. 50% say GenAI makes interactions easier — [Gartner, 2026-08-04](https://www.gartner.com/en/newsroom/press-releases/2026-08-04-gartner-survey-finds-87-percent-of-customers-say-companies-using-genai-for-customer-service-must-provide-access-to-a-human-agent0)
- Gartner: only 27% of customers would try a chatbot again after a negative experience — [Gartner, 2026-09-02](https://www.gartner.com/en/newsroom/press-releases/2026-09-02-gartner-finds-only-27-percent-of-customers-would-try-a-chatbot-again-after-a-negative-experience)
- Gartner: customers are 3x more likely to use third-party GenAI (e.g. ChatGPT) than company chatbots for service — [Gartner, 2026-07-08](https://www.gartner.com/en/newsroom/press-releases/2026-07-08-gartner-survey-finds-customers-are-three-times-more-likely-to-use-third-party-genai-than-company-provided-chatbots-for-customer-service)
- Gartner: 21% of service leaders have reduced human agent headcount because of AI — [Gartner, 2026-11-05](https://www.gartner.com/en/newsroom/press-releases/2026-11-05-gartner-survey-finds-21-percent-of-service-and-support-leaders-have-reduced-human-agent-headcount-because-of-ai)
- Juniper Research (2023–2028 forecast): global retail spend via conversational-commerce channels is forecast to reach $43B by 2028. OTT messaging apps (WhatsApp, WeChat, etc.) account for about $50B of messaging spend by 2028. The OTT share falls from 53% (2024) to 45% (2028) as RCS grows from $350M (2023) to $12B (2028) — [Communications Today](https://www.communicationstoday.co.in/spend-over-ott-messaging-apps-to-near-50-billion-globally-by-2028/); [TelecomTV](https://telecomtv.com/content/digital-platforms-services/rcs-set-for-major-growth-in-digital-commerce-sector-report-49211). A GII listing of the same report gives an inconsistent 2023 figure of $112B, which may be a typo — [GII](https://www.giiresearch.com/report/jp1373221-global-conversational-commerce-market.html)
- Juniper (2025 study): ecommerce spend over rich-media messaging channels (RCS plus OTT) grows from $14B (2025) to about $19B (2027), roughly 30% — [iTWire](https://itwire.com/guest-articles/guest-research/ecommerce-spend-over-rich-media-messaging-channels-to-grow-by-30-over-next-two-years.html)
- Juniper: business messaging traffic grows from about 2 trillion messages (2025) to about 3 trillion (2030) — [UC Today](https://www.uctoday.com/unified-communications/three-trillion-messages-by-2030-are-enterprises-ready-for-the-conversational-surge/)
- WhatsApp has more than 3B MAU. The last official Meta figure for the WhatsApp Business app is more than 200M MAU (June 2023). India, Brazil and Indonesia are the largest markets. Country counts conflict across aggregators (India 535M vs 853M) — [Kanal stats (aggregator)](https://getkanal.com/blog/whatsapp-statistics); [Infobip](https://www.infobip.com/blog/whatsapp-statistics-2025-global-usage-market-overview)
- Meta says 1M+ businesses use a Meta Business Agent on WhatsApp and Messenger. In its Q1 2026 earnings call, Meta said weekly person-to-business-AI conversations on WhatsApp and Messenger had reached 10M — [Meta Newsroom, June 2026](https://about.fb.com/news/2026/06/meta-business-agent/) (summarised via search; page fetch blocked); [TechCrunch 2026-06-03](https://www.techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/)
- Shopify chat-app installs (StoreCensus, third-party tracker): 25 tracked chat apps across about 2.14M Shopify stores, with about 344.6k total installs. Shopify Inbox has about 250k installs, roughly 72.6% share. The 25th app has about 970 installs. 18 of 25 apps show positive 90-day growth — [StoreCensus](https://www.storecensus.com/stats/most-popular-shopify-chat-apps)
- In Southeast Asia, Facebook led Thai live selling at 37.9%, ahead of TikTok (26.9%) and Shopee (19.8%) (Ninja Van survey, Nov 2022, about 1,000 sellers, so dated) — [Ninja Van PDF](https://www.ninjavan.co/files/en-th/live-selling-in-southeast-asia.pdf)

### Inferences
- Budgets are moving toward AI service, but customers distrust bad bots (27% retry rate) and insist on human escalation (87%). Products that win must be accurate on order data and hand off cleanly. Generic LLM "FAQ bots" are a weak position.
- On Shopify, most stores that use chat at all use free Shopify Inbox, so most of the "market" is merchants who either don't use chat or use the free native tool. Paid third-party chat apps are a long tail of small install bases. This suggests a winnable but low-revenue-per-merchant SMB segment (estimate).
- For (B), demand is concentrated in WhatsApp-first and Facebook-commerce markets (India, Brazil, Indonesia, the Philippines, Thailand, LATAM, MENA, Bangladesh). That is also where willingness to pay in USD is lowest (inference).

### Gaps
- No credible survey found of the % of ecommerce/Shopify merchants using AI customer support in 2025–2026. Gartner data is about service organisations in general.
- No official 2026 WhatsApp Business API adoption by region, or Meta business-messaging revenue figure (Meta's "Family of Apps other revenue" was not checked).
- No Reddit threads surfaced via search. Merchant sentiment comes only from App Store review snippets and vendor blogs.

## Q2. Competitor landscape and pricing

### Takeaway
(A) Shopify support is highly contested. Shopify Inbox (free, now with an AI agent) dominates installs. Gorgias (about $0.90–1.00 per AI resolution plus helpdesk fees), Intercom Fin ($0.99 per outcome plus seats) and Tidio/Lyro (bundle pricing) own the paid tiers, with a long tail of small AI-chatbot apps. (B) Social-DM tools are also crowded: ManyChat (repriced March 2026), respond.io, SleekFlow, Wati, plus cheap regional BSPs such as AiSensy and Interakt in India. Meta's own free Business Agent now sits underneath all of them.

### Cited Findings — (A) Shopify AI support
- **Shopify Inbox AI agent:** an optional Inbox agent can chat with customers automatically, answering questions on products, shipping, returns, sizing and policies. It uses the catalog, policies, Knowledge Base and published pages. It personalises for Shop-signed-in customers, is off by default for existing users, and offers human handoff after every message — [Shopify Help: Inbox AI](https://help.shopify.com/en/manual/inbox/ai); [Shopify Inbox](https://shopify.com/inbox)
- **Shopify Inbox suggested replies** (Shopify Magic): on by default, English only. They don't use the store's ToS or privacy policy — [Shopify Help](https://help.shopify.com/cs/manual/inbox/chat-settings-and-appearance/shopify-magic)
- **Merchant feedback on the Inbox agent is mixed.** One review reports disabling it "due to repeated mistakes that have negatively impacted my bottom line" — [Shopify Inbox reviews (via search)](https://apps.shopify.com/inbox/reviews?page=1)
- **Gorgias:** the App Store listing starts from $60/month. The AI Agent costs about $0.90 per resolution on annual billing and $1.00 monthly, reportedly $1.50 over the bundle. Several sources claim each AI resolution also counts as a billable helpdesk ticket. The tier detail is contested — [Gorgias App Store listing](https://apps.shopify.com/helpdesk); [Ringly](https://www.ringly.io/blog/gorgias-automate-pricing); [myaskai](https://myaskai.com/blog/gorgias-ai-agent-pricing-explained); [eesel (competitor)](https://eesel.ai/blog/gorgias-plans-comparison). One example: about $1,200/month for 1,000 AI resolutions — [eesel (competitor)](https://eesel.ai/blog/gorgias-ai-pricing-complete-2026-cost-breakdown-and-guide)
- **Sacra analysis:** "AI cannibalizing Gorgias' ticket revenue", i.e. a business-model shift from tickets to resolutions — [Sacra](https://sacra.com/chat/h/5433aff9-8670-4bfb-af31-c9a5910808bf/)
- **Intercom Fin:** $0.99 per outcome (counted when the customer confirms resolution), with seats from about $29/seat/month annual. The seat price conflicts across sources ($19 vs $29) — [Intercom pricing](https://www.intercom.com/pricing?pp=env); [Featurebase](https://www.featurebase.app/blog/fin-ai-pricing)
- **Tidio / Lyro:** sources conflict. Base plans are about $29/$49/$69. Lyro is about $39/mo for 100 conversations, or from $32.50/mo per 50. The free plan reportedly includes limited AI replies — [Rework](https://resources.rework.com/tools/chat-messaging/intercom-vs-tidio); [Featurebase](https://featurebase.app/blog/tidio-vs-intercom); [Fudge](https://www.fudge.ai/blog/best-shopify-chatbot-apps/)
- **Help Scout:** free plan, with AI resolutions at $0.75 — [eesel (competitor)](https://www.eesel.ai/blog/gorgias-alternative-shopify)
- **Long-tail AI chatbot apps:** SmartBot 4.8★ (380 reviews), Algoshop AI Sales Chatbot 4.9★ (91), new apps like ShopAssist with 0 reviews, plus Chatty, Zipchat, Shoply, StorePal and Chatmerce — [SmartBot](https://apps.shopify.com/smartbot); [Algoshop](https://apps.shopify.com/reviews/2267232); [ShopAssist](https://apps.shopify.com/shopassist-ai-chatbot); [Zipchat roundup](https://www.zipchat.ai/blog/best-shopify-chatbot-apps-2026)
- **Third-party advice:** a bot without order-data access cannot answer "where is my order", and Gorgias pays off mainly when many tickets need Shopify actions — [eesel](https://www.eesel.ai/blog/best-ai-for-shopify-customer-support)

### Cited Findings — (B) Social-seller DM tools
- **ManyChat:** new five-tier pricing rolled out on 2026-03-02 (Free, Essential, Pro, Business, Advanced). Reported prices conflict: Essential $14–17, Pro about $29–39. The AI add-on ($29) may be legacy or bundled into Pro — [Featurebase](https://www.featurebase.app/blog/manychat-pricing); [G2](https://www.g2.com/products/manychat/pricing)
- **respond.io:** the Growth plan reportedly starts at $199/month (10 users). Contacts and seats are billed separately, and AI credits scale with plan and cannot be bought alone — [SleekFlow blog (competitor)](https://sleekflow.io/blog/respondio-alternatives)
- **SleekFlow:** conflicting figures. Pro is about $109/mo (500 MAC, 10 seats, AI agents), or Premium AI is about $399/mo (5 users) — [respond.io blog (competitor)](https://respond.io/blog/manychat-alternative); [adlibrary comparison](https://adlibrary.com/posts/meta-business-agent-vs-manychat)
- **Wati:** Growth $49/mo, Pro $99, Business $299 (Wati support page). Review audits cite frequent "expensive/pricing issues" complaints — [Wati support](https://support.wati.io/l/en/article/atywjbbe2t-what-is-the-pricing-for-wati); [Codingclave](https://codingclave.com/blog/wati-pricing-india-2026)
- **India BSPs:** AiSensy Basic ₹1,500 + GST and Pro ₹3,200 (or ₹3,499 after an increase). Interakt Starter about ₹2,499 and Growth about ₹2,799. Meta fees pass through on top, e.g. marketing about ₹1.09/msg and utility about ₹0.145 — [go4whatsup](https://go4whatsup.com/blog/aisensy-vs-wati-vs-interakt-pricing-showdown-2026/); [richautomate (June 2026)](https://richautomate.in/compare/wati-vs-aisensy-vs-interakt-vs-richautomate); [Codingclave](https://codingclave.com/blog/aisensy-pricing-india-2026)
- **Live-commerce comment-to-order tools:** SoldLive (Shopify app, FB + IG live, from about $35–50/mo) and Selmo (Basic $89/mo). Thai sellers use external tools that parse product codes in comments and DM a payment link. Filipino sellers still capture Facebook Live orders manually since Meta removed its Live Shopping feature — [SoldLive](https://apps.shopify.com/soldlive); [Selmo](https://apps.shopify.com/selmo?locale=th); [Relevant Audience](https://www.relevantaudience.com/ecommerce-marketing/what-is-live-commerce/); [BigSeller](https://www.bigseller.pro/blog/articleDetails/4531/mastering-facebook-live-orders-2026-tips-for-filipino-sellers.htm)
- **Shopee is piloting Facebook Live checkout** in Thailand, Indonesia, Vietnam and the Philippines — [Malay Mail, 2025-10-22](https://www.malaymail.com/news/money/mediaoutreach/2025/10/22/shopee-to-empower-creators-and-small-businesses-with-new-shopping-experiences-on-meta/421045)

### Inferences
- Price anchors a newcomer must beat (estimate): per-resolution pricing at about $0.75–1.00 for Western mid-market, $15–50/mo flat for SMB chatbots, and ₹1,500–3,500/mo (about $18–42) for Indian WhatsApp BSPs. A solo entrant cannot outspend these companies on features. It needs either a narrower wedge or radically simpler, cheaper flat pricing.
- In (A), the paid tier is squeezed between free (Shopify Inbox agent) and established helpdesks. Gorgias's per-resolution model creates bill-shock complaints, an opening for a predictable flat price (inference supported by the volume of "Gorgias too expensive" content).
- In (B), incumbents are horizontal "inbox + broadcast" tools. Few are built around the informal social seller who has no website, takes orders in DMs and comments, and collects payment by COD or mobile wallet. Regional comment-to-order tools exist but look fragmented (inference).

### Gaps
- No exact count of AI chatbot apps in the Shopify App Store (apps.shopify.com was unreachable). StoreCensus tracks only the top 25 chat apps.
- Rep AI, Zendesk AI agent, Chatfuel, Zoko, Gallabox and Kommo pricing were not verified in this pass.
- G2/Capterra ratings were not collected.

## Q3. Platform-native AI and commoditization risk

### Takeaway
High for both ideas. Shopify now ships a free Inbox AI agent that answers product, shipping and returns questions. Meta launched Meta Business Agent (June 3, 2026) across WhatsApp, Instagram and Messenger: catalog Q&A, lead qualification, closing sales, human handoff, already with 1M+ businesses. These directly overlap the core of (A) and (B). Third-party value must come from deeper actions (orders, returns, payments, logistics), multi-channel unification, languages and vertical workflows.

### Cited Findings
- **Meta Business Agent** launched 2026-06-03 at Meta's Conversations event. It answers catalog product questions, books appointments, qualifies leads, closes sales and lets businesses set when humans step in. It spans the WhatsApp Business app, Instagram Pro, Messenger and Meta Business Suite — [Meta Newsroom](https://about.fb.com/news/2026/06/meta-business-agent/) (summarised via search); [Business Today](https://www.businesstoday.in/technology/artificial-intelligence/story/meta-unveils-ai-business-agent-platform-for-whatsapp-instagram-and-messenger-534739-2026-06-03); [Dataconomy](https://dataconomy.com/2026/06/04/meta-ai-business-agents-whatsapp-instagram-messenger/)
- **Availability conflict:** TechCrunch says it is "available globally" in WhatsApp. Meta's wording reportedly says it is "starting with a select number of businesses" — [TechCrunch](https://www.techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/)
- **Meta Business Agent pricing:** TechCrunch reports it will be monetised through tiers of WhatsApp Business Premium, with token-based billing for large businesses. Other sources say paid plans are TBD — [TechCrunch](https://www.techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/); [DEV (secondary)](https://dev.to/creeta/meta-business-ai-went-global-gated-rollout-paid-plans-tbd-16j0)
- **UC Today** frames the launch as Meta taking on enterprise rivals (i.e. its own BSP/partner ecosystem) — [UC Today](https://www.uctoday.com/unified-communications/meta-launches-ai-business-agent-inside-whatsapp-to-take-on-enterprise-rivals/)
- **Shopify Inbox agent** (free with Inbox) answers product, shipping, returns, sizing and policy questions, with handoff — [Shopify Help](https://help.shopify.com/en/manual/inbox/ai)
- **Sidekick** is Shopify's admin-side assistant (merchant-facing), and part of the Shopify Magic suite — [Digital Commerce 360](https://www.digitalcommerce360.com/2025/05/08/shopify-sidekick-ai-tool-ecommerce-platform-update/)
- A comparison of "Meta Business Agent vs ManyChat vs SleekFlow" already exists, showing that third-party vendors see it as a direct competitor — [adlibrary](https://adlibrary.com/posts/meta-business-agent-vs-manychat)

### Inferences
- (B) carries the highest platform risk. Meta controls the channel, the API, the pricing and now a competing first-party agent. A simple "AI answers price questions in DMs" product is likely commoditised for small sellers on the WhatsApp Business app. A defensible (B) needs order management, inventory, payment links, COD and courier booking, and invoicing, plus merging FB, IG and WA with TikTok or the web, which Meta's agent will not do for rivals' channels.
- For (A), the Shopify Inbox agent covers pre-sale Q&A. Post-purchase actions (order edits, returns and exchanges, refunds, subscriptions, email tickets, WISMO with carrier data) and multi-channel email support remain the third-party domain. That is where Gorgias and others focus.

### Gaps
- Whether the Shopify Inbox agent can perform order lookups and returns (versus Q&A only) was not confirmed.
- Meta Business Agent's language coverage, country list and API/partner access for BSPs were not confirmed (page blocked).

## Q4. Underserved gaps for a new entrant

### Takeaway
The evidence suggests the remaining openings are narrow wedges, not horizontal chatbots: non-English and multilingual (Shopify suggested replies are English-only), predictable flat pricing versus per-resolution bill shock, and the informal social seller in emerging markets who needs DM/comment-to-order plus COD, courier and payment workflows. Most items in this section are inferences, with limited direct evidence.

### Cited Findings
- Shopify Inbox suggested replies are available only in English — [Shopify Help](https://help.shopify.com/cs/manual/inbox/chat-settings-and-appearance/shopify-magic)
- Per-resolution pricing (Gorgias about $0.90–1.50, Fin $0.99) generates cost criticism, and one source calls Gorgias "prohibitively expensive for most small stores" — [Ringly](https://www.ringly.io/blog/gorgias-automate-pricing); [Tidio vs Gorgias](https://ecabnet25-star.github.io/AIForEcom/tidio-vs-gorgias.html)
- Wati reviews frequently mention "Expensive" and "Pricing issues" — [Codingclave](https://codingclave.com/blog/wati-pricing-india-2026)
- Filipino sellers capture Facebook Live orders manually since Meta removed Live Shopping. Thai sellers rely on comment-code-to-payment-link tools — [BigSeller](https://www.bigseller.pro/blog/articleDetails/4531/mastering-facebook-live-orders-2026-tips-for-filipino-sellers.htm); [Relevant Audience](https://www.relevantaudience.com/ecommerce-marketing/what-is-live-commerce/)
- 87% of customers require human access, which makes good handoff a requirement — [Gartner](https://www.gartner.com/en/newsroom/press-releases/2026-08-04-gartner-survey-finds-87-percent-of-customers-say-companies-using-genai-for-customer-service-must-provide-access-to-a-human-agent0)

### Inferences (estimates, not verified)
- **(A) wedges:**
  1. Non-English Shopify stores: Spanish/LatAm, Portuguese/Brazil, Arabic/MENA RTL, Indonesian, Bengali/Hindi.
  2. Verticals with complex post-purchase needs: apparel sizing and exchanges, made-to-order or personalised products, subscriptions, B2B wholesale.
  3. A flat-price "email + chat WISMO and returns autopilot" for $10k–$100k/mo GMV stores that find Gorgias too expensive and Inbox too shallow.
  4. Built-for-Shopify quality plus fast onboarding. Install base is concentrated, so App Store ranking and reviews are the main distribution channel.
- **(B) wedges:**
  1. Informal social sellers (no website) in Bangladesh, India, Pakistan, Indonesia, the Philippines, Nigeria, Egypt, Latin America. Needs: Bangla/Banglish and code-mixed language, COD confirmation, courier booking (e.g. local couriers), mobile-wallet payment links, order sheet and invoice.
  2. Comment-to-DM-to-order for live and posts across FB plus IG plus TikTok in one place.
  3. Very low pricing ($5–20/mo, local currency).

  Global English-speaking DTC brands in (B) are well served by ManyChat and respond.io.
- **Overall (estimate):** (A) has higher ARPU and a clearer channel (the Shopify App Store), but is crowded and Shopify is moving up. (B) has a larger long-tail population and less sophisticated incumbents in emerging markets, but low ARPU and existential Meta platform risk.

### Gaps
- No quantitative data found on the size of the informal social-seller segment globally or in Bangladesh specifically.
- Reddit and merchant-forum validation of these gaps was not obtained.

## Q5. Platform requirements and risks

### Takeaway
WhatsApp moved to per-message pricing on 2025-07-01, with service replies inside the 24-hour window free. That favours reactive AI support and penalises outbound marketing. Since 2026-01-15, WhatsApp terms ban general-purpose AI assistants from the Business API, though business-specific support and sales bots remain allowed. Instagram and Messenger automation needs Meta App Review (Advanced Access) when serving others' accounts, plus a mandatory human-escalation path.

### Cited Findings
- **WhatsApp per-message pricing** (from 2025-07-01): Meta charges per delivered template message and does not charge for user-to-business messages. Free categories include messages within free-entry-point windows and service messages. Free-form service replies within the 24-hour customer service window are free. Utility templates sent inside an open service window are also free (per Salesforce rate card) — [Meta Developers: Pricing](https://developers.facebook.com/docs/whatsapp/pricing); [Salesforce rate card Jul 2025 (PDF)](https://www.salesforce.com/en-us/wp-content/uploads/sites/4/WhatsApp_Business-Messaging-WhatsApp-Rate_Card_Jul_1_2025-to-Jul-31-2025.pdf); [Zoho](https://help.zoho.com/portal/es/community/topic/whatsapp-pricing-changes-pay-per-message-starting-july-1-2025)
- Service conversations became free for all businesses on 2024-11-01, explicitly "including via AI-enabled conversational experiences" — [Meta: Conversation-based pricing (deprecated)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing/)
- **India example rates passed through by BSPs:** marketing about ₹1.09/msg, utility and authentication about ₹0.145 — [Codingclave](https://codingclave.com/blog/aisensy-pricing-india-2026)
- **WhatsApp general-purpose chatbot ban:** terms announced October 2025, effective 2026-01-15 (new users since 2025-10-15). They bar AI model providers from distributing general-purpose assistants (ChatGPT, Perplexity, Luzia, Poke named). Support, sales and notification bots remain allowed. The wording gives Meta broad discretion — [TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform); [respond.io](https://respond.io/blog/whatsapp-chatbot-policy-2026); [TechRadar](https://techradar.com/ai-platforms-assistants/meta-will-ban-rival-ai-chatbots-from-whatsapp)
- **Instagram App Review:** Advanced Access through App Review is needed to serve professional accounts you don't own or manage. At least one successful API call is required before submitting — [Meta: App Review for Instagram API](https://developers.facebook.com/docs/instagram-platform/app-review); [Apps for other businesses](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/app-review/apps-for-other-businesses)
- **Instagram Messaging:** apps must provide an escalation path to a human agent. The `human_agent` tag allows replies within 7 days of a user message, but is only for custom inboxes handling human escalation. Private replies to comments can be sent within 7 days of the comment — [Meta: Instagram Messaging overview](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/overview); [Private Replies](https://developers.facebook.com/docs/messenger-platform/instagram/features/private-replies/)
- **Practical tip (not official policy):** reviewers want a clear explanation of `human_agent` tag usage — [Chatwoot docs](https://developers.chatwoot.com/self-hosted/instagram-app-review)

### Inferences
- **For (B), a newcomer must either:**
  1. Become a Meta Tech Provider and pass App Review and Business Verification for WhatsApp Cloud API, IG and Messenger permissions. This takes weeks and requires a privacy policy, screencasts and a verified business.
  2. Build on top of a BSP or aggregator (e.g. 360dialog, Twilio, Gupshup), at the cost of margin.

  The 24-hour window means the AI must reply fast and order follow-ups must use paid templates. Meta can change pricing or policy unilaterally (precedents: the 2024 and 2025 pricing changes, the 2026 AI ban, the removal of Live Shopping).
- **For (A), Shopify App Store review** (protected customer data access for order and customer data, GDPR webhooks, Billing API, Built for Shopify criteria) is the main gate. In general knowledge, it is a lower existential risk than Meta's, but Shopify's free Inbox agent caps pricing power.

### Gaps
- Shopify App Store review requirements, revenue share (commonly 0% on the first $1M and 15% after) and Built for Shopify criteria were not verified via sources in this pass.
- Current WhatsApp per-message rate card figures by country (USD) were not retrieved, and Meta's rate-card page was not fetched.
- Whether Meta Business Agent is offered to or through BSPs, or competes with them, is unconfirmed.
- Blocked hosts in this session: about.fb.com, apps.shopify.com, gorgias.com, manychat.com. They must be allowed for direct verification.
