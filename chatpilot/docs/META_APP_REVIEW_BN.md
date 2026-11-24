# Meta App Review — জমা দেওয়ার গাইড (ChatPilot AI)

ChatPilot একটাই **Meta অ্যাপ** ব্যবহার করে (আপনার, প্ল্যাটফর্ম মালিকের)। দোকানদাররা শুধু **"Connect with Facebook"** চাপে, Facebook-এর ডায়ালগে নিজের Page / Instagram / WhatsApp বেছে নেয় — তাদের নিজের developer app লাগে না। তাই App Review একবারই, আপনার অ্যাপের জন্য।

> Review পাস না হওয়া পর্যন্ত শুধু অ্যাপে role আছে এমন লোকরা (Admin / Developer / Tester) কানেক্ট করতে পারবে। তাদের দিয়েই প্রথমে সব টেস্ট করুন।

---

## ধাপ ১ — Business Verification
1. business.facebook.com → Settings → **Security Center → Start verification**।
2. ট্রেড লাইসেন্স / ইনকর্পোরেশন ডকুমেন্ট, ঠিকানা, ফোন, ওয়েবসাইট (`APP_URL`) দিন। ওয়েবসাইটে কোম্পানির নাম থাকতে হবে — Admin → Settings → *Company legal name* পূরণ করলে Terms/Privacy-তে স্বয়ংক্রিয় আসে।
3. সাধারণত ২–১০ কর্মদিবস লাগে।

## ধাপ ২ — অ্যাপ তৈরি ও সেটিং
1. developers.facebook.com → **Create app → Business** টাইপ। আপনার verified Business Portfolio-র সাথে যুক্ত করুন।
2. **Products** যোগ করুন: *Facebook Login for Business*, *Messenger*, *Instagram* (Instagram API with Facebook Login), *WhatsApp*, *Webhooks*।
3. **App settings → Basic**:
   - Privacy Policy URL: `https://আপনার-ডোমেইন/privacy`
   - Terms of Service URL: `https://আপনার-ডোমেইন/terms`
   - User data deletion → **Data deletion callback URL**: `https://আপনার-ডোমেইন/api/meta/data-deletion`
   - App icon (1024×1024), Category: *Business and pages*
   - App ID ও App Secret কপি করে ChatPilot **Admin → Settings → Meta**-তে বসান।
4. **Facebook Login for Business → Settings**:
   - Valid OAuth Redirect URI: `https://আপনার-ডোমেইন/api/oauth/meta/callback`
   - Deauthorize callback URL: `https://আপনার-ডোমেইন/api/meta/deauthorize`
   - (ঐচ্ছিক, প্রস্তাবিত) **Configurations** থেকে দুটো কনফিগারেশন বানান: (ক) Pages + Instagram — নিচের permission গুলো সহ, token type *User access token*; (খ) WhatsApp Embedded Signup — token type *System-user access token* (মেয়াদ শেষ হয় না)। Configuration ID দুটো Admin → Settings → Meta-তে বসান।
5. **Webhooks**: Callback URL `https://আপনার-ডোমেইন/api/social/webhook`, Verify token = Admin → Settings → Meta-র *Webhook verify token* (যেকোনো লম্বা random লেখা; একই লেখা দুই জায়গায়)।
   - Object **Page**: `messages`, `message_echoes`, `messaging_postbacks`, `feed` (পোস্টের কমেন্ট)
   - Object **Instagram**: `messages`, `comments`
   - Object **WhatsApp Business Account**: `messages`

## ধাপ ৩ — যে permission গুলো চাইবেন ও কেন (জমার ফর্মে কপি করুন)

| Permission | কেন লাগবে (English — ফর্মে এটাই লিখুন) |
|---|---|
| `email`, `public_profile` | "Continue with Facebook" creates the shop owner's ChatPilot account (name and email) in the same step as connecting their Pages. |
| `pages_show_list` | To let the business owner choose which of their Facebook Pages to connect to ChatPilot in our connection dialog. |
| `pages_messaging` | To receive customer messages sent to the business's Page and send replies (written by the business's AI assistant and approved or configured by the business) within the 24-hour standard messaging window. |
| `pages_manage_metadata` | To subscribe our app to the Page's messaging webhooks so new customer messages reach ChatPilot. |
| `pages_read_engagement` | To read the Page name and linked Instagram account so the owner can identify the right Page. |
| `pages_read_user_content` | To read comments on the business's posts and the Page's past conversations, so ChatPilot can answer new comments and learn how the business usually replies (used only inside that business's own workspace). |
| `pages_manage_engagement` | To post the business's reply under a customer's comment on the Page's posts. |
| `instagram_manage_comments` | To read and reply to comments on the business's Instagram posts. |
| `instagram_basic` | To show the business's Instagram professional account username when connecting. |
| `instagram_manage_messages` | To receive and reply to Instagram Direct messages sent to the business's professional account. |
| `business_management` | To list the Pages and WhatsApp Business Accounts the owner granted through Facebook Login for Business. |
| `whatsapp_business_management` | To find the WhatsApp Business Account and phone numbers the owner shared and subscribe our app to their webhooks. |
| `whatsapp_business_messaging` | To receive customer WhatsApp messages and send replies within the 24-hour customer service window. |

**App use-case বর্ণনা (English):**
> ChatPilot is a customer-service and sales inbox for small online shops. Owners sign up with "Continue with Facebook", which creates their account and connects the Pages they select in one step. Shop owners connect their Facebook Page, Instagram professional account and WhatsApp Business number. When a customer asks about a product (price, size, stock, delivery), ChatPilot's assistant drafts a reply using only the shop's own product catalog and policies. The shop owner approves each reply (Draft mode) or allows automatic replies for routine questions (Auto-pilot). Complaints, refunds and anything uncertain are always handed to a human. Replies are only sent within Meta's 24-hour messaging window, in response to the customer's message. It learns the business's own reply style and facts from the Page's conversations and comment replies; this data stays in that business's workspace and is deleted when the Page is disconnected. It also replies to comments on the business's posts. Owners can disconnect at any time, which deletes the conversations and everything learned from them.

## ধাপ ৪ — Screencast (প্রতিটা permission-এর জন্য দেখাতে হবে)
একটা ৩–৫ মিনিটের ভিডিও (ইংরেজি UI, স্ক্রিনে কী হচ্ছে লেখা থাকলে ভালো), টেস্ট Page আর টেস্ট WhatsApp নম্বর দিয়ে:
1. `https://আপনার-ডোমেইন/signup` → **Continue with Facebook** → Facebook ডায়ালগ (permission স্ক্রিন স্পষ্ট দেখান) → Page বেছে নিন → সরাসরি ChatPilot-এ "You're live" পেজ।
2. **Learning** পেজে দেখান: Page-এর আগের কথোপকথন থেকে কী শিখেছে (`pages_read_user_content`)।
3. অন্য একটা ফোন/অ্যাকাউন্ট থেকে Page-এ মেসেজ: "What is the price of the black hoodie?" → ChatPilot **Chats**-এ মেসেজ আসছে, AI draft দেখা যাচ্ছে → **Send** → Messenger-এ উত্তর পৌঁছেছে দেখান। (`pages_messaging`, `pages_manage_metadata`)
4. Instagram DM-এ একই কাজ। (`instagram_manage_messages`, `instagram_basic`)
5. **Channels → WhatsApp → Connect** → Embedded Signup → নম্বর সিলেক্ট → WhatsApp-এ মেসেজ পাঠিয়ে উত্তর দেখান। (`whatsapp_business_*`, `business_management`)
6. Page-এর একটা পোস্টে কমেন্ট করুন → ChatPilot কমেন্টের নিচে উত্তর দেয় আর ইনবক্সে বিস্তারিত পাঠায় (`pages_manage_engagement`, `pages_messaging`); Instagram পোস্টে একই (`instagram_manage_comments`)।
7. **Take over** বাটন (মানুষ উত্তর দিলে AI থামে) এবং **Disconnect** (ডেটা মুছে যায়) দেখান।
8. Facebook Settings → Business integrations থেকে অ্যাপ রিমুভ → ChatPilot-এ চ্যানেল বন্ধ হয়ে যায় (deauthorize callback)।

রিভিউয়ারের জন্য একটা **টেস্ট লগইন** দিন: ChatPilot-এ একটা অ্যাকাউন্ট (ইমেইল+পাসওয়ার্ড, 2FA বন্ধ) যেখানে প্রোডাক্ট আগে থেকেই আছে, আর নির্দেশ: "Sign in → Channels → Connect"।

## ধাপ ৫ — জমার আগে চেকলিস্ট
- [ ] `APP_URL` HTTPS-এ লাইভ, `/privacy`, `/terms`, `/security` খোলে, কোম্পানির নাম ও ঠিকানা বসানো (Admin → Settings)।
- [ ] Admin → Settings → Meta: App ID, App Secret, Verify token (+ Configuration ID) বসানো; Admin → Settings → AI: Anthropic API key।
- [ ] Webhook "Verify and save" সফল (ChatPilot নিজে hub.challenge ফেরত দেয়)।
- [ ] টেস্ট Page, Instagram ও WhatsApp টেস্ট নম্বর দিয়ে পুরো ফ্লো কাজ করছে।
- [ ] `npm run check:ai` — আসল Claude দিয়ে উত্তরের মান পরীক্ষা (নিচে দেখুন) পাস।
- [ ] Data deletion: Facebook-এর *Send deletion request* টেস্ট করে `/deletion?code=…` পেজ খোলে।
- [ ] Business Verification সম্পন্ন।

## Review পাসের পর
- **App Mode → Live** করুন। এখন যে কোনো দোকানদার কানেক্ট করতে পারবে।
- WhatsApp: প্রতিটা নম্বরের display name Meta অনুমোদন করে; নতুন নম্বর দিনে ২৫০ জন নতুন গ্রাহককে বার্তা পাঠাতে পারে (Business-initiated) — ChatPilot শুধু গ্রাহকের মেসেজের উত্তর দেয়, তাই সাধারণত সমস্যা নেই।
- প্রতি ৯০ দিন অন্তর Meta *Data Use Checkup* চাইতে পারে — App Dashboard-এ নোটিফিকেশন দেখুন।

## আসল AI দিয়ে মান যাচাই
```bash
cd chatpilot
ANTHROPIC_API_KEY=sk-ant-... npm run check:ai
```
এটা ১০টা বাস্তব কথোপকথন (বাংলা, Banglish, English; দরদাম, অভিযোগ, প্রম্পট-ইনজেকশন, অর্ডার) আসল Claude-কে পাঠিয়ে দেখে: উত্তর ঠিক ভাষায় কিনা, দাম ক্যাটালগের বাইরে যায় কিনা, অর্ডারের ধাপ ঠিক কিনা, আর কোন কেসে মানুষের কাছে হস্তান্তর হয়। কোনো মেসেজ কাউকে পাঠানো হয় না। খরচ মোটামুটি কয়েক সেন্ট।
