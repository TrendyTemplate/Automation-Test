# AI সেলস অ্যাসিস্ট্যান্ট — Messenger, Instagram, WhatsApp

আপনার Facebook Page, Instagram ও WhatsApp Business-এ কাস্টমার মেসেজ দিলে AI নিজে উত্তর দেয়, প্রোডাক্ট সাজেস্ট করে, অর্ডার নেয় — আর দাম সবসময় আপনার ক্যাটালগ থেকেই।

## এটা কী কী করে
- **“দাম কত?” / “L সাইজ আছে?”** — ক্যাটালগ (দাম, স্টক, সাইজ/কালার) ও Knowledge base (ডেলিভারি চার্জ, পেমেন্ট, রিটার্ন পলিসি) দেখে উত্তর দেয়। বাংলা, Banglish, English — কাস্টমার যে ভাষায় লেখে সেই ভাষায়।
- **অর্ডার নেয়**: প্রোডাক্ট + পরিমাণ + নাম + ফোন + ঠিকানা সংগ্রহ করে, তারপর অর্ডার সামারি দেখিয়ে কনফার্ম চায়। **টোটাল সার্ভার নিজে ক্যাটালগের দাম থেকে হিসাব করে** — AI কখনো দাম বানাতে পারে না। কনফার্ম হলে Orders-এ জমা হয়, স্টক কমে, Telegram/Slack অ্যালার্ট যায়।
- **নিরাপত্তা**: ক্যাটালগে নেই এমন দাম/ডিসকাউন্ট, অচেনা লিংক, “never say” শব্দ, কম confidence, রিফান্ড/অভিযোগ, prompt-injection (“ignore previous instructions…”) — যেকোনোটা হলে মেসেজ পাঠানো হয় না, ড্রাফট হিসেবে আপনার অনুমোদনের জন্য থাকে।
- **মানুষের হাতে হস্তান্তর**: রাগান্বিত কাস্টমার, রিফান্ড, দরদাম — “Needs human” হিসেবে চিহ্নিত হয়। আপনি নিজে উত্তর দিলে (ড্যাশবোর্ড বা Meta-র নিজস্ব ইনবক্স থেকে) AI ১২ ঘণ্টা চুপ থাকে।
- **Meta-র ২৪ ঘণ্টার নিয়ম** মানে: কাস্টমারের শেষ মেসেজের ২৪ ঘণ্টা পর আর কোনো মেসেজ পাঠানো হয় না।
- **ফলো-আপ**: আগ্রহী কাস্টমার চুপ হয়ে গেলে (চ্যানেলে ঘণ্টা সেট করলে) ২৪ ঘণ্টার মধ্যে একবার ভদ্র রিমাইন্ডার।
- **মোড**: Off · Draft (আপনি অনুমোদন দেবেন — শুরুতে এটাই রাখুন) · Auto-pilot।
- **Test chat**: কাস্টমার সেজে চ্যাট করে দেখুন AI কী বলবে — কিছুই পাঠানো হয় না।

## সেটআপ (একবার)
1. **Products** ট্যাবে প্রোডাক্ট যোগ করুন (বা CSV ইমপোর্ট: `name,price,stock,sku,variants,description`)।
2. **AI training → Knowledge base**-এ ডেলিভারি চার্জ (ঢাকার ভিতরে/বাইরে), পেমেন্ট মেথড (COD, bKash), রিটার্ন পলিসি লিখুন।
3. [developers.facebook.com](https://developers.facebook.com) এ একটি **Business** অ্যাপ বানান। App settings → Basic থেকে **App secret** কপি করুন।
4. **Channels → Connect channel**:
   - **Messenger**: অ্যাপে Messenger যোগ করুন → Page কানেক্ট → Page access token (`pages_messaging`, `pages_manage_metadata`)। Page ID দিন।
   - **Instagram**: Professional অ্যাকাউন্ট, Facebook Page-এর সাথে লিংক করা। Account ID = Instagram অ্যাকাউন্ট ID, Send ID = লিংক করা Page ID। Instagram → Settings → Messages → *Allow access to messages* চালু করুন।
   - **WhatsApp**: অ্যাপে WhatsApp যোগ করুন → Business settings-এ System user বানিয়ে স্থায়ী টোকেন (`whatsapp_business_messaging`)। **Phone number ID** দিন (ফোন নম্বর নয়)।
5. সেভ করার পর চ্যানেল কার্ডে দেখানো **Callback URL** (`https://আপনার-ডোমেইন/api/social/webhook`) ও **Verify token** Meta অ্যাপের Webhooks-এ বসান এবং `messages` (Messenger-এ `message_echoes`-ও) সাবস্ক্রাইব করুন।
6. Test chat-এ কয়েকটা প্রশ্ন করে দেখুন, তারপর Draft মোডে কয়েকদিন চালিয়ে Auto-pilot চালু করুন।

> লাইভে যাওয়ার আগে Meta App Review লাগবে (`pages_messaging`, `instagram_manage_messages`, `whatsapp_business_messaging`)। Review-এর আগে শুধু অ্যাপের admin/tester-রা মেসেজ পাঠাতে পারবে।

## টেকনিক্যাল
- Webhook: `GET/POST /api/social/webhook` — প্রতিটি POST-এর `X-Hub-Signature-256` অ্যাপ সিক্রেট দিয়ে যাচাই হয়; ভুল সিগনেচার = 403। একই মেসেজ Meta আবার পাঠালে ডুপ্লিকেট হয় না।
- টোকেন, অ্যাপ সিক্রেট ও সব চ্যাট মেসেজ workspace-ভিত্তিক AES-256-GCM এনক্রিপশনে সংরক্ষিত।
- পরপর কয়েকটা ছোট মেসেজ এলে (৪ সেকেন্ড, `SALES_DEBOUNCE_MS`) একসাথে পড়ে একটাই উত্তর দেয়।
- Graph API ভার্সন: `META_GRAPH_VERSION` (ডিফল্ট `v21.0`)।
- API: `/api/sales/{overview,channels,products,conversations,orders,simulate}` — API key দিয়ে `/api/v1/sales/...`-ও কাজ করে।
