# Trust Management System — v2 Architecture

**Project:** `new-trust-project`
**Stack:** Next.js 16 (App Router) · Firestore · Firebase Auth · Ant Design + AG Grid · @react-pdf/renderer
**Reference:** old system at `D:\Development\trust-app`
**Rule:** No Firebase Cloud Functions. All server logic lives in Next.js route handlers using `firebase-admin`.

---

## 1. Why the old system costs so much (diagnosis)

The old system materialises **one `payment_pending` document for every (member × closing) pair.**

```
users/{uid}/programs/{pid}/payment_pending/{closingMemberId}_{payerId}
```

With your target scale that is:

| | count |
|---|---|
| members | 5,000 |
| closings | 500 |
| **payment_pending docs** | **up to 2,500,000** |

Three Cloud Functions (`onMemberMarriageUpdate`, `onNewMemberAcceptedSync`, `revertClosingMember`) exist **only** to keep those 2.5M rows in sync. Every one of them is a mass batch write, and `revertClosingMember` mass-*deletes* real payment history.

Then every report re-reads them:

| screen (old code) | documents read per load |
|---|---|
| `/api/payments/fetch` (dashboard) | **entire** `payment_pending` + **entire** `transactions` ≈ **2.5M+** |
| `/api/all-payment-status` (one agent, 200 members) | 200 members + ~100,000 payment docs |
| `/api/closing-payment-status` | all payments for agent + N closing member docs |
| `/api/closing-members` | all closings + all payments for agent |

At Firestore's $0.06 per 100,000 reads, a **single** dashboard load costs ≈ **$1.50**. Fifty loads a day ≈ **$2,250/month**. That is your bill.

**Other structural problems carried over from v1:**

1. `revert` **deletes** payment rows → history is destroyed, and nothing is auditable.
2. Two different Cloud Functions both write `payment_pending`, with different eligibility rules → silent data drift between them.
3. `pending → paid` is a `batch.update`, not a transaction — a half-failed batch leaves money recorded with no obligation marked paid (your "pending paid issue").
4. Eligibility is recomputed from `DD-MM-YYYY` **strings** parsed by hand in three different places, with three slightly different rules.
5. Group membership lives in an **array inside one group document** (`members: [...]`) → 1MB cap, lost updates on concurrent writes, `memberCount` drifts.
6. Trust identity is hardcoded: `logo.js` is a **272 KB base64 string in source**, fonts are **1.1 MB of base64 JS**. Cannot be cloned for another trust without editing code, and it bloats every bundle.
7. No commission system at all.
8. PDFs are made three different ways (jsPDF, html2canvas, @react-pdf) — Hindi text breaks, big lists freeze the browser.

---

## 2. The core idea — stop storing obligations, store only *money*

> **Hinglish:** Purane system mein har member ka har closing ke liye ek row banti thi — isliye 25 lakh rows. Naye system mein **row sirf tab banti hai jab paisa actually aata hai.** Baaki sab **calculate** hota hai, do numbers se.

An obligation is not a fact that needs storing. It is **derivable**:

> Member `M` owes closing `C`
> **if** `M.joinDate <= C.closingDate`
> **and** `M` was active on `C.closingDate`
> **and** `M != C.member`
> **and** `M` had not already closed before `C`.

So we store three things instead of 2.5 million rows:

| collection | docs at target scale | what it is |
|---|---|---|
| `closings` | **500** | one per closing event, with an immutable `seq` |
| `members` | **5,000** | each carries its own paid-ledger (2 fields) |
| `payments` | **~100,000** | one per receipt (रसीद) — real money only |

**Total: ~105,500 documents instead of 2,505,000.** A 24× storage reduction and, far more importantly, a **500×–12,000× read reduction.**

### 2.1 The member paid-ledger — two fields

Every closing gets an **immutable integer `seq`** (1, 2, 3 … 500) assigned at creation from a counter. It never changes, even if closings are back-dated.

Each member document carries:

```js
{
  joinDateMs: 1704067200000,   // eligibility is by DATE, never by seq
  exitDateMs: null,            // set when member closes / leaves / is blocked

  paidUpTo:  312,              // watermark: EVERY obligation with seq <= 312 is settled
  paidSeqs:  [315, 318, 322],  // out-of-order payments above the watermark
  exemptSeqs:[287],            // own closing, or admin-waived

  // denormalised counters — make every dashboard O(1)
  dueCount: 6,  dueAmount: 1200,
  paidCount: 314, paidAmount: 62800,
  lastPaymentAt: 1767225600000
}
```

**Pending list for a member** = all closings whose `closingDate >= member.joinDate`, with `seq > paidUpTo`, minus `paidSeqs`, minus `exemptSeqs`.

That is a **pure in-memory computation over an array you already have**. Zero extra reads.

In the normal case (member is fully paid up) `paidSeqs` is **empty** and `paidUpTo = 500`. The member document stays a few hundred bytes. Worst case — a member who paid 500 closings in totally random order — `paidSeqs` is 500 integers ≈ 4.5 KB, versus Firestore's 1 MB limit. This design holds to ~100,000 closings.

**Compaction:** after every payment, any leading run of `paidSeqs` that is contiguous with `paidUpTo` (skipping exempt/ineligible seqs) is absorbed into the watermark and removed from the array. The array self-cleans.

### 2.2 The closings index — one document serves the whole app

The 500 closings are **identical for every user**, so they live in a single cached index document:

```
trusts/{trustId}/programs/{pid}/indexes/closings_v1
{
  version: 512,
  updatedAt: ...,
  items: [
    { seq:1, id:"abc", name:"रामलाल", regNo:"1023", fatherName:"...",
      village:"...", dateMs:1704067200000, amount:200, groupId:"g1" },
    ... 500 entries
  ]
}
```

500 entries × ~150 bytes ≈ **75 KB — one document read.** Cached in the browser and at the edge for hours; the `version` field lets a client check freshness with a single tiny read. (Auto-shards at 1,000 entries per doc if you ever exceed it.)

### 2.3 The member index — the list, the search AND every filter, for ~10 reads

Same trick for members, taken further. The shards are **trust-wide** (`trusts/{t}/indexes/members_v1_shard_N`), 500 entries each, and every entry carries every field the grid renders and every field you can filter on:

```
indexes/members_v1_shard_0 … shard_N          ← 500 members per shard
  items: [{ id, reg, name, father, phone, ph2, aadhaar, village, dist,
            gen, jati, ageBand, age, status, agentId, agent, pid, prog,
            joinMs, dobMs, pay, fee, feeDone, dueC, due, paidC, paid,
            lastPay, photo }]
```

Keys are two to seven characters on purpose: Firestore stores the field name inside *every element* of an array of maps, so spelling out `registrationNumber` costs 5,000 copies of that word. Short keys turn ~900 bytes per entry into ~350, which is the difference between 10 shards and 25. `fromMemberEntry()` expands them again before anything leaves the server, so no component knows this happened.

**This index is not an optimisation for search — it *is* the members list.** `listMembers`, `searchMembers` and `findMembersByPhone` all load it and then filter, sort, facet and paginate in memory (`domain/memberQuery.js`, pure and unit-tested). The consequences:

- Twelve filters cost exactly what zero filters cost: ~10 reads for 5,000 members, **0 while the 60-second in-process cache is warm**. Paging through the list costs nothing further.
- **Totals are honest.** "कुल बकाया" sums the whole filtered set, not the 50 rows on screen — because the whole set is already in hand.
- **Facets are free.** Every dropdown shows its options *with counts* (`मालपुरा (412)`), built from the same load, so a filter can never offer a value that matches nobody.
- Free-text search runs across nine fields at once, case-insensitively, with phone numbers normalised to digits — none of which Firestore can do at any price.

The alternative was a Firestore composite index per combination of filters — status × gender × age band × agent × village × date range is hundreds of indexes — and it would *still* not do a contains-match or a multi-field search. That comparison is why the members composite-index list in `firestore.indexes.json` went **down** from 12 to 7 while the app gained a dozen filters.

The old system's `search_keywords` prefix arrays (200+ tokens written into every member document on every save) are deleted entirely.

**Staying in sync.** `patchMemberInIndex` updates one member's entry on create, edit, status change and — importantly — on every payment and reversal, since dues are what the list is for. `removeMemberFromIndex` drops soft-deleted members. `npm run reindex` rebuilds from the collection and is safe to run at any time; it is the repair tool when a counter on screen looks out of step.

### 2.35 Counts and exports come from the same index

Every count in the app — active, closed, blocked, per agent, per village, per program, with the money in each bucket — is computed from the member index by `groupMembers()` / `countsFor()`, not from counters kept on documents.

That is the point. A counter has to be maintained on every create, move, block and delete, and the once it is missed nobody notices: the number simply stops matching the list. Here the dashboard's "1,240 सक्रिय" and the 1,240 rows you get after clicking it are the *same computation over the same array*, so they cannot disagree.

Exports work the same way and cover the **whole filtered set**, not the page on screen — the rows are already in memory, so "page 1 of 47" would be a limitation with no cause. CSV carries a UTF-8 BOM (without it Excel on Windows opens every Hindi name as mojibake) and neutralises leading `= + - @`, which is otherwise a formula waiting to run in whoever opens the file. PDF renders through `@react-pdf` with a committed Noto Sans Devanagari face: the built-in Helvetica has no Devanagari glyphs at all, so an unregistered font does not degrade the PDF, it empties it.

### 2.4 Read-cost comparison

| screen | old reads | new reads | factor |
|---|---:|---:|---:|
| Dashboard | ~2,500,000 | **2** (stats doc + closings index) | 1,250,000× |
| Agent report (200 members) | ~100,000 | **201** | 500× |
| Member list page (50 rows) | 5,000+ | **50** | 100× |
| One member's pending list | ~500 | **1** | 500× |
| Member search | full collection scan | **5** (cached) | — |
| Closing collection status | ~5,000 | **1** (counters on closing doc) | 5,000× |

Estimated monthly Firestore cost at your scale: **from ~$2,000+ to under $5.**

---

## 3. Firestore schema

Top-level `trusts` (not `users`) — this is what makes the system **clonable to another trust**. A new trust is one document insert plus a logo upload. **Zero code changes.**

```
trusts/{trustId}
  ├─ profile & branding (§7)
  ├─ members/{memberId}                         ← ONE collection, programId is a FIELD
  ├─ indexes/{members_v1_shard_N}               ← trust-wide member index (§2.3)
  ├─ programs/{programId}
  │    ├─ closings/{closingId}
  │    ├─ payments/{receiptId}
  │    ├─ closing_groups/{groupId}
  │    ├─ group_members/{groupId_memberId}      ← flat, no arrays
  │    ├─ commission_entries/{entryId}
  │    ├─ commission_payouts/{payoutId}
  │    ├─ indexes/{closings_v1}
  │    ├─ counters/{seq | stats}
  │    ├─ audit_logs/{logId}
  │    └─ pdf_jobs/{jobId}
  ├─ agents/{agentId}
  └─ users/{uid}                                ← role + permissions
```

### 3.0 One trust per deployment

This app serves **one** trust. `TRUST_ID` in the environment pins it: it becomes the Firestore document id under `trusts/`, it overrides whatever a session token claims, and `createTrust` refuses to make a second one. Giving the system to another trust means another deployment with its own Firebase project — not another row in this one.

The trust id stays in the path anyway. It costs one segment, it keeps the door open, and it is what makes a clone a copy rather than a rewrite. It is simply never a choice a user makes: there is no trust switcher, and settings edits *the* trust rather than adding one.

### 3.05 `masters/{type}` — the reference lists

States, districts, relations, genders, castes, payment methods, closing types and designations were a hardcoded source file, so a trust in another state needed a code change and a deploy to add a district. They are documents now — **one per list**, each holding its whole list, seeded from that same file on first read so nobody starts with an empty dropdown.

One document per list, not per entry: a district list is a few hundred short strings, which as documents would be a few hundred reads every time a form opened. As one document it is a single cached read, and it is edited the way people think about a list — as a whole, reordered and saved once.

Each entry's `value` is generated from its label once and then frozen, because that string is stored on every member who picked it; renaming the label is free, changing the value would orphan them. `useMasters()` serves every form, and falls back to the built-in file if the fetch fails — an empty dropdown reads as a broken app, not a slow one.

### 3.1 `members/{memberId}` — one collection per trust

Members are **not** a sub-collection of a program. `programId` is a field on the member.

The sub-collection version made "every member of this trust" impossible to ask for. Finding everyone on a phone number meant one query per program; so did any report crossing programs; and moving a member between programs meant a copy plus a delete rather than a field change. Firestore charges the same for `where('programId','==',x)` as it does for a narrower path, so the nesting bought nothing and cost reach.

What it costs instead: a member is now addressable trust-wide by id alone, so **every by-id operation asserts the member belongs to the caller's योजना** (`domain/scope.js`). Skipping that check would not throw — it would derive a member's dues against another program's closing list and then take a payment against the wrong number.


```js
{
  // identity
  registrationNumber: "1023",        // unique per program
  displayName, fatherName, guardian, guardianRelation,
  gender, jati, gotra, dob, dobMs,
  phone, phoneAlt, aadhaarNo,
  village, district, state, pinCode, currentAddress,
  photoURL, aadhaarURL,

  // membership
  status: "pending" | "accepted" | "closed" | "blocked" | "left",
  joinDate: "01-01-2024", joinDateMs: 1704067200000,   // ← ms is the source of truth
  exitDate: null, exitDateMs: null,
  groupId, groupName,
  agentId, agentName,
  payAmount: 200,                    // per-closing contribution
  joinFees: 1100, joinFeesPaid: true, joinFeesReceiptId,

  // closing (when this member's own event happens)
  closingId: null,                   // → closings/{id}
  closingDateMs: null,

  // ▼ the ledger — §2.1
  paidUpTo: 312,
  paidSeqs: [],
  exemptSeqs: [],
  partialPaid: {},                   // { "315": 100 } — rare partial payments
  dueCount, dueAmount, paidCount, paidAmount, lastPaymentAt,

  // family (subcollection if large)
  familyCount: 4,

  active_flag: true, delete_flag: false,
  createdAt, createdBy, updatedAt, updatedBy
}
```

**Indexes required:** `(status, agentId, joinDateMs)`, `(status, groupId)`, `(registrationNumber)`, `(phone)`, `(dueAmount desc)`.

### 3.2 `closings/{closingId}`

```js
{
  seq: 313,                          // IMMUTABLE. assigned from counters/seq
  memberId, registrationNumber, displayName, fatherName,
  village, jati, phone, photoURL,

  closingDate: "15-03-2026", closingDateMs: 1773532800000,
  closingType: "marriage" | "death" | "other",
  amountPerMember: 200,
  groupId, groupName,

  invitationCardURL, notes,
  pdfData: { /* editable overrides for the closing-form PDF */ },

  // eligibility snapshot, frozen at creation — this is what makes the
  // derived model auditable and immune to later member edits
  eligibleCount: 4287,
  eligibleAmount: 857400,

  // live counters (FieldValue.increment)
  paidCount: 3102, paidAmount: 620400,
  // pending = eligibleCount - paidCount - exemptCount

  status: "active" | "reverted",
  revertedAt, revertedBy, revertReason,
  createdAt, createdBy, updatedAt
}
```

### 3.3 `payments/{receiptId}` — the only place money is recorded

```js
{
  receiptNo: "RSD-2026-000123",      // sequential, from counters/seq
  memberId,
  memberSnapshot: { name, regNo, fatherName, village, phone, photoURL },

  collectedByAgentId, collectedByAgentName,
  paidAtMs, method: "cash"|"online"|"upi"|"cheque",
  reference, referenceVerified,

  items: [
    { closingId, seq: 313, name: "रामलाल", regNo: "1023",
      closingDateMs, amount: 200 }
  ],
  seqs: [313, 314, 315],             // for array-contains queries
  itemCount: 3,
  closingAmount: 600,
  joinFeeAmount: 0,
  totalAmount: 600,

  commissionEntryId,

  status: "completed" | "cancelled",
  cancelledAt, cancelledBy, cancelReason, reversalOf,

  createdAt, createdBy, delete_flag: false
}
```

**Payments are never deleted or edited.** A mistake is corrected by a **cancellation**, which writes a reversal and un-does the ledger atomically. Full audit trail, always reconcilable.

### 3.4 `counters/stats` — the whole dashboard in one read

```js
{
  members:   { total, pending, accepted, closed, blocked },
  closings:  { total, active, thisMonth, maxSeq },
  money:     { collectedTotal, dueTotal, joinFeesTotal, thisMonthCollected },
  agents:    { total, active },
  commission:{ earnedTotal, paidTotal, dueTotal },
  updatedAt
}
```

Maintained with `FieldValue.increment` inside the same transaction as every payment. Dashboard = **1 read**.

---

## 4. The transactions that fix your "pending → paid" bug

Everything money-related runs inside a **single Firestore transaction**. There is no state in which money is recorded but an obligation is left unmarked (or vice versa).

### 4.1 Post a payment — `POST /api/payments`

```
TRANSACTION:
  1. read  members/{memberId}
  2. read  indexes/closings_v1     (from cache, revalidated by version)
  3. SERVER-SIDE recompute which requested seqs are genuinely due
       → reject anything already paid, exempt, or not eligible
       → this makes double-submit and stale-UI impossible
  4. write payments/{receiptId}
  5. update members/{memberId}: merge seqs into paidUpTo/paidSeqs,
       compact the watermark, adjust dueCount/dueAmount/paidCount/paidAmount
  6. increment closings/{id}.paidCount & paidAmount   — for each seq
  7. increment counters/stats
  8. write commission_entries/{id}                    — §6
COMMIT  (all or nothing)
```

Write count for a 50-closing receipt: 1 + 1 + 50 + 1 + 1 = **54 writes**, well under Firestore's 500-per-transaction limit. Receipts over 400 items are split into linked receipts automatically.

**Idempotency:** the client sends an `Idempotency-Key`; a replayed request returns the original receipt instead of double-charging.

### 4.2 Create a closing — `POST /api/closings`

```
TRANSACTION:
  1. allocate seq from counters/seq  (atomic increment)
  2. count eligible members          (aggregation query — 1 read, not 5,000)
  3. write closings/{id} with the frozen eligibility snapshot
  4. update members/{closingMemberId}: status=closed, exitDateMs, closingId
  5. increment counters/stats
COMMIT
then (outside tx): rebuild indexes/closings_v1, bump version
```

**One transaction. Five writes.** Compare to the old Cloud Function, which wrote up to 5,000 documents and could half-fail.

### 4.3 Revert a closing — `POST /api/closings/{id}/revert`

The old version **deleted** payment history. The new version never destroys money records:

```
1. query payments where seqs array-contains {seq} and status == "completed"
     → only members who ACTUALLY PAID appear (typically a few hundred, not 5,000)
2. TRANSACTION (batched in chunks of 100):
     - for each such payment: remove that item, write a reversal record,
       adjust the member's ledger (seq moves back to due), refund/credit line
     - closings/{id}.status = "reverted"    (document is KEPT, seq is retired)
     - member restored: status=accepted, exitDateMs=null
     - counters adjusted
3. write audit_logs entry with before/after
4. rebuild closings index
```

The retired `seq` is skipped by the eligibility rule forever. Nothing is lost, everything is explainable.

---

## 5. Loading strategy — "good loading"

**Rule: the browser never talks to Firestore directly for lists.** The client-side Firestore SDK is used only for auth. All data flows through Next.js route handlers running `firebase-admin`, which can use `.select()` projections, parallel queries, aggregation queries (`count()`), and server caching.

| technique | effect |
|---|---|
| `.select(...)` field projection on every list query | 60–80% smaller payloads |
| Firestore **aggregation queries** (`count()`, `sum()`) | totals without reading documents |
| Cursor pagination (`startAfter`) — 50 rows/page, AG Grid infinite row model | constant cost regardless of member count |
| TanStack Query `staleTime: 5 min` | going Back never refetches |
| `unstable_cache` + tag revalidation on the closings index | ~1 read/hour across all users |
| Counter documents for every aggregate | dashboards are O(1) |
| Optimistic UI on payment posting | instant feedback, server reconciles |
| `Cache-Control: private, max-age=…` on stable GETs | free repeat loads |

**Result: every screen loads in a bounded, predictable number of reads that does not grow with the size of your trust.**

---

## 6. Agent commission system

Two independent, configurable earning streams, exactly as you asked.

### 6.1 Rules — set once, override per agent

```js
// trusts/{tid}/programs/{pid} → commissionPolicy   (default for everyone)
// trusts/{tid}/agents/{agentId}.commissionOverride (beats the default)
{
  joinFee: {
    enabled: true,
    mode: "percent" | "fixed" | "slab",
    value: 10,                       // 10% of join fee, or ₹10 flat
    slabs: [ {upTo: 50, value: 10}, {upTo: null, value: 15} ],  // volume bonus
    payOn: "collection" | "approval"
  },
  collection: {
    enabled: true,
    mode: "percent" | "fixed_per_closing" | "slab",
    value: 5,                        // 5% of collected, or ₹5 per closing collected
    payOn: "collection"
  },
  minPayout: 500,
  autoApprove: false
}
```

Because it is **data, not code**, you change an agent's rate from the Settings screen and the next receipt uses it. Nothing to redeploy.

### 6.2 `commission_entries/{entryId}` — an append-only ledger

```js
{
  agentId, agentName,
  type: "join_fee" | "collection",
  sourceType: "member" | "payment",
  sourceId,                          // memberId or receiptId
  memberId, memberName, memberRegNo,
  baseAmount: 600,                   // what the commission was computed on
  rateMode: "percent", rateValue: 5,
  amount: 30,
  earnedAtMs,
  status: "earned" | "approved" | "paid" | "cancelled",
  payoutId,
  createdAt, createdBy
}
```

One entry per earning event, written **inside the same transaction as the payment**. Cancel a receipt → its commission entry is cancelled in the same transaction. Commission can never drift from collections.

### 6.3 `commission_payouts/{payoutId}` — settlement

```js
{
  payoutNo: "PAY-2026-0012",
  agentId, agentName,
  periodFromMs, periodToMs,
  entryIds: [...], entryCount: 87,
  joinFeeTotal: 870, collectionTotal: 2415, grossTotal: 3285,
  deductions: [{label, amount}], netTotal: 3285,
  method, reference, paidAtMs,
  status: "draft" | "paid" | "cancelled",
  statementPdfURL,                   // auto-generated §7
  createdAt, createdBy, approvedBy
}
```

### 6.4 Agent-facing screens

- **Agent dashboard** — counters live on `agents/{id}` (`earnedTotal`, `paidTotal`, `dueTotal`) → **1 read**.
- **Earnings statement** — filter by date/type/status, export as PDF or Excel.
- **My members** — their members with due amounts, from the members index.
- **Collect payment** — the same receipt flow, auto-tagged with their `agentId`, commission computed and shown *before* they submit.

> **Hinglish:** Agent ko har receipt par turant dikh jaayega ki usne kitna kamaaya. Admin ko ek screen par sab agents ka due dikhega, aur "Payout" button dabate hi statement PDF ban jaayegi.

---

## 7. PDF engine — dynamic, server-side, clonable

### 7.1 Branding lives in the database, not in code

```js
// trusts/{trustId}.branding
{
  nameHi: "श्री ... ट्रस्ट", nameEn: "Shri ... Trust",
  tagline, registrationNo, panNo, regDate,
  addressHi, addressEn, city, district, state, pinCode,
  phone: [], email, website,

  logoURL, watermarkURL, deityImageURL,      // Storage URLs
  sealURL, signatureURL, signatoryName, signatoryDesignation,

  theme: { primary:"#8B0000", accent:"#D4AF37", headerBg, textColor },
  headerLines: ["...", "..."],               // free-form, per trust
  footerNote, terms: [],
  receiptPrefix: "RSD", showQR: true, language: "hi" | "hi-en"
}
```

Every PDF template takes `branding` as a parameter. **Cloning for another trust = insert one document + upload a logo.** No code edit, no rebuild, no redeploy.

### 7.2 Fixes to the old PDF stack

| old | new |
|---|---|
| `logo.js` = 272 KB base64 **in the JS bundle** | Storage URL, fetched at render, cached |
| `fontBase64.js` + 2 Devanagari fonts = **1.1 MB of base64 JS** | real `.ttf` files in `/public/fonts`, registered once server-side |
| jsPDF + html2canvas (blurry, breaks Hindi, freezes the tab) | `@react-pdf/renderer` **server-side only**, real vector text |
| 5,000-row PDF generated in the browser | background job → Storage → download link |

### 7.3 Templates

| template | route |
|---|---|
| Receipt / रसीद (single + bulk) | `/api/pdf/receipt` |
| Member registration form | `/api/pdf/member-form` |
| Closing form / invitation | `/api/pdf/closing-form` |
| Member list (filtered, any column set) | `/api/pdf/member-list` |
| Pending payment list (per member / agent / group) | `/api/pdf/pending-list` |
| Closing collection report | `/api/pdf/closing-report` |
| Agent commission statement | `/api/pdf/agent-statement` |
| Transaction report | `/api/pdf/transactions` |
| Membership certificate | `/api/pdf/certificate` |

### 7.4 Large PDFs — background jobs

```
POST /api/pdf/{template}          → { jobId }   (returns immediately)
     writes pdf_jobs/{jobId} status=queued
     route handler streams generation, uploads to Storage
GET  /api/pdf/jobs/{jobId}        → { status, progress, url }
```

A progress widget (the old `Globalpdfwidget` idea, done properly) shows every running job. Downloads are signed Storage URLs — **the browser never has to hold a 40 MB PDF in memory.**

---

## 8. API surface

```
/api/auth/*                    session, role claims, member self-service login
/api/members                   GET (cursor-paginated, filtered, projected) · POST
/api/members/[id]              GET · PATCH · DELETE (soft)
/api/members/[id]/ledger       GET — derived pending + paid history (1 read)
/api/members/bulk              POST — bulk import / bulk account creation
/api/closings                  GET · POST (transactional)
/api/closings/[id]             GET · PATCH
/api/closings/[id]/revert      POST (safe, auditable)
/api/closings/[id]/collection  GET — who paid / who is pending, paginated
/api/payments                  GET · POST (transactional, idempotent)
/api/payments/[id]/cancel      POST — reversal, never a delete
/api/payments/bulk             POST — one receipt across many members
/api/agents                    GET · POST
/api/agents/[id]/commission    GET — entries + summary
/api/commission/payouts        GET · POST
/api/groups                    GET · POST · members add/remove (flat docs)
/api/indexes/closings          GET — cached index, version-checked
/api/indexes/members           GET — search shards
/api/stats                     GET — 1 read
/api/pdf/*                     POST → jobId · GET job status
/api/trust/branding            GET · PATCH — the clone-a-trust surface
```

---

## 9. Folder structure

```
src/
├─ app/
│  ├─ (auth)/login/
│  ├─ (admin)/dashboard | members | closings | payments | agents |
│  │          commission | groups | transactions | reports | settings/
│  ├─ (agent)/…            role-scoped views
│  ├─ (member)/…           member self-service
│  └─ api/…                route handlers (§8)
├─ server/                 ← server-only, never imported by client
│  ├─ firebase/admin.js
│  ├─ auth/session.js · guards.js
│  ├─ domain/
│  │   ├─ ledger.js        ★ eligibility + paid-set maths, pure functions
│  │   ├─ members.js · closings.js · payments.js
│  │   ├─ commission.js · groups.js · stats.js
│  │   └─ indexes.js
│  ├─ pdf/                 templates + branding loader + fonts
│  └─ audit.js
├─ lib/                    client: query hooks, api client, formatters, dates
├─ components/             ui/ · tables/ · forms/ · pdf-preview/
└─ config/                 constants, static data (states/districts), zod schemas
```

`server/domain/ledger.js` is the heart of the system and is **pure, dependency-free, and unit-tested** — eligibility, watermark compaction, due computation. Everything else calls into it.

---

## 10. Migration from the old Firebase project

A one-shot script, run offline, fully verifiable.

```
Step 1  Export   users/{uid}/programs/{pid}/{members, payment_pending,
                 transactions, closing_groups} → local NDJSON
Step 2  Trust    create trusts/{trustId} + branding from old settings/organization
Step 3  Closings from members where marriage_flag == true,
                 sorted by marriage_date → assign seq 1..N
Step 4  Members  map fields, parse DD-MM-YYYY → joinDateMs (single place, tested)
Step 5  Ledger   for each member: collect paid seqs from old `transactions`
                 (the money record — NOT payment_pending, which is derived),
                 compute paidUpTo + paidSeqs + exemptSeqs + counters
Step 6  Payments group old transactions by batchId → one receipt each
Step 7  Indexes  build closings_v1 + member search shards
Step 8  Counters recompute stats from scratch
Step 9  VERIFY   ── this is the important step ──
        · total collected (old) == total collected (new)
        · per-member paid count (old) == (new)      for all 5,000
        · per-closing paid count (old) == (new)     for all 500
        · every old paid payment_pending row maps to a new paid seq
        → any mismatch is written to a reconciliation report; nothing goes
          live until that report is empty
Step 10 Firebase Auth users are untouched — logins keep working unchanged
```

The old project is **never modified**. It stays running until you have verified the new one.

---

## 11. Delivery phases

| # | phase | delivers |
|---|---|---|
| 1 | Foundation | deps, structure, admin SDK, auth + roles, layout, `ledger.js` + its tests |
| 2 | Members | CRUD, AG Grid infinite list, search index, import, registration PDF |
| 3 | Closings | create/edit/revert transactions, closings index, closing-form PDF |
| 4 | Payments | receipt posting, bulk collection, cancel/reversal, रसीद PDF |
| 5 | Agents & commission | rules, entries ledger, payouts, statement PDF, agent portal |
| 6 | Reports & PDFs | all templates, background jobs, Excel export |
| 7 | Groups, settings, branding | group management, the clone-a-trust screen |
| 8 | Migration & go-live | script, reconciliation report, cutover |

---

## 12. Summary — what changes for you

| your complaint | the fix |
|---|---|
| Firebase bill too high | 2.5M obligation docs → 0. Reads per screen drop 500×–12,000×. |
| Loads all data every time | Cursor pagination + counter docs + cached indexes. Every screen is a bounded number of reads. |
| Closing system not proper | One transaction, five writes, frozen eligibility snapshot, one rule in one file. |
| Revert breaks things | Nothing is deleted. Reversal records + audit log. Only actual payers are touched. |
| Pending/paid gets stuck | Server recomputes what is genuinely due inside the transaction. Idempotency keys. Double-submit is impossible. |
| Group system not proper | Flat `group_members` documents instead of an array in one doc. No 1MB cap, no lost updates. |
| PDF list / रसीद / download | Server-side @react-pdf, real Devanagari fonts, background jobs for big lists, signed download URLs. |
| Can't give it to another trust | All branding is data. New trust = one document + a logo. |
| No commission system | Two configurable streams (join fee + collection), append-only ledger, payouts, statements. |
