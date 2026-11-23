# Delaywise: সেটআপ ও লঞ্চ গাইড (বাংলা)

এই গাইড ডেভেলপার নন এমন কারও জন্য লেখা। প্রতিটা ধাপ ক্রমানুসারে করুন। কোথাও আটকে গেলে স্ক্রিনশট নিয়ে Claude-কে দেখান।

> ⏱️ মোট সময়: অ্যাকাউন্ট আর সেটআপে ১–২ দিন। এরপর Shopify-র রিভিউতে সাধারণত ২–৪ সপ্তাহ বা তার বেশি।

---

## ধাপ ০: আগে যাচাই করুন (বিনা খরচে)

1. [partners.shopify.com](https://partners.shopify.com)-এ ফ্রি **Partner অ্যাকাউন্ট** খুলুন।
2. **Settings → Payouts**-এ গিয়ে দেখুন বাংলাদেশের ব্যাংক অ্যাকাউন্টে টাকা নেওয়ার অপশন আছে কিনা। Payoneer চলবে না, আসল ব্যাংক অ্যাকাউন্ট লাগবে।
3. অপশন না থাকলে এখানেই থামুন। পরের ধাপে খরচ শুরু হবে।

## ধাপ ১: যে অ্যাকাউন্টগুলো লাগবে

| সার্ভিস | কেন লাগবে | খরচ |
|---|---|---|
| Shopify Partner | অ্যাপ বানানো আর App Store-এ বিক্রি | ফ্রি |
| Shopify **development store** | অ্যাপ টেস্ট করার দোকান (Partner Dashboard → Stores → Add store) | ফ্রি |
| [Anthropic Console](https://console.anthropic.com) | Claude দিয়ে ইমেইল লেখার API key | ব্যবহার অনুযায়ী (প্রতি ইমেইলে ১ সেন্টের মতো) |
| [Resend](https://resend.com) | কাস্টমারকে ইমেইল পাঠানো। নিজের ডোমেইন verify করতে হবে | শুরুতে ফ্রি |
| [Ship24](https://www.ship24.com) (ঐচ্ছিক) | Shopify-র কাছে যেসব পার্সেলের তথ্য নেই সেগুলোর ট্র্যাকিং | ফ্রি টিয়ার থেকে শুরু |
| হোস্টিং (Render, Fly.io বা Railway) | অ্যাপ ২৪ ঘণ্টা চালু রাখা | মাসে ~$৭–২০ |
| ডোমেইন | ইমেইল পাঠানো আর অ্যাপের ঠিকানা | বছরে ~$১০–১৫ |

## ধাপ ২: Partner Dashboard-এ অ্যাপ তৈরি

1. Partner Dashboard → **Apps → Create app → Create app manually** → নাম দিন `Delaywise`।
   - App Store-এ একই নামের অ্যাপ থাকলে অন্য নাম নিন। তখন `shopify.app.toml`-এ `name` আর `handle` বদলাতে হবে।
2. **Client ID** আর **Client secret** কপি করে রাখুন।
3. **API access → Protected customer data**-তে গিয়ে অনুমতি চান:
   - **Level 1** (অর্ডারের তথ্য) আর Level 2-এর **Email** আর **Address** ফিল্ড নিন। Address লাগে শুধু গন্তব্য দেশের কোড বুঝতে। নাম আর ফোন নেবেন না।
   - কারণ লিখুন: *"Email: to send the customer a shipping-delay update (read at send time, never stored; optionally sent to the merchant's own Klaviyo when they connect it). Address: destination country only, to estimate international transit times."*
   - নিরাপত্তার প্রশ্নগুলোর উত্তর দিন। গোপন key এনক্রিপ্টেড থাকে, আর কাস্টমারের যোগাযোগের তথ্য সংরক্ষণ করা হয় না।
   - ⚠️ অনুমতি না পেলে অ্যাপ ইমেইল পাঠাতে পারবে না। তখন Messages পেজে এ কথা স্পষ্ট লেখা দেখাবে।

## ধাপ ৩: হোস্টিংয়ে অ্যাপ চালু করা

Claude আপনার সাথে এই ধাপটা ধাপে ধাপে করবে। সংক্ষেপে:

1. এই `delaywise` ফোল্ডারটা হোস্টিংয়ে Docker দিয়ে deploy করুন। ফোল্ডারে `Dockerfile` আছে।
2. ডেটাবেসের জন্য একটা **persistent disk/volume** যোগ করুন (যেমন `/data`), আর `DATABASE_URL=file:/data/delaywise.sqlite` দিন। নাহলে প্রতিবার deploy করলে ডেটা মুছে যাবে, আর কাস্টমাররা একই ইমেইল আবার পাবে। অ্যাপ সবসময় **একটা মাত্র কপিতে** চালাবেন। বিস্তারিত: `docs/DEPLOY.md`।
3. হোস্টিংয়ের Environment Variables-এ `.env.example`-এর সবগুলো ভেরিয়েবল দিন:
   - `SHOPIFY_API_KEY` = Client ID
   - `SHOPIFY_API_SECRET` = Client secret
   - `SHOPIFY_APP_URL` = হোস্টিংয়ের ঠিকানা, যেমন `https://delaywise.onrender.com`
   - `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `SHIP24_API_KEY`
   - `JOB_SECRET` = অন্তত ২৪ অক্ষরের র‍্যান্ডম লেখা
   - `APP_ENCRYPTION_KEY` = `openssl rand -hex 32` চালিয়ে পাওয়া লেখা। একবার দেওয়ার পর **আর বদলাবেন না**।
   - `COMPANY_NAME`, `COMPANY_ADDRESS`, `SUPPORT_EMAIL` = প্রাইভেসি পলিসি পেজে দেখাবে। Shopify-র রিভিউতে এগুলো লাগে।
   - `DATABASE_URL` = উপরের ধাপ ২ দেখুন
4. কম্পিউটারে [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) ইনস্টল করে `delaywise` ফোল্ডারে চালান:
   ```
   shopify app config link     # Partner Dashboard-এর অ্যাপের সাথে যুক্ত করে
   shopify app deploy          # সেটিংস, ওয়েবহুক আর স্কোপ Shopify-তে পাঠায়
   ```
   `shopify.app.toml`-এর `application_url` আর `redirect_urls`-এ `https://example.com` বদলে হোস্টিংয়ের ঠিকানা দিন।

## ধাপ ৪: প্রতি ঘণ্টায় স্ক্যান চালু করা

অ্যাপ নিজে থেকে ঘুম থেকে ওঠে না, প্রতি ঘণ্টায় একবার ডাকতে হয়। ফ্রি সমাধান হলো [cron-job.org](https://cron-job.org)-এ একটা job বানানো:

- URL: `https://আপনার-অ্যাপ/jobs/scan`
- Method: `POST`
- Header: `Authorization: Bearer <আপনার JOB_SECRET>`
- Schedule: প্রতি ১৫ মিনিট থেকে ১ ঘণ্টায় একবার। একসাথে দুবার চললেও সমস্যা নেই, একই দোকান দুবার স্ক্যান হয় না।

## ধাপ ৫: দাম সেট করা (Shopify App Pricing)

Partner Dashboard → অ্যাপ → **Distribution / Pricing → Shopify App Pricing (managed pricing)**-এ চারটা প্ল্যান বানান। **নাম হুবহু এই রকম হতে হবে**, কারণ অ্যাপ নাম দেখে প্ল্যান চেনে:

| প্ল্যানের নাম | দাম | ফ্রি ট্রায়াল |
|---|---|---|
| Free | $০ | — |
| Starter | $১৯/মাস | ৭ দিন |
| Growth | $৩৯/মাস | ৭ দিন |
| Pro | $৭৯/মাস | ৭ দিন |

বার্ষিক প্ল্যান চাইলে প্রতিটায় ২ মাস ফ্রি দিতে পারেন (যেমন Starter $১৯০/বছর)।

## ধাপ ৬: টেস্ট দোকানে নিজে পরীক্ষা

1. Partner Dashboard → অ্যাপ → **Test your app** → development store বেছে ইনস্টল করুন।
2. টেস্ট দোকানে কয়েকটা অর্ডার বানিয়ে fulfill করুন। ট্র্যাকিং নম্বর দিন (কুরিয়ার UPS বা DHL)।
3. অ্যাপে **Scan shipments now** চাপুন। টেস্টের জন্য Settings-এ "Usual delivery time" ১ দিন করে দিলে দেরি দ্রুত দেখা যাবে।
4. **Messages** পেজে খসড়া দেখুন, এডিট করে **Send** চাপুন।
5. **Settings → Preview** দিয়ে বিভিন্ন ভাষায় ইমেইলের নমুনা দেখুন।
6. অ্যাপ আনইনস্টল করে আবার ইনস্টল করে দেখুন, কোনো error আসে কিনা।

## ধাপ ৭: App Store-এ জমা দেওয়া

1. `docs/APP_STORE_LISTING.md` থেকে নাম, বিবরণ আর ফিচারের লেখা কপি করুন।
2. স্ক্রিনশট নিন: ড্যাশবোর্ড, Messages, Carrier scorecard, Settings preview। ১৬০০×৯০০ পিক্সেল।
3. প্রাইভেসি পলিসির লিংক: `https://আপনার-অ্যাপ/privacy`। কোম্পানির নাম, ঠিকানা আর সাপোর্ট ইমেইল আসে environment variable থেকে (ধাপ ৩)। খুলে দেখে নিন সব ঠিকমতো দেখাচ্ছে কিনা।
4. রিভিউয়ারের জন্য টেস্ট নির্দেশনা (listing ফাইলে লেখা আছে) দিন।
5. `docs/REVIEW_CHECKLIST_BN.md`-এর প্রতিটা ঘর মিলিয়ে নিয়ে **Submit for review** চাপুন।

রিজেক্ট হলে ভয় পাবেন না। Shopify কারণ লিখে পাঠায়। ইমেইলটা Claude-কে দেখালে ঠিক করে আবার জমা দেওয়া যাবে।

## লঞ্চের পর প্রতি সপ্তাহে

- দোকানদারদের প্রশ্নের উত্তর দিন, সাধারণত ২৪ ঘণ্টার মধ্যে।
- নতুন রিভিউ চান। ৫০টা পেইড ইনস্টল আর ৫টা রিভিউ হলে "Built for Shopify" ব্যাজের জন্য আবেদন করা যায়।
- খরচ দেখুন: Anthropic, Ship24, Resend আর হোস্টিংয়ের বিল।
