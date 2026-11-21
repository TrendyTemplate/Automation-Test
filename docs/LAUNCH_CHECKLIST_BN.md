# 🚀 লঞ্চ চেকলিস্ট — ধাপে ধাপে আপনাকে যা করতে হবে

এই গাইডটা ক্রম অনুযায়ী সাজানো। উপরের ধাপগুলো আগে করবেন। প্রতিটা ধাপের পাশে আনুমানিক খরচ আর সময় দেওয়া আছে।
অ্যাডমিন প্যানেলের **System health** পেজে একটা "Launch readiness" তালিকা আছে। কোন ধাপ বাকি আছে, সেটা ওখানে সবুজ/হলুদ রঙে দেখাবে।

---

## ধাপ ১ — নাম, ডোমেইন, ব্র্যান্ড (১–২ দিন, ~$10–15/বছর)
- [ ] প্রোডাক্টের নাম ঠিক করুন। "MailPilot AI" নামটা অস্থায়ী, নিজের নাম দিলে ভালো। ট্রেডমার্ক আছে কিনা দেখে নিন: uspto.gov, euipo.europa.eu।
- [ ] ডোমেইন কিনুন (Namecheap, Cloudflare, Porkbun)। যেমন `yourbrand.com`। অ্যাপ চালাবেন `app.yourbrand.com`-এ।
- [ ] লোগো বানান (Canva বা Figma)। নাম বদলালে `public/` ফোল্ডারের HTML-এ নাম বদলাবেন। Admin → Settings → General → Product name-ও বদলাতে হবে।
- [ ] একটা সাপোর্ট ইমেইল খুলুন, যেমন `support@yourbrand.com` (Zoho Mail ফ্রি / Google Workspace)।

## ধাপ ২ — সার্ভার ও ডিপ্লয় (১ দিন, $6–20/মাস)
- [ ] একটা VPS নিন: Hetzner (সবচেয়ে সস্তা), DigitalOcean বা AWS Lightsail। ২ GB RAM যথেষ্ট, শুরুতে প্রায় ৩০০ জন গ্রাহক চালানো যাবে।
- [ ] সার্ভারে Docker ইনস্টল করে কোড আপলোড করুন।
- [ ] `.env.example` কপি করে `.env` বানান, তারপর পূরণ করুন:
  - `NODE_ENV=production`
  - `APP_URL=https://app.yourbrand.com`
  - `JWT_SECRET` আর `ENCRYPTION_KEY`: `openssl rand -hex 32` দিয়ে বানাবেন
  - `ADMIN_EMAILS=আপনার-ইমেইল`
- [ ] ⚠️ `ENCRYPTION_KEY` অন্তত ২ জায়গায় নিরাপদে রাখুন (পাসওয়ার্ড ম্যানেজার + অফলাইন)। এটা হারালে সব গ্রাহকের মেইলবক্স সংযোগ নষ্ট হয়ে যাবে।
- [ ] `docker compose up -d --build`
- [ ] HTTPS চালু করুন। সবচেয়ে সহজ উপায় Cloudflare (ফ্রি) অথবা Caddy সার্ভার।
- [ ] `ADMIN_EMAILS`-এর ইমেইল দিয়ে সাইন-আপ করুন। মেনুতে "Platform admin" দেখা যাবে।
- [ ] ব্যাকআপ: Admin → System health → **Download database backup**। প্রতি সপ্তাহে নামিয়ে রাখুন, অথবা সার্ভারে cron দিয়ে `data/` ফোল্ডার কপি করুন।

## ধাপ ৩ — AI চালু করা (৩০ মিনিট, ব্যবহার অনুযায়ী খরচ)
- [ ] console.anthropic.com-এ অ্যাকাউন্ট খুলে API key নিন। বিলিংয়ে কিছু ক্রেডিট যোগ করুন।
- [ ] Admin → Settings → AI → API key বসান। মডেল ডিফল্ট রাখুন। Effort = `low` রাখলে খরচ সবচেয়ে কম।
- [ ] খরচের হিসাব: Admin → **AI usage & cost** পেজে প্রতিটা গ্রাহকের আনুমানিক খরচ দেখা যায়। প্ল্যানের দামের তুলনায় খরচ বেশি হলে প্ল্যানের AI লিমিট কমিয়ে দিন।
- [ ] Anthropic console-এ মাসিক খরচের সীমা (spend limit) সেট করুন, যাতে হঠাৎ বড় বিল না আসে।

## ধাপ ৪ — সিস্টেম ইমেইল (১ ঘণ্টা, ফ্রি–$15/মাস)
পাসওয়ার্ড রিসেট, ইমেইল ভেরিফিকেশন, ডেইলি ব্রিফিং আর অ্যালার্ট পাঠাতে এটা লাগবে।
- [ ] একটা ট্রানজ্যাকশনাল ইমেইল সার্ভিস নিন: **Brevo** (ফ্রি ৩০০/দিন), Amazon SES (খুব সস্তা), Postmark বা Resend।
- [ ] ডোমেইনে SPF, DKIM আর DMARC রেকর্ড যোগ করুন। সার্ভিসটাই কী যোগ করতে হবে বলে দেবে। এটা না করলে মেইল স্প্যামে যাবে।
- [ ] Admin → Settings → System email-এ SMTP তথ্য দিন। তারপর **Send test email** চাপুন।

## ধাপ ৫ — "Sign in with Google / Microsoft" ও এক-ক্লিকে Gmail/Outlook সংযোগ (১–২ দিন)

### Google
1. [ ] console.cloud.google.com → নতুন প্রজেক্ট খুলুন।
2. [ ] **OAuth consent screen**:
   - অ্যাপের নাম, লোগো, সাপোর্ট ইমেইল দিন
   - Privacy policy ও Terms-এর লিংক দিন
   - Authorized domain হিসেবে আপনার ডোমেইন দিন
3. [ ] **Credentials → OAuth client ID → Web application** বানান:
   - Redirect URI: `https://app.yourbrand.com/api/oauth/google/callback`
4. [ ] Client ID আর Secret বসান: Admin → Settings → Google & Microsoft sign-in।
5. [ ] "Sign in with Google" শুধু সাধারণ scope (`openid email profile`) ব্যবহার করে। এর জন্য Google-এর ব্র্যান্ড ভেরিফিকেশনই যথেষ্ট (ফ্রি, কয়েক দিন লাগে)।
6. [ ] ⚠️ **এক-ক্লিকে Gmail সংযোগ** নিয়ে জরুরি তথ্য:
   - এটা Gmail-এর *restricted* scope (`https://mail.google.com/`) ব্যবহার করে
   - টেস্ট মোডে ১০০ জন পর্যন্ত ইউজার সঙ্গে সঙ্গে ব্যবহার করতে পারবে
   - এর বেশি হলে Google-এর **restricted scope verification + বার্ষিক CASA সিকিউরিটি অ্যাসেসমেন্ট** লাগবে। তৃতীয় পক্ষের রিপোর্ট অনুযায়ী খরচ মোটামুটি $১০,০০০ থেকে $৭৫,০০০+ (Google কোনো অফিসিয়াল দাম প্রকাশ করেনি)।
   - **পরামর্শ:** শুরুতে গ্রাহকরা Gmail-এর **App Password** দিয়ে কানেক্ট করবে। এটা ফ্রি, সঙ্গে সঙ্গে কাজ করে, আর সফটওয়্যারে আগে থেকেই আছে।
   - ১০০+ পেইড গ্রাহক হলে, যখন আয় দিয়ে খরচ ওঠানো যাবে, তখন CASA করাবেন।
   - ততদিন Admin → Settings-এ "Enable one-click Gmail connect" বন্ধ রাখতে পারেন, অথবা শুধু বেটা ইউজারদের জন্য চালু রাখতে পারেন।

### Microsoft (Outlook, Hotmail, Microsoft 365)
1. [ ] portal.azure.com → **App registrations → New registration**:
   - Supported account types: "Any Azure AD directory + personal Microsoft accounts"
   - Redirect URI (Web): `https://app.yourbrand.com/api/oauth/microsoft/callback`
2. [ ] **Certificates & secrets → New client secret** বানান।
3. [ ] **API permissions** যোগ করুন:
   - Microsoft Graph → `openid`, `email`, `profile`, `offline_access`
   - "APIs my organization uses" → **Office 365 Exchange Online** → `IMAP.AccessAsUser.All`, `SMTP.Send`
4. [ ] Client ID আর Secret অ্যাডমিন প্যানেলে বসান।
5. [ ] Microsoft-এর **Publisher verification** করুন (ফ্রি, Microsoft Partner অ্যাকাউন্ট লাগে)। না করলে গ্রাহকরা "unverified app" সতর্কবার্তা দেখবে।
6. ℹ️ কিছু কোম্পানির Microsoft 365-এ IT অ্যাডমিন IMAP বন্ধ রাখে। সেই গ্রাহককে তাদের অ্যাডমিনকে IMAP/SMTP AUTH চালু করতে বলতে হবে।

### Yahoo, iCloud, Zoho, cPanel, কাস্টম ডোমেইন
- কিছু করতে হবে না। App Password আর IMAP দিয়ে আগে থেকেই কাজ করে।

## ধাপ ৬ — পেমেন্ট (৩–১৪ দিন)
বাংলাদেশ থেকে সরাসরি Stripe অ্যাকাউন্ট খোলা যায় না। বিকল্পগুলো:

| উপায় | খরচ | সুবিধা | অসুবিধা |
|---|---|---|---|
| **Stripe Atlas** (US LLC) | ~$500 একবার + বার্ষিক রেজিস্টার্ড এজেন্ট ফি | বিশ্বজুড়ে কার্ড, সাবস্ক্রিপশন। সফটওয়্যারে আগে থেকেই আছে | US ট্যাক্স ফাইলিং করতে হবে |
| **UK LTD** (Companies House) | ~£50 + অ্যাকাউন্ট্যান্ট | Stripe UK পাওয়া যায় | বার্ষিক রিপোর্টিং |
| **Paddle / Lemon Squeezy** | ৫% + ৫০¢ প্রতি বিক্রি | বিশ্বজুড়ে VAT/ট্যাক্স তারাই সামলায়, কোম্পানি লাগে না | এখনো ইন্টিগ্রেট করা হয়নি (চাইলে যোগ করে দেব) |
| **bKash / Nagad / ব্যাংক / PayPal / Payoneer** | প্রায় ফ্রি | দেশি ও কিছু বিদেশি গ্রাহক | হাতে অ্যাক্টিভেট করতে হয় |

**Stripe সেটআপ (কোম্পানি থাকলে):**
- [ ] Stripe-এ Product বানান:
  - Starter, Pro, Business: প্রতিটার একটা monthly আর একটা yearly Price
  - Lifetime: একটা one-time Price
- [ ] প্রতিটা Price ID (`price_…`) বসান: Admin → **Plans & pricing**।
- [ ] Secret key বসান: Admin → Settings → Payments।
- [ ] Webhook যোগ করুন:
  - URL: `https://app.yourbrand.com/api/billing/webhook`
  - ইভেন্ট: `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`
  - Signing secret অ্যাডমিন প্যানেলে বসান
- [ ] Stripe Settings-এ **Customer portal** চালু করুন, যাতে গ্রাহক নিজেই কার্ড বদলাতে বা বাতিল করতে পারে।
- [ ] চাইলে **Stripe Tax** চালু করুন।

**হাতে পেমেন্ট (bKash ইত্যাদি):**
- [ ] Admin → Settings → Payments → "Manual payment instructions"-এ আপনার bKash নম্বর বা ব্যাংক তথ্য লিখুন। এটা গ্রাহকের Billing পেজে দেখাবে।
- [ ] গ্রাহক টাকা পাঠিয়ে সাপোর্ট টিকিটে ট্রানজেকশন আইডি দেবে। তারপর Admin → **Payments → Record a manual payment** → "Activate plan" টিক দিন। এতেই গ্রাহকের প্ল্যান চালু হয়ে যাবে, রেফারেল কমিশনও হিসাব হবে।

## ধাপ ৭ — Telegram অ্যালার্ট (১৫ মিনিট, ফ্রি)
- [ ] Telegram-এ @BotFather → `/newbot` দিয়ে একটা বট বানান। টোকেন বসান: Admin → Settings → Notifications।
- [ ] গ্রাহকরা নিজেদের Chat ID দিলেই জরুরি মেইল, রাগান্বিত গ্রাহক, VIP, হট লিড বা ফিশিংয়ের অ্যালার্ট ফোনে পাবে।

## ধাপ ৮ — আইনি কাগজপত্র (২–৩ দিন)
- [ ] Admin → Settings → General-এ এগুলো পূরণ করুন:
  - প্রোডাক্টের নাম
  - কোম্পানির আইনি নাম ও ঠিকানা
  - সাপোর্ট ইমেইল

  এগুলো Terms আর Privacy পেজে নিজে থেকে বসে যাবে। কোম্পানির নাম দিলে পেজের উপরের "Template" সতর্কবার্তাও চলে যাবে।
- [ ] `public/terms.html` আর `public/privacy.html`-এ [বন্ধনীর ভেতরের] অংশগুলো পূরণ করুন: তারিখ, রিফান্ড পলিসি, আইনের এখতিয়ার, হোস্টিং প্রোভাইডার।
- [ ] **Terms of Service** আর **Privacy Policy** লিখুন (`public/terms.html`, `public/privacy.html`)। Termly বা iubenda দিয়ে শুরু করতে পারেন, তারপর আইনজীবীকে দেখিয়ে নিন। যা যা উল্লেখ করতে হবে:
  - কী ডেটা রাখা হয় (ইমেইল, মেইলবক্স ক্রেডেনশিয়াল)
  - AI প্রসেসিং: Anthropic-কে সাব-প্রসেসর হিসেবে নাম দিতে হবে
  - ডেটা কতদিন রাখা হয়, আর মুছে ফেলার অধিকার
  - রিফান্ড পলিসি
  - স্প্যাম পাঠানো নিষেধ
- [ ] Google OAuth ব্যবহার করলে Privacy Policy-তে **Google API Services User Data Policy (Limited Use)** মানার কথা লিখতে হবে।
- [ ] ইউরোপের গ্রাহকদের জন্য GDPR: ডেটা এক্সপোর্ট/ডিলিট আর অটো-ডিলিট (retention) ফিচার সফটওয়্যারে আগে থেকেই আছে। একটা DPA (Data Processing Agreement) টেমপ্লেট রেখে দিন।
- [ ] রিফান্ড পলিসি ঠিক করুন। ১৪ বা ৩০ দিনের মানি-ব্যাক দিলে বিক্রি বাড়ে।

## ধাপ ৯ — লঞ্চের আগে নিজে পরীক্ষা (১–২ দিন)
- [ ] নিজের ২–৩টা আসল মেইলবক্স কানেক্ট করুন: Gmail App Password, Outlook আর একটা কাস্টম ডোমেইন।
- [ ] Knowledge base-এ ব্যবসার তথ্য দিন, তারপর নিজের অন্য ঠিকানা থেকে টেস্ট মেইল পাঠান:
  - দাম জানতে চাওয়া মেইল
  - অভিযোগের মেইল
  - স্প্যাম/ফিশিং ধাঁচের মেইল
  - বাংলা ও স্প্যানিশ ভাষার মেইল
- [ ] প্রথমে Draft মোডে দেখুন AI কেমন লেখে। ড্রাফট এডিট করুন (AI এডিট থেকে শেখে কিনা দেখুন)। তারপর Autopilot চালিয়ে দেখুন:
  - Undo উইন্ডো কাজ করছে কিনা
  - VIP প্রেরকের মেইল আটকে যাচ্ছে কিনা
  - ডেইলি ব্রিফিং আসছে কিনা
- [ ] Billing পরীক্ষা করুন Stripe test mode-এ (কার্ড নম্বর `4242 4242 4242 4242`)।
- [ ] নমুনা ডেটা দিয়ে দেখতে চাইলে: `DB_PATH=./data/demo.db node scripts/seed-demo.js` (লগইন: demo@mailpilot.test / Demo-Pass-2026)। **প্রোডাকশন ডাটাবেসে চালাবেন না।**

## ধাপ ১০ — লঞ্চ ও মার্কেটিং
- [ ] ১০–২০ জন বেটা ইউজারকে ফ্রি দিন, বদলে রিভিউ আর টেস্টিমোনিয়াল নিন।
- [ ] ডেমো ভিডিও বানান (৬০–৯০ সেকেন্ড): "৩টা ইনবক্স কানেক্ট → AI নিজে উত্তর দিল → Ask your inbox"। ল্যান্ডিং পেজ আর YouTube-এ দিন।
- [ ] **Product Hunt** লঞ্চ (মঙ্গল থেকে বৃহস্পতিবার সবচেয়ে ভালো)।
- [ ] **AppSumo**-তে Lifetime ডিল বিক্রি। দ্রুত টাকা আর প্রথম গ্রাহক পাওয়ার জন্য দারুণ। তবে লিমিট ঠিকঠাক রাখবেন, যাতে AI খরচে লস না হয়।
- [ ] Reddit (r/SaaS, r/smallbusiness, r/Entrepreneur), Indie Hackers, LinkedIn, Facebook গ্রুপ।
- [ ] SEO ব্লগ লিখুন: "AI email auto reply for Outlook", "Zoho mail AI assistant", "cPanel email AI"। প্রতিযোগীরা এসব জায়গায় দুর্বল।
- [ ] রেফারেল প্রোগ্রাম চালু আছে (ডিফল্ট ৩০% কমিশন)। ইউটিউবার আর এজেন্সিদের অ্যাফিলিয়েট হিসেবে আমন্ত্রণ জানান।
- [ ] লঞ্চের পর প্রতিদিন Admin → Overview, Mailbox monitor (এরর) আর Support tickets দেখবেন।

---

## ধাপ ১১ — সিকিউরিটি (লঞ্চের আগে অবশ্যই করবেন)
- [ ] **অ্যাডমিন অ্যাকাউন্টে 2FA চালু করুন** (Security & privacy পেজে)। প্রোডাকশনে 2FA ছাড়া অ্যাডমিন প্যানেল খুলবেই না — এটা ইচ্ছা করেই রাখা।
- [ ] `ENCRYPTION_KEY` আর `JWT_SECRET` শক্তিশালী ও আলাদা রাখুন। ডাটাবেস ব্যাকআপ যেখানে রাখেন, `ENCRYPTION_KEY` সেখানে রাখবেন না। দুটো একসাথে চুরি না হলে ডেটা পড়া যাবে না।
- [ ] `ALLOW_PRIVATE_MAIL_HOSTS` কখনো `true` করবেন না। এটা শুধু টেস্টের জন্য।
- [ ] চাইলে Admin → Settings → Security-তে আপনার অফিস/বাসার IP দিয়ে অ্যাডমিন প্যানেল শুধু সেখান থেকে খোলার ব্যবস্থা করতে পারেন।
- [ ] প্রতি সপ্তাহে Admin → **Security center** দেখবেন:
  - ব্যর্থ লগইন চেষ্টা
  - লক হওয়া অ্যাকাউন্ট
  - কোন অ্যাডমিনের 2FA চালু নেই
  - কোনো ডেটা এনক্রিপ্ট ছাড়া রয়ে গেছে কিনা
- [ ] বছরে অন্তত একবার encryption key বদলান। পদ্ধতি `docs/SECURITY.md`-এ আছে। key বদলালে কোনো ডেটা হারায় না।
- [ ] বড় পরিসরে লঞ্চের আগে একটা পেশাদার penetration test (বাইরের সিকিউরিটি বিশেষজ্ঞ দিয়ে হ্যাকিং-পরীক্ষা) করানো ভালো। শুরুতে HackerOne-এর মতো bug bounty প্ল্যাটফর্মও ব্যবহার করা যায়।
- [ ] গ্রাহকদের বলবেন: Security & privacy পেজে 2FA চালু করতে। সাপোর্টের জন্য অ্যাকাউন্ট অ্যাক্সেস দরকার হলে গ্রাহক নিজে "Support access" দেবে — আপনি নিজে থেকে ঢুকতে পারবেন না। এটা গ্রাহকের আস্থার জন্য বড় বিষয়।
- [ ] `npm audit --omit=dev` চালিয়ে মাসে একবার ডিপেন্ডেন্সি আপডেট করুন (এখন ০টা দুর্বলতা)।

## খরচের সারসংক্ষেপ (শুরুতে)
| জিনিস | মাসিক খরচ |
|---|---|
| সার্ভার (VPS) | $6–20 |
| ডোমেইন | ~$1 |
| ট্রানজ্যাকশনাল ইমেইল | $0–15 |
| AI (প্রতি গ্রাহক, মাঝারি ব্যবহার) | প্রায় $1–5 (ভলিউম আর effort-এর উপর নির্ভর করে) |
| Stripe | প্রতি পেমেন্টে ~২.৯% + ৩০¢ |
| **মোট (প্রথম ২০ গ্রাহক পর্যন্ত)** | **প্রায় $30–100** |

২০ জন Pro গ্রাহক মানে মাসে $980 আয়। খরচ বাদ দিলে লাভ প্রায় ৮৫–৯০%।
