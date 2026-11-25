// বাংলা interface: screen text is translated where it appears (menu, headings, buttons, labels, placeholders).
// Customer messages and shop data are never touched — only exact matches of the app's own wording.
const BN = {
  // menu & sections
  Home: 'হোম', Chats: 'চ্যাট', Orders: 'অর্ডার', Customers: 'কাস্টমার', Analytics: 'রিপোর্ট', Products: 'প্রোডাক্ট', Learning: 'শেখা', 'Test chat': 'টেস্ট চ্যাট',
  Channels: 'চ্যানেল', Broadcasts: 'ব্রডকাস্ট', Couriers: 'কুরিয়ার', Assistant: 'অ্যাসিস্ট্যান্ট', Alerts: 'অ্যালার্ট', Settings: 'সেটিংস', Help: 'সাহায্য', More: 'আরও',
  'Shop & safety': 'শপ ও নিরাপত্তা', 'Knowledge base': 'নলেজ বেস', 'Delivery charges': 'ডেলিভারি চার্জ', Payments: 'পেমেন্ট', 'Business hours': 'ব্যবসার সময়',
  Profile: 'প্রোফাইল', Team: 'টিম', 'Plan & billing': 'প্ল্যান ও বিল', 'Security & privacy': 'নিরাপত্তা ও প্রাইভেসি', 'Refer & earn': 'রেফার করে আয়',
  'Alerts & API': 'অ্যালার্ট ও API', 'Help & support': 'সাহায্য ও সাপোর্ট', 'What the AI learned': 'AI যা শিখেছে', 'Connect your Facebook Page': 'আপনার ফেসবুক পেজ কানেক্ট করুন',
  // common actions
  Save: 'সেভ করুন', 'Save changes': 'পরিবর্তন সেভ করুন', Cancel: 'বাতিল', Delete: 'মুছুন', Edit: 'এডিট', Close: 'বন্ধ', Send: 'পাঠান', Connect: 'কানেক্ট', Disconnect: 'ডিসকানেক্ট',
  Copy: 'কপি', Search: 'খুঁজুন', Confirm: 'নিশ্চিত করুন', Yes: 'হ্যাঁ', No: 'না', Approve: 'অনুমোদন', 'Approve & send': 'অনুমোদন করে পাঠান', Reject: 'বাতিল করুন',
  'New order': 'নতুন অর্ডার', 'Add product': 'প্রোডাক্ট যোগ করুন', 'Add zone': 'জোন যোগ করুন', 'Add keyword': 'কিওয়ার্ড যোগ করুন', 'Add entry': 'এন্ট্রি যোগ করুন',
  'Import CSV': 'CSV ইমপোর্ট', 'Connect manually': 'ম্যানুয়ালি কানেক্ট', 'Chat menu': 'চ্যাট মেনু', 'Comment rules': 'কমেন্ট রুলস', 'Invite teammate': 'টিমমেট আমন্ত্রণ',
  'Send invitation': 'আমন্ত্রণ পাঠান', 'Send test alert': 'টেস্ট অ্যালার্ট পাঠান', 'Re-learn now': 'এখনই আবার শিখুন', 'Turn on on this device': 'এই ডিভাইসে চালু করুন',
  'Send a test': 'টেস্ট পাঠান', 'Who gets it?': 'কারা পাবে?', 'Save rules': 'রুলস সেভ করুন', Invoice: 'ইনভয়েস', 'Update keys': 'কী আপডেট করুন', Verify: 'যাচাই করুন',
  'Not received': 'পাইনি', 'Refresh status': 'স্ট্যাটাস রিফ্রেশ', 'Take over': 'নিজে উত্তর দিন', 'Hand back to AI': 'AI-কে ফেরত দিন', 'Log out': 'লগ আউট', 'Sign out': 'লগ আউট',
  // statuses
  All: 'সব', New: 'নতুন', Confirmed: 'কনফার্মড', Packed: 'প্যাকড', Shipped: 'পাঠানো হয়েছে', Delivered: 'ডেলিভারড', Returned: 'ফেরত', Cancelled: 'বাতিল',
  'COD / unpaid': 'ক্যাশ অন ডেলিভারি', 'Advance paid': 'অগ্রিম পরিশোধ', Paid: 'পরিশোধিত', Refunded: 'রিফান্ড', Connected: 'কানেক্টেড', 'Not connected': 'কানেক্ট করা নেই',
  Enabled: 'চালু', Off: 'বন্ধ', 'Auto-pilot': 'অটো-পাইলট', 'I approve each reply': 'প্রতিটি উত্তর আমি অনুমোদন করব', Ignore: 'উপেক্ষা', 'I approve': 'আমি অনুমোদন করব',
  'Answer automatically': 'অটো উত্তর', 'Open now': 'এখন খোলা', 'Closed now': 'এখন বন্ধ', 'Always open': 'সবসময় খোলা', Sending: 'পাঠানো হচ্ছে', Mine: 'আমার', Unassigned: 'কারো নয়',
  Comments: 'কমেন্ট', 'Needs you': 'আপনাকে দরকার', Recent: 'সাম্প্রতিক', Buyers: 'ক্রেতা', 'Repeat buyers': 'নিয়মিত ক্রেতা', 'Hot leads': 'আগ্রহী কাস্টমার', 'Often return': 'প্রায়ই ফেরত দেয়',
  'Top spenders': 'সবচেয়ে বেশি কেনে', 'Most orders': 'সবচেয়ে বেশি অর্ডার', Everyone: 'সবাই', "Haven't bought yet": 'এখনো কেনেনি',
  // headings, labels, stats
  Messages: 'মেসেজ', 'Messages per day': 'দিনে মেসেজ', 'Orders per day': 'দিনে অর্ডার', 'Replies sent': 'পাঠানো উত্তর', 'Top products': 'সেরা প্রোডাক্ট', 'By page': 'পেজ অনুযায়ী', 'By ad': 'অ্যাড অনুযায়ী',
  'First reply (median)': 'প্রথম উত্তর (গড়)', 'Answered by AI alone': 'শুধু AI উত্তর দিয়েছে', 'Chats → orders': 'চ্যাট → অর্ডার', 'Delivered (vs returned)': 'ডেলিভারড (ফেরতের তুলনায়)',
  'Customer messages': 'কাস্টমারের মেসেজ', 'Order value': 'অর্ডারের মূল্য', 'Handed to a person': 'মানুষের কাছে পাঠানো', 'Orders shown': 'দেখানো অর্ডার', 'Still to collect (COD)': 'আদায় বাকি (COD)',
  Customer: 'কাস্টমার', Items: 'আইটেম', Total: 'মোট', Payment: 'পেমেন্ট', Delivery: 'ডেলিভারি', Status: 'স্ট্যাটাস', Name: 'নাম', Phone: 'ফোন', Address: 'ঠিকানা', Note: 'নোট', Discount: 'ছাড়',
  'Amount paid': 'পরিশোধিত টাকা', 'Delivery zone': 'ডেলিভারি জোন', Price: 'দাম', Stock: 'স্টক', Labels: 'লেবেল', Notes: 'নোট', 'Assigned to': 'দায়িত্বে', Channel: 'চ্যানেল', Spent: 'খরচ করেছে',
  'Last seen': 'শেষ দেখা', From: 'থেকে', To: 'কাকে', Message: 'মেসেজ', Sent: 'পাঠানো', When: 'কখন', Page: 'পেজ', Ad: 'অ্যাড', Value: 'মূল্য', Chat: 'চ্যাট',
  'Recent activity': 'সাম্প্রতিক কার্যক্রম', 'Plan usage': 'প্ল্যান ব্যবহার', 'Quick answers': 'দ্রুত উত্তর', 'Pick a conversation': 'একটি চ্যাট বেছে নিন', 'No conversations yet': 'এখনো কোনো চ্যাট নেই',
  'Hide automatically': 'অটো লুকান', 'Keyword replies': 'কিওয়ার্ড উত্তর', 'Which posts': 'কোন পোস্ট', 'Away message': 'অফলাইন মেসেজ', 'Time zone': 'টাইম জোন', 'Use business hours': 'ব্যবসার সময় ব্যবহার করুন',
  Saturday: 'শনিবার', Sunday: 'রবিবার', Monday: 'সোমবার', Tuesday: 'মঙ্গলবার', Wednesday: 'বুধবার', Thursday: 'বৃহস্পতিবার', Friday: 'শুক্রবার',
  'Account type': 'অ্যাকাউন্টের ধরন', 'Advance payment': 'অগ্রিম পেমেন্ট', 'Phone & desktop notifications': 'ফোন ও কম্পিউটারে নোটিফিকেশন', 'Your profile': 'আপনার প্রোফাইল',
  'Full name': 'পুরো নাম', Theme: 'থিম', Language: 'ভাষা', 'Save profile': 'প্রোফাইল সেভ করুন', 'Sign-in email': 'লগইন ইমেইল', '7 days': '৭ দিন', '30 days': '৩০ দিন', '90 days': '৯০ দিন',
  'Order korbo': 'অর্ডার করব', Saved: 'সেভ হয়েছে', Copied: 'কপি হয়েছে', 'Order saved': 'অর্ডার সেভ হয়েছে', 'Search customers, pages…': 'কাস্টমার, পেজ খুঁজুন…',
  'No data yet': 'এখনো তথ্য নেই', 'See plans': 'প্ল্যান দেখুন', 'Free trial:': 'ফ্রি ট্রায়াল:', 'No orders yet': 'এখনো কোনো অর্ডার নেই', 'No customers yet': 'এখনো কোনো কাস্টমার নেই',
  'How fast you answer, how much the AI handles, and which pages, ads and products bring in sales.': 'কত দ্রুত উত্তর দিচ্ছেন, AI কতটা সামলাচ্ছে, আর কোন পেজ, অ্যাড ও প্রোডাক্ট থেকে বিক্রি আসছে।',
  'Orders from chat and the ones you add by hand. Totals and delivery charges are always calculated by ChatPilot — never by the AI.': 'চ্যাট থেকে আসা ও হাতে যোগ করা অর্ডার। মোট দাম ও ডেলিভারি চার্জ সবসময় ChatPilot হিসাব করে — AI কখনো না।',
  'AI on its own': 'AI নিজে', 'AI draft approved': 'AI ড্রাফট অনুমোদিত', 'Typed by your team': 'আপনার টিম লিখেছে', 'AI On Its Own': 'AI নিজে', 'AI Draft Approved': 'AI ড্রাফট অনুমোদিত', 'Typed By Your Team': 'আপনার টিম লিখেছে',
  'Name, phone, address or label': 'নাম, ফোন, ঠিকানা বা লেবেল', 'Order #, name, phone or tracking code': 'অর্ডার #, নাম, ফোন বা ট্র্যাকিং কোড',
};

let lang = 'en';
try { lang = localStorage.getItem('mp:lang') || (navigator.language?.startsWith('bn') ? 'bn' : 'en'); } catch { /* private mode */ }
export const getLang = () => lang;
export function setLang(l) { lang = l === 'bn' ? 'bn' : 'en'; try { localStorage.setItem('mp:lang', lang); } catch { /* ignore */ } location.reload(); }
export const t = (s) => (lang === 'bn' && BN[s]) || s;

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
function translate(root) {
  if (lang !== 'bn' || !root) return;
  if (root.nodeType === 3) { const k = root.nodeValue.trim(); if (BN[k]) root.nodeValue = root.nodeValue.replace(k, BN[k]); return; }
  if (root.nodeType !== 1 || SKIP.has(root.tagName) || root.closest?.('.bubble, .last, [data-no-i18n]')) return; // never customer messages
  for (const a of ['placeholder', 'title', 'aria-label']) { const v = root.getAttribute?.(a); if (v && BN[v.trim()]) root.setAttribute(a, BN[v.trim()]); }
  if (root.tagName === 'OPTION' || root.tagName === 'BUTTON' || root.childNodes.length) for (const n of root.childNodes) translate(n);
}

/** Translate the page now and everything added later (pages, dialogs, toasts). */
export function startI18n() {
  document.documentElement.lang = lang;
  if (lang !== 'bn') return;
  translate(document.body);
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) translate(n); }).observe(document.body, { childList: true, subtree: true });
}
