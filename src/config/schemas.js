import { z } from 'zod';

import {
  CLOSING_TYPE,
  MEMBER_STATUS,
  PAYMENT_METHOD,
  COMMISSION_MODE,
  LIMITS,
  ROLE,
} from './constants.js';

/**
 * Every request body and query string is validated here before it reaches the
 * domain layer. The old app trusted whatever the browser sent — including the
 * `userId` that decided which trust's data to read.
 */

/* ── primitives ──────────────────────────────────────────────────────────── */

const trimmed = (max = 200) => z.string().trim().max(max);
const optionalText = (max = 200) => trimmed(max).optional().default('');

/** Accepts "DD-MM-YYYY", an ISO string, or epoch ms — always returns epoch ms. */
export const dateMs = z.union([z.number(), z.string()]).transform((v, ctx) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;

  const s = String(v).trim();

  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return Date.UTC(Number(y), Number(m) - 1, Number(d));
  }

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return parsed;

  ctx.addIssue({
    code: 'custom',
    message: `"${s}" is not a valid date — use DD-MM-YYYY`,
  });
  return z.NEVER;
});

export const phone = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s]{6,15}$/, 'Enter a valid phone number')
  .optional()
  .or(z.literal(''));

const money = z.coerce.number().min(0).max(10_000_000);
const seq = z.coerce.number().int().positive();

/* ── pagination ──────────────────────────────────────────────────────────── */

export const paginationQuery = z.object({
  cursor: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  /**
   * The ceiling comes from `LIMITS.MAX_PAGE_SIZE`, not from a number typed
   * here.
   *
   * It used to be a literal 100 while `LIMITS.MAX_PAGE_SIZE` said 200, and
   * every route clamped with the constant — so a request for 200 was clamped
   * to 200 by the handler and then rejected by this schema before the handler
   * ever ran. Two caps that disagree means the stricter one wins silently and
   * the documented one is a lie.
   */
  limit: z.coerce.number().int().min(1).max(LIMITS.MAX_PAGE_SIZE).optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

/** `?x=true` / `?x=false`, absent meaning "do not filter on this". */
const boolFlag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

/** A comma-separated list in the URL, an array in the handler. */
const csv = z
  .string()
  .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
  .optional();

/**
 * A text field in a PATCH body.
 *
 * Deliberately NOT `optionalText`: that one defaults to `''`, which is right
 * when creating a record and wrong when merging into one, because it turns
 * "I did not send this field" into "blank this field". Sending
 * `{ active: false }` for a team member must not erase their phone number.
 */
const patchText = (max = 200) => z.string().trim().max(max).optional();

/* ── members ─────────────────────────────────────────────────────────────── */

/**
 * Note what is NOT here: `payAmount` and `joinFees`.
 *
 * Those are derived on the server from the program's age groups and the
 * member's date of birth. The form shows them, but it does not get to send
 * them — a browser must never be able to choose what somebody pays.
 */
export const memberCreate = z.object({
  /**
   * Which योजना this member joins. Required, and NOT taken from the session:
   * a trust runs several programs at once and the operator picks one per
   * member. It also decides the age bands, so it must be settled before any
   * rate can be worked out.
   */
  programId: z.string().min(1, 'योजना चुनें'),

  // व्यक्तिगत जानकारी
  displayName: trimmed(120).min(2, 'नाम ज़रूरी है'),
  fatherName: optionalText(120),
  jati: optionalText(60),
  gotra: optionalText(60),
  guardian: optionalText(120),
  guardianRelation: optionalText(40),
  gender: optionalText(20),

  // संपर्क जानकारी
  phone,
  phoneAlt: phone,
  aadhaarNo: z.string().trim().regex(/^\d{12}$/).optional().or(z.literal('')),

  // आयु और कार्यक्रम
  bobDate: optionalText(20),
  bobDateMs: dateMs,
  joinDate: optionalText(20),
  joinDateMs: dateMs,
  locationGroupId: z.string().optional().nullable(),

  // पता
  state: optionalText(80),
  district: optionalText(80),
  village: optionalText(120),
  pinCode: z.string().trim().regex(/^\d{6}$/).optional().or(z.literal('')),
  currentAddress: optionalText(400),

  // दस्तावेज़ और फोटो
  photoURL: z.string().url().optional().or(z.literal('')),
  extraImageURL: z.string().url().optional().or(z.literal('')),
  documentFrontURL: z.string().url().optional().or(z.literal('')),
  documentBackURL: z.string().url().optional().or(z.literal('')),
  guardianDocumentURL: z.string().url().optional().or(z.literal('')),

  // अतिरिक्त जानकारी
  extraDetails: z
    .array(z.object({ label: trimmed(80), value: trimmed(200) }))
    .max(20)
    .optional()
    .default([]),

  // जोड़ा गया
  addedBy: z.enum(['admin', 'agent']).default('admin'),
  agentId: z.string().optional().nullable(),

  // नामांकन शुल्क
  joinFeesDone: z.boolean().optional().default(false),
  /**
   * How much of the joining fee is being handed over right now.
   *
   * Separate from `joinFeesDone` because a fee is not all-or-nothing: a member
   * whose band charges ₹11,000 may put down ₹2,100 at the desk and the rest
   * over the following months. Absent (with `joinFeesDone` ticked) still means
   * the whole fee, so older callers keep working.
   *
   * Capped server-side at the member's real fee — the band decides the total,
   * not the form.
   */
  joinFeesPaidNow: money.optional(),
  joinFeesTxtId: optionalText(80),
  /**
   * How the joining fee was taken.
   *
   * Needed because marking the fee paid now writes a real receipt rather than
   * flipping a flag — and a receipt with no payment method is a receipt nobody
   * can reconcile against a cash box or a bank statement.
   */
  joinFeesMethod: z.enum(Object.values(PAYMENT_METHOD)).optional(),

  registrationNumber: z.string().trim().max(20).optional(),
  status: z.enum(Object.values(MEMBER_STATUS)).optional(),
});

/**
 * Turn a create schema into a patch schema, honestly.
 *
 * `.partial()` alone is not enough and the difference is dangerous. It makes
 * every field optional but KEEPS its `.default()`, so a field the caller never
 * mentioned still arrives at Firestore carrying `''` or `[]`. Sending
 * `{ status: 'blocked' }` for a member would blank their father's name, गोत्र,
 * guardian, address and extra details in the same write — silently, because
 * every one of those is a valid value.
 *
 * This unwraps the defaults first, so "absent" survives as absent all the way
 * to the merge.
 */
function asPatch(objectSchema) {
  const shape = objectSchema.shape ?? {};
  const next = {};

  for (const [key, field] of Object.entries(shape)) {
    let inner = field;
    // Peel every layer of `.default()` — zod nests them.
    while (inner?.def?.type === 'default') inner = inner.def.innerType;
    next[key] = inner.optional();
  }

  return z.object(next);
}

export const memberUpdate = asPatch(memberCreate).extend({
  joinDateMs: dateMs.optional(),
  bobDateMs: dateMs.optional(),
});

/**
 * Every way the members list can be narrowed.
 *
 * All of it is applied in memory against the search index, which is why the
 * list can offer any combination of these without a Firestore composite index
 * per combination — and why free-text `q` can search across nine fields at
 * once, which Firestore cannot do at all.
 *
 * Multi-value filters take a comma-separated list, so "स्वीकृत या लंबित" is one
 * request rather than two.
 */
export const memberListQuery = paginationQuery.extend({
  /** Free text: name, reg no., phone, father, village, agent, Aadhaar. */
  q: z.string().max(80).optional(),

  status: csv,
  gender: csv,
  ageBand: csv,
  agentId: csv,
  village: csv,
  district: csv,
  programId: z.string().optional(),

  /** Look across every योजना in the trust rather than just the current one. */
  allPrograms: boolFlag,

  ageMin: z.coerce.number().int().min(0).max(120).optional(),
  ageMax: z.coerce.number().int().min(0).max(120).optional(),

  /** Joining-date window, in epoch milliseconds. */
  joinFrom: z.coerce.number().int().optional(),
  joinTo: z.coerce.number().int().optional(),

  hasDue: boolFlag,
  feeDone: boolFlag,
  /** Part or all of the joining fee still outstanding. */
  hasFeeDue: boolFlag,
  /** A closing OR a joining fee outstanding — anything at all. */
  owesAnything: boolFlag,
  minDue: z.coerce.number().min(0).optional(),

  groupId: z.string().optional(),
});

/** Same filters as the list, plus which dimensions to group by. */
export const memberSummaryQuery = memberListQuery.extend({
  groupBy: z
    .string()
    .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
    .optional(),
});

/** The list, as a file. `format` decides which one. */
export const memberExportQuery = memberListQuery.extend({
  format: z.enum(['csv', 'pdf']).default('csv'),
});

export const memberStatusChange = z.object({
  status: z.enum(Object.values(MEMBER_STATUS)),
  reason: optionalText(300),
  atMs: dateMs.optional(),
});

/* ── closings ────────────────────────────────────────────────────────────── */

export const closingCreate = z.object({
  memberId: z.string().min(1),
  closingDate: optionalText(20),
  closingDateMs: dateMs,
  closingType: z.enum(Object.values(CLOSING_TYPE)).optional(),
  /**
   * No `amountPerMember`.
   *
   * Each member pays the rate on their own record, from their age band. A
   * figure supplied here never changed that — it only changed the total the
   * screen reported, so the screen and the receipts disagreed. The server now
   * sums the members instead.
   */
  groupId: z.string().optional().nullable(),
  groupName: optionalText(120),
  /** Which क्लोजिंग समूह this closing is billed on. Validated server-side. */
  batchId: z.string().optional().nullable(),
  /**
   * Whether blocked (निष्क्रिय) members are billed for this closing.
   *
   * Decided per closing and frozen on it. Defaults to true, which is what the
   * trust has always done — a block is a warning, not an exit.
   */
  includeBlocked: z.boolean().optional().default(true),
  invitationCardURL: z.string().url().optional().or(z.literal('')),
  notes: optionalText(1000),
  pdfData: z.record(z.string(), z.any()).optional(),
});

/**
 * The money on the समापन पत्र — what the family was handed, and against what.
 *
 * Stored on the closing rather than computed at print time: the moment the
 * वारिसदार signs, that is what the paper said, and a reprint six months later
 * — after more members have paid — must not show a different figure from the
 * signed copy.
 */
export const closingPayout = z.object({
  /** Collected against this closing so far. Seeded from the counter, then fixed. */
  memberContributed: money.optional(),
  membersCount: z.coerce.number().int().min(0).max(1_000_000).optional(),
  /** What the trust is handing over. */
  amountGiven: money.optional(),
  paymentMode: optionalText(40),
  /** This member's own arrears, deducted from what they receive. */
  oldPending: money.optional(),
  netAmount: money.optional(),
  payoutDate: optionalText(20),
});

/**
 * Correcting a closing after the fact.
 *
 * The date is editable and that is not a small thing — it is the one field
 * eligibility is decided by. Which is exactly why it must be: a wrong date
 * silently bills the wrong people, and the only alternative was reverting the
 * whole case and closing the member again.
 */
export const closingUpdate = z.object({
  closingDate: optionalText(20).optional(),
  closingDateMs: dateMs.optional(),
  closingType: z.enum(Object.values(CLOSING_TYPE)).optional(),
  notes: optionalText(1000).optional(),
  invitationCardURL: z.string().url().optional().or(z.literal('')),
  batchId: z.string().optional().nullable(),
  payout: closingPayout.optional(),
});

/**
 * क्लोजिंग समूह — the batch a month's closings are billed on.
 *
 * `code` is accepted on create only. It is printed inside every receipt number
 * issued under the batch, so it is fixed once and never patched.
 */
export const closingBatchCreate = z.object({
  name: trimmed(120).min(2, 'समूह का नाम ज़रूरी है'),
  code: z.string().trim().max(8).optional(),
  description: optionalText(300),
  dueDate: optionalText(20),
  dueDateMs: dateMs.optional().nullable(),
  paymentNote: optionalText(600),
  invitationCardURL: z.string().url().optional().or(z.literal('')),
});

/** Which closings to put on a batch's notice, or take off it. */
export const batchClosingsPatch = z.object({
  closingIds: z.array(z.string().min(1)).min(1, 'कोई क्लोजिंग नहीं चुनी').max(200),
  /** true sends them to no batch at all, rather than to this one. */
  remove: z.boolean().optional().default(false),
});

export const closingBatchUpdate = asPatch(closingBatchCreate)
  .omit({ code: true })
  .extend({ status: z.enum(['open', 'issued']).optional() });

export const closingRevert = z.object({
  reason: trimmed(300).min(3, 'Please give a reason — this is recorded in the audit log'),
  refundMode: z.enum(['keep', 'cancel']).optional().default('keep'),
});

/* ── payments ────────────────────────────────────────────────────────────── */

/**
 * One deposit split across many members.
 *
 * `amount` with a `rule` is the automatic split; `byMember` is the operator's
 * hand-edited version of it, which wins when present. Both are clamped
 * server-side to what each member actually owes — the browser proposes, the
 * ledger disposes.
 */
export const bulkCollectInput = z.object({
  memberIds: z.array(z.string().min(1)).min(1).max(500),

  amount: money.optional(),
  rule: z.enum(['member', 'oldest']).optional().default('member'),
  /** What this deposit is allowed to settle. */
  include: z.enum(['both', 'closings', 'fees']).optional().default('both'),
  /** memberId → amount, when the operator has adjusted the split. */
  byMember: z.record(z.string(), money).optional(),

  method: z.enum(Object.values(PAYMENT_METHOD)),
  paidAtMs: dateMs,
  reference: optionalText(80),
  note: optionalText(500),

  collectedByAgentId: z.string().optional().nullable(),

  /** True returns the split without writing anything. */
  preview: z.boolean().optional().default(false),
  idempotencyKey: z.string().trim().max(120).optional(),
}).refine(
  (v) => v.byMember !== undefined || (v.amount ?? 0) > 0,
  { message: 'राशि डालें', path: ['amount'] },
).refine(
  (v) => v.preview || v.method !== PAYMENT_METHOD.ONLINE || Boolean(v.reference),
  { message: 'An online payment needs a reference number', path: ['reference'] },
);

export const paymentCreate = z.object({
  memberId: z.string().min(1),
  seqs: z.array(seq).max(2000).default([]),
  /** Optional partial amounts, keyed by seq. Omit for full payment. */
  amounts: z.record(z.string(), money).optional(),

  method: z.enum(Object.values(PAYMENT_METHOD)),
  paidAtMs: dateMs,
  reference: optionalText(80),
  note: optionalText(500),

  joinFeeAmount: money.optional(),
  collectedByAgentId: z.string().optional().nullable(),
  idempotencyKey: z.string().trim().max(120).optional(),
}).refine(
  (v) => v.seqs.length > 0 || (v.joinFeeAmount ?? 0) > 0,
  { message: 'Select at least one closing, or enter a joining fee' },
).refine(
  (v) => v.method !== PAYMENT_METHOD.ONLINE || Boolean(v.reference),
  { message: 'An online payment needs a reference number', path: ['reference'] },
);

/** Collect from several members in one go. */
export const paymentBulk = z.object({
  method: z.enum(Object.values(PAYMENT_METHOD)),
  paidAtMs: dateMs,
  reference: optionalText(80),
  note: optionalText(500),
  collectedByAgentId: z.string().optional().nullable(),
  idempotencyKey: z.string().trim().max(120).optional(),
  /** memberId → the seqs being paid for that member. Explicit beats clever. */
  selections: z.record(z.string(), z.array(seq).min(1)),
});

export const paymentCancel = z.object({
  reason: trimmed(300).min(3, 'Please give a reason — this is recorded'),
});

/* ── agents & commission ─────────────────────────────────────────────────── */

const commissionRule = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(Object.values(COMMISSION_MODE)).default(COMMISSION_MODE.PERCENT),
  value: z.coerce.number().min(0).max(100000).default(0),
  slabMode: z.enum([COMMISSION_MODE.PERCENT, COMMISSION_MODE.FIXED]).optional(),
  slabs: z
    .array(
      z.object({
        upTo: z.coerce.number().int().positive().nullable(),
        value: z.coerce.number().min(0),
      }),
    )
    .max(10)
    .optional(),
});

export const commissionPolicy = z.object({
  joinFee: commissionRule,
  collection: commissionRule,
  minPayout: money.optional(),
  autoApprove: z.boolean().optional(),
});

export const agentCreate = z.object({
  displayName: trimmed(120).min(2, 'नाम ज़रूरी है'),
  /** Required: the agent signs in with this. */
  email: z.string().trim().email('सही ईमेल डालें'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, '10 अंकों का नंबर डालें')
    .optional()
    .or(z.literal('')),

  dateJoin: optionalText(20),
  dateJoinMs: dateMs.optional(),

  address: optionalText(400),
  city: optionalText(80),
  village: optionalText(120),
  state: optionalText(80),
  district: optionalText(80),
  pinCode: z.string().trim().regex(/^\d{6}$/, '6 अंक').optional().or(z.literal('')),

  photoURL: z.string().url().optional().or(z.literal('')),
  signatureURL: z.string().url().optional().or(z.literal('')),
  documentURLs: z.array(z.string().url()).max(5).optional().default([]),

  /** Optional: leave blank and one is generated and shown once. */
  password: z.string().min(6).max(64).optional().or(z.literal('')),
  sendEmail: z.boolean().optional().default(false),

  commissionOverride: commissionPolicy.partial().optional(),
  active: z.boolean().optional(),
});

/**
 * Editing an agent.
 *
 * Written out rather than derived with `agentCreate.partial()`, and that is
 * not style. `.partial()` makes every field optional but KEEPS its `.default()`
 * — so `optionalText` fields default to `''` and `documentURLs` to `[]` even
 * when the caller never mentioned them. Sending `{ active: false }` to switch
 * an agent off would have blanked their address, city, village, state,
 * district and uploaded documents, silently, in the same write.
 *
 * A PATCH body must be able to say nothing about a field. Nothing here has a
 * default, so "absent" stays absent.
 *
 * `email` is allowed through — it is the login, and `updateAgent` changes the
 * Firebase Auth account to match. `password` is not: a password riding along
 * with a name change would be applied without anyone being shown it, and
 * setting one has its own endpoint that revokes existing sessions.
 */
export const agentUpdate = z.object({
  displayName: trimmed(120).min(2, 'नाम ज़रूरी है').optional(),
  email: z.string().trim().email('सही ईमेल डालें').optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, '10 अंकों का नंबर डालें')
    .or(z.literal(''))
    .optional(),

  dateJoin: patchText(20),
  dateJoinMs: dateMs.optional(),

  address: patchText(400),
  city: patchText(80),
  village: patchText(120),
  state: patchText(80),
  district: patchText(80),
  pinCode: z.string().trim().regex(/^\d{6}$/, '6 अंक').or(z.literal('')).optional(),

  photoURL: z.string().url().or(z.literal('')).optional(),
  signatureURL: z.string().url().or(z.literal('')).optional(),
  documentURLs: z.array(z.string().url()).max(5).optional(),

  commissionOverride: commissionPolicy.partial().nullable().optional(),
  active: z.boolean().optional(),
});


/**
 * Handing an agent's position to a different person.
 *
 * Only what identifies the NEW person. Everything else about the position —
 * the members, the commission policy, the totals, the id — is deliberately not
 * settable here, because none of it is changing.
 */
export const agentHandover = z.object({
  displayName: trimmed(120).min(2, 'नए व्यक्ति का नाम ज़रूरी है'),
  email: z.string().trim().email('सही ईमेल डालें'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, '10 अंकों का नंबर डालें')
    .or(z.literal(''))
    .optional(),
  /** Blank generates one, shown exactly once. */
  password: z.string().min(6).max(64).or(z.literal('')).optional(),
  photoURL: z.string().url().or(z.literal('')).optional(),
  signatureURL: z.string().url().or(z.literal('')).optional(),
  /** Why the change — this is the bit that makes the history readable later. */
  note: patchText(300),
});

/* ── programs (योजना) & groups ───────────────────────────────────────────── */

/**
 * An age band. `payAmount` is the per-closing contribution and `joinFee` the
 * one-time joining fee for members who fall in this band when they join.
 */
export const ageGroupSchema = z.object({
  id: z.string().optional(),
  startAge: z.coerce.number().min(0).max(150),
  endAge: z.coerce.number().min(0).max(150),
  joinFee: money.default(0),
  payAmount: money.default(0),
});

export const locationGroupSchema = z.object({
  id: z.string().optional(),
  groupName: trimmed(120).min(1),
  location: trimmed(120).min(1),
  groupType: z.enum(['A', 'B', 'C']),
});

export const PROGRAM_CATEGORIES = ['isSuraksha', 'isMamera', 'isVivah', 'isOther'];

/**
 * How a योजना builds its registration numbers.
 *
 * Two recipes, because trusts genuinely do both: count up from a chosen number
 * with a prefix, or issue random numbers so a member's number gives away
 * neither when they joined nor how many members there are.
 */
export const registrationConfig = z.object({
  mode: z.enum(['sequential', 'random']).default('sequential'),
  prefix: z.string().trim().max(10).optional().default(''),
  suffix: z.string().trim().max(10).optional().default(''),
  /** Sequential: the number the FIRST member of this योजना gets. */
  startFrom: z.coerce.number().int().min(1).max(1_000_000_000).optional().default(1001),
  /** Zero-pad the digits to this width. 0 leaves them as they are. */
  padding: z.coerce.number().int().min(0).max(12).optional().default(0),
  /** Random: how many digits to draw. */
  randomLength: z.coerce.number().int().min(4).max(12).optional().default(6),
});

export const programCreate = z
  .object({
    name: trimmed(200).min(2, 'योजना का नाम ज़रूरी है'),
    hiname: optionalText(200),
    about: optionalText(1000),
    noteLine: optionalText(500),
    category: z.enum(PROGRAM_CATEGORIES).default('isOther'),
    isSelected: z.boolean().optional().default(false),

    ageGroups: z.array(ageGroupSchema).min(1, 'कम से कम एक आयु समूह ज़रूरी है'),
    locationGroups: z.array(locationGroupSchema).default([]),

    receiptPrefix: z.string().trim().max(8).optional(),

    /**
     * How this योजना builds its registration numbers.
     *
     * Replaces the old bare `startRegistrationNumber`, which could only count
     * up from a number and had no room for a prefix — so a trust running two
     * schemes had two members numbered 1042 and no way to tell them apart on
     * a receipt.
     */
    registration: registrationConfig.optional(),
    commissionPolicy: commissionPolicy.partial().optional(),
  })
  .superRefine((value, ctx) => {
    // Overlapping bands make a member's rate ambiguous, and a gap makes them
    // unaddable. Catch it here rather than when someone can't be registered.
    const sorted = [...value.ageGroups].sort((a, b) => a.startAge - b.startAge);
    sorted.forEach((g, i) => {
      if (g.endAge <= g.startAge) {
        ctx.addIssue({
          code: 'custom',
          path: ['ageGroups', i, 'endAge'],
          message: 'अंतिम आयु शुरुआती आयु से बड़ी होनी चाहिए',
        });
      }
      if (i > 0 && g.startAge < sorted[i - 1].endAge) {
        ctx.addIssue({
          code: 'custom',
          path: ['ageGroups', i, 'startAge'],
          message: `पिछले समूह (${sorted[i - 1].startAge}-${sorted[i - 1].endAge}) से टकरा रहा है`,
        });
      }
    });
  });

export const programUpdate = programCreate;

export const groupCreate = z.object({
  name: trimmed(120).min(2, 'नाम ज़रूरी है'),
  description: optionalText(300),
  payAmount: money.optional(),
  joinFees: money.optional(),
});

export const payoutCreate = z.object({
  agentId: z.string().min(1),
  periodFromMs: dateMs.optional(),
  periodToMs: dateMs.optional(),
  entryIds: z.array(z.string()).min(1).max(2000),
  deductions: z
    .array(z.object({ label: trimmed(80), amount: money }))
    .max(20)
    .optional(),
  method: z.enum(Object.values(PAYMENT_METHOD)).optional(),
  reference: optionalText(80),
  note: optionalText(500),
});

/* ── trust branding ──────────────────────────────────────────────────────── */

export const brandingUpdate = z.object({
  nameHi: optionalText(200),
  nameEn: optionalText(200),
  tagline: optionalText(200),
  registrationNo: optionalText(60),
  panNo: optionalText(20),
  regDate: optionalText(20),

  addressHi: optionalText(400),
  addressEn: optionalText(400),
  city: optionalText(80),
  district: optionalText(80),
  state: optionalText(80),
  pinCode: optionalText(10),
  phone: z.array(trimmed(20)).max(5).optional(),
  email: z.string().email().optional().or(z.literal('')),
  website: z.string().url().optional().or(z.literal('')),

  logoURL: z.string().url().optional().or(z.literal('')),
  watermarkURL: z.string().url().optional().or(z.literal('')),
  deityImageURL: z.string().url().optional().or(z.literal('')),
  sealURL: z.string().url().optional().or(z.literal('')),
  signatureURL: z.string().url().optional().or(z.literal('')),
  signatoryName: optionalText(120),
  signatoryDesignation: optionalText(120),

  theme: z
    .object({
      primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      headerBg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    .optional(),

  headerLines: z.array(trimmed(200)).max(6).optional(),
  footerNote: optionalText(400),
  terms: z.array(trimmed(300)).max(10).optional(),
  receiptPrefix: z.string().trim().max(8).optional(),
  showQR: z.boolean().optional(),
  language: z.enum(['hi', 'en', 'hi-en']).optional(),
});

/* ── auth ────────────────────────────────────────────────────────────────── */

export const sessionCreate = z.object({
  idToken: z.string().min(20),
});

/* ── the trust itself ────────────────────────────────────────────────────── */

/**
 * Editing the trust.
 *
 * `branding` is merged, not replaced, so a form that shows eight fields cannot
 * blank the other twenty. That is why almost everything here is optional —
 * "not sent" and "cleared" are different intentions and must stay different.
 */
export const trustUpdate = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  branding: z
    .object({
      nameHi: patchText(200),
      nameEn: patchText(200),
      tagline: patchText(200),
      cityState: patchText(120),
      registrationNo: patchText(80),
      panNo: patchText(20),
      regDate: patchText(20),
      addressHi: patchText(400),
      city: patchText(80),
      district: patchText(80),
      state: patchText(80),
      pinCode: patchText(10),
      phone: z.array(z.string().trim().max(20)).max(5).optional(),
      email: z.string().trim().email().or(z.literal('')).optional(),
      website: patchText(120),
      contactPerson: patchText(120),

      logoURL: patchText(600),
      rightLogoURL: patchText(600),
      headerImageURL: patchText(600),
      bannerURL: patchText(600),
      sealURL: patchText(600),
      signatureURL: patchText(600),
      signatoryName: patchText(120),
      signatoryDesignation: patchText(80),
      presidentName: patchText(120),

      /** Invocations above the name — `|| श्री गणेशाय नमः ||`. */
      topLines: z.array(z.string().trim().max(200)).max(6).optional(),
      headerLines: z.array(z.string().trim().max(200)).max(6).optional(),
      footerNote: patchText(400),
      terms: z.array(z.string().trim().max(300)).max(12).optional(),

      theme: z
        .object({
          primary: z.string().trim().max(20).optional(),
          accent: z.string().trim().max(20).optional(),
        })
        .optional(),

      receiptPrefix: z.string().trim().max(8).optional(),
      language: z.enum(['hi', 'en']).optional(),
      showQR: z.boolean().optional(),
    })
    .optional(),
});

/* ── team members ────────────────────────────────────────────────────────── */

/** Roles a team member may be given. Owner is not one of them — an owner is
 *  created by `npm run create-owner`, never handed out from a settings page. */
const TEAM_ROLES = [ROLE.ADMIN, ROLE.OPERATOR, ROLE.AGENT];

export const teamMemberCreate = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  /** Optional — one is generated and shown once if this is left empty. */
  password: z.string().min(6).max(72).optional(),
  role: z.enum(TEAM_ROLES),
  designation: patchText(80),
  phone: patchText(20),
  photoURL: patchText(600),
});

export const teamMemberUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(TEAM_ROLES).optional(),
  designation: patchText(80),
  phone: patchText(20),
  photoURL: patchText(600),
  active: z.boolean().optional(),
});

/* ── reference lists ─────────────────────────────────────────────────────── */

/**
 * A whole list, replaced in one go.
 *
 * `value` is optional on the way in — a new row has no machine value yet and
 * the server generates one. An existing row sends its own back, because that
 * string is stored on every member who chose it and must never change.
 */
export const masterSave = z.object({
  items: z
    .array(
      z.object({
        value: z.string().trim().max(80).optional(),
        label: z.string().trim().min(1).max(120),
        labelEn: z.string().trim().max(120).optional(),
        parent: z.string().trim().max(80).nullable().optional(),
        active: z.boolean().optional(),
      }),
    )
    .max(2000),
});
