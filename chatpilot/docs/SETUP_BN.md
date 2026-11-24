# ChatPilot AI — সেটআপ গাইড (Messenger, Instagram, WhatsApp)

আপনার Facebook Page, Instagram ও WhatsApp Business-এ কাস্টমার মেসেজ দিলে AI নিজে উত্তর দেয়, প্রোডাক্ট সাজেস্ট করে, অর্ডার নেয় — আর দাম সবসময় আপনার ক্যাটালগ থেকেই।

## এটা কী কী করে
- **“দাম কত?” / “L সাইজ আছে?”** — ক্যাটালগ (দাম, স্টক, সাইজ/কালার) ও Knowledge base (ডেলিভারি চার্জ, পেমেন্ট, রিটার্ন পলিসি) দেখে উত্তর দেয়। বাংলা, Banglish, English — কাস্টমার যে ভাষায় লেখে সেই ভাষায়।
- **অর্ডার নেয়**: প্রোডাক্ট + পরিমাণ + নাম + ফোন + ঠিকানা সংগ্রহ করে, তারপর অর্ডার সামারি দেখিয়ে কনফার্ম চায়। **টোটাল সার্ভার নিজে ক্যাটালগের দাম থেকে হিসাব করে** — AI কখনো দাম বানাতে পারে না। কনফার্ম হলে Orders-এ জমা হয়, স্টক কমে, Telegram/Slack অ্যালার্ট যায় (Alerts & API-তে সেট করুন)।
- **নিরাপত্তা**: ক্যাটালগে নেই এমন দাম/ডিসকাউন্ট, অচেনা লিংক, “never say” শব্দ, কম confidence, রিফান্ড/অভিযোগ, prompt-injection (“ignore previous instructions…”) — যেকোনোটা হলে মেসেজ পাঠানো হয় না, ড্রাফট হিসেবে আপনার অনুমোদনের জন্য থাকে।
- **মানুষের হাতে হস্তান্তর**: রাগান্বিত কাস্টমার, রিফান্ড, দরদাম — “Needs human” হিসেবে চিহ্নিত হয়। আপনি নিজে উত্তর দিলে (ড্যাশবোর্ড বা Meta-র নিজস্ব ইনবক্স থেকে) AI ১২ ঘণ্টা চুপ থাকে।
- **Meta-র ২৪ ঘণ্টার নিয়ম** মানে: কাস্টমারের শেষ মেসেজের ২৪ ঘণ্টা পর আর কোনো মেসেজ পাঠানো হয় না।
- **ফলো-আপ**: আগ্রহী কাস্টমার চুপ হয়ে গেলে (চ্যানেলে ঘণ্টা সেট করলে) ২৪ ঘণ্টার মধ্যে একবার ভদ্র রিমাইন্ডার।
- **মোড**: Off · Draft (আপনি অনুমোদন দেবেন — শুরুতে এটাই রাখুন) · Auto-pilot।
- **Test chat**: কাস্টমার সেজে চ্যাট করে দেখুন AI কী বলবে — কিছুই পাঠানো হয় না।

## সেটআপ (একবার)
1. **Products** ট্যাবে প্রোডাক্ট যোগ করুন (বা CSV ইমপোর্ট: `name,price,stock,sku,variants,description`)।
2. **Assistant → Knowledge base**-এ ডেলিভারি চার্জ (ঢাকার ভিতরে/বাইরে), পেমেন্ট মেথড (COD, bKash), রিটার্ন পলিসি লিখুন।
3. **Channels → Facebook Page / Instagram / WhatsApp → Connect** চাপুন। Facebook-এর ডায়ালগে নিজের Page (আর লিংক করা Instagram) বা WhatsApp নম্বর বেছে নিন → ChatPilot-এ ফিরে এসে কোনগুলো কানেক্ট করবেন টিক দিন → **Connect selected**। Webhook নিজে থেকেই চালু হয়ে যায়।
   - Instagram: অ্যাকাউন্টটা Professional হতে হবে ও Facebook Page-এর সাথে লিংক করা থাকতে হবে; Instagram → Settings → Messages → *Allow access to messages* চালু করুন।
   - "Manual only" দেখালে প্ল্যাটফর্ম অ্যাডমিন এখনো Meta অ্যাপ সেট করেননি ([META_APP_REVIEW_BN.md](META_APP_REVIEW_BN.md))। তখন **Connect manually** দিয়ে নিজের developer app-এর token বসানো যায় (পুরনো পদ্ধতি, নিচে)।
4. (শুধু manual) developers.facebook.com-এ নিজের Business অ্যাপ বানিয়ে Page token / System-user token, App secret আর Page ID / Phone number ID দিন; চ্যানেল কার্ডের *Webhook details* থেকে Callback URL ও Verify token Meta-তে বসান।
5. শুরুতে **I approve each reply** মোডে রাখুন।
6. Test chat-এ কয়েকটা প্রশ্ন করে দেখুন, তারপর Draft মোডে কয়েকদিন চালিয়ে Auto-pilot চালু করুন।

> লাইভে যাওয়ার আগে Meta App Review লাগবে (`pages_messaging`, `instagram_manage_messages`, `whatsapp_business_messaging`)। Review-এর আগে শুধু অ্যাপের admin/tester-রা মেসেজ পাঠাতে পারবে।

## টেকনিক্যাল
- Webhook: `GET/POST /api/social/webhook` — প্রতিটি POST-এর `X-Hub-Signature-256` অ্যাপ সিক্রেট দিয়ে যাচাই হয়; ভুল সিগনেচার = 403। একই মেসেজ Meta আবার পাঠালে ডুপ্লিকেট হয় না।
- টোকেন, অ্যাপ সিক্রেট ও সব চ্যাট মেসেজ workspace-ভিত্তিক AES-256-GCM এনক্রিপশনে সংরক্ষিত।
- পরপর কয়েকটা ছোট মেসেজ এলে (৪ সেকেন্ড, `SALES_DEBOUNCE_MS`) একসাথে পড়ে একটাই উত্তর দেয়।
- Graph API ভার্সন: `META_GRAPH_VERSION` (ডিফল্ট `v21.0`)।
- API: `/api/sales/{overview,channels,products,conversations,orders,simulate}` — API key (`cp_live_…`) দিয়ে `/api/v1/sales/...`-ও কাজ করে।
