# Customer interview script (20 minutes)

> **বাংলা নির্দেশনা: ইন্টারভিউয়ের ৫টা নিয়ম**
> 1. **ভবিষ্যৎ নয়, অতীত জিজ্ঞেস করুন।** "আপনি কি কিনবেন?" জিজ্ঞেস করবেন না, কারণ সবাই ভদ্রতা করে "হ্যাঁ" বলে। জিজ্ঞেস করুন: "গত মাসে কী হয়েছিল?"
> 2. **নিজের আইডিয়া প্রথম ১৫ মিনিট বলবেন না।** আপনি বেশি বললে তথ্য পাবেন না।
> 3. **সংখ্যা চান।** কত ঘণ্টা, কত ক্লায়েন্ট, এখন কত টাকা খরচ হয়।
> 4. **ওদের নিজের ভাষা হুবহু লিখে রাখুন।** এগুলো পরে ল্যান্ডিং পেজের শিরোনামে কাজে লাগবে।
> 5. **শেষে একটা "কমিটমেন্ট" চান:** পাইলট, অন্য কারও পরিচয়, বা পরের কল। শুধু প্রশংসা মানে আগ্রহ নেই।
>
> কলের পরপরই `interview_scorecard.csv`-তে একটা লাইন পূরণ করুন।

---

## Opening (1 min)

> "Thanks for making the time. I'm researching how small practices handle
> month-end document collection. I'm not going to pitch anything, I just
> want to understand how you do it today. Is it OK if I take notes?"

## A. Context (3 min)

1. How many bookkeeping clients does the practice look after, and how many on Xero?
2. Monthly, quarterly, or a mix? Who on the team does the bookkeeping?
3. What do you use today for receipt and invoice capture? (Dext, Hubdoc, AutoEntry, email…)
   - What do you pay for it per month, roughly?

## B. The last month-end (8 min) ← most important part

4. Walk me through your **last** month-end. How did you find out which documents were missing?
5. How did you ask clients for them? Email, phone, WhatsApp, a portal?
6. How many rounds of chasing did it take for your slowest clients?
7. Roughly how many hours did the team spend on chasing and capture **last month**?
   - *(If vague: "Was it closer to 2 hours or 2 days?")*
8. What happened to clients who never sent the documents? (suspense account, guessed, delayed the close?)
9. What's the most annoying part of all this?

## C. What they've tried (4 min)

10. Have you tried to fix this? What did you try, and why did it stick or not stick?
11. What do you like and dislike about [their current tool]?
    - *(Listen for: price rises, per-client pricing, accuracy, bank fetch problems.)*
12. Have you looked at Xero's own features (Xero Files, JAX, payment reminders) for this?

## D. Value (2 min)

13. If this part of month-end took care of itself, what would your team do with that time?
14. Who in the practice decides on buying a tool like this? Is there a budget for it?

## E. Only now: the idea and a commitment ask (2 min)

> "Here's what I'm exploring: something that checks each client's bank feed
> every day, lists what's missing, chases the client by email or WhatsApp
> on your schedule, then reads what comes back and drafts it into Xero for
> your approval. Flat price per practice."

15. What's your honest first reaction? What would worry you?
16. Planned pricing is around £39 / £119 / £239 a month by practice size.
    Which would fit you, and does that feel cheap, fair, or expensive?
17. **Commitment ask (pick one):**
    - "I'm running a few £99 pilots for one month-end with up to 10 clients. Would you want one of those?"
    - "Is there another practice owner you think I should talk to?"
    - "Can I come back to you in 3 weeks with something to try?"

## Close

> "This was really helpful. I'll send you the summary of what other
> practices said. Thank you."

---

## Scoring guide (fill in `interview_scorecard.csv` right after the call)

| Field | How to score |
|---|---|
| `pain_rank` | Is document chasing among their **top 3** month-end pains? `1` = yes, said unprompted; `0.5` = yes, only when asked; `0` = no |
| `hours_per_month` | The number from Q7 (team total) |
| `current_spend_gbp` | Monthly spend on capture tools from Q3 |
| `tried_to_fix` | `1` if they actively tried a fix (strong signal), else `0` |
| `price_reaction` | `cheap` / `fair` / `expensive` / `no` |
| `commitment` | `pilot_paid`, `pilot_yes`, `intro`, `followup`, `none` |
| `quote` | Their best exact sentence about the pain |
