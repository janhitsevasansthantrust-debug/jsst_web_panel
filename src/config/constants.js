/**
 * Central constants. Nothing in this file may import anything else.
 */

/* ── Firestore paths ─────────────────────────────────────────────────────── */

export const paths = {
  trust: (t) => `trusts/${t}`,
  agents: (t) => `trusts/${t}/agents`,
  agent: (t, a) => `trusts/${t}/agents/${a}`,
  users: (t) => `trusts/${t}/users`,
  user: (t, u) => `trusts/${t}/users/${u}`,

  program: (t, p) => `trusts/${t}/programs/${p}`,
  programs: (t) => `trusts/${t}/programs`,

  /**
   * Members live in ONE collection per trust, with `programId` as a field —
   * not as a sub-collection under each program.
   *
   * The sub-collection version made "all members of this trust" impossible to
   * ask for. Finding everyone on a phone number meant one query per program;
   * so did any report that crossed programs, and a member moving between
   * programs meant a copy and a delete rather than a field change. Firestore
   * charges the same for a `where('programId','==',x)` as it does for a
   * narrower path, so the sub-collection bought nothing and cost reach.
   */
  members: (t) => `trusts/${t}/members`,
  member: (t, m) => `trusts/${t}/members/${m}`,

  closings: (t, p) => `trusts/${t}/programs/${p}/closings`,
  closing: (t, p, c) => `trusts/${t}/programs/${p}/closings/${c}`,

  payments: (t, p) => `trusts/${t}/programs/${p}/payments`,
  payment: (t, p, r) => `trusts/${t}/programs/${p}/payments/${r}`,

  groups: (t, p) => `trusts/${t}/programs/${p}/closing_groups`,
  group: (t, p, g) => `trusts/${t}/programs/${p}/closing_groups/${g}`,

  /**
   * क्लोजिंग समूह — a batch of closings billed on one notice.
   *
   * Deliberately NOT `closing_groups` above, which is the यूनिट: a member's
   * rate card. One says what a member pays per closing, the other says which
   * closings go out together this month.
   */
  closingBatches: (t, p) => `trusts/${t}/programs/${p}/closing_batches`,
  closingBatch: (t, p, b) => `trusts/${t}/programs/${p}/closing_batches/${b}`,
  groupMembers: (t, p) => `trusts/${t}/programs/${p}/group_members`,

  commissionEntries: (t, p) => `trusts/${t}/programs/${p}/commission_entries`,
  commissionPayouts: (t, p) => `trusts/${t}/programs/${p}/commission_payouts`,

  indexes: (t, p) => `trusts/${t}/programs/${p}/indexes`,
  closingsIndex: (t, p) => `trusts/${t}/programs/${p}/indexes/closings_v1`,

  /**
   * The member search index is trust-wide, matching the collection it
   * describes. One load answers every filter, in every program, including the
   * cross-program ones — which is the whole reason the collection was
   * flattened.
   */
  /**
   * Reference lists — states, districts, relations and the rest.
   *
   * One document per type, each holding its whole list. A district list is a
   * few hundred short strings; as documents it would be a few hundred reads
   * every time a form opened a dropdown, and every one of them would need an
   * index. As one document it is a single read, cached, and editable as a
   * whole — which is also how people think about a list.
   */
  masters: (t) => `trusts/${t}/masters`,

  /**
   * सदस्य जोड़ने के अनुरोध — what an agent submits from the agent app.
   *
   * Trust-level with `programId` as a field, like members. A request is NOT a
   * member: it burns no registration number, moves no counter and appears in
   * no index until the office approves it, at which point `createMember` runs
   * exactly as it does at the counter.
   */
  memberRequests: (t) => `trusts/${t}/member_requests`,
  memberRequest: (t, r) => `trusts/${t}/member_requests/${r}`,
  master: (t, type) => `trusts/${t}/masters/${type}`,

  trustIndexes: (t) => `trusts/${t}/indexes`,
  membersIndexShard: (t, n) => `trusts/${t}/indexes/members_v1_shard_${n}`,

  counters: (t, p) => `trusts/${t}/programs/${p}/counters`,
  counterSeq: (t, p) => `trusts/${t}/programs/${p}/counters/seq`,
  counterStats: (t, p) => `trusts/${t}/programs/${p}/counters/stats`,

  auditLogs: (t, p) => `trusts/${t}/programs/${p}/audit_logs`,
  pdfJobs: (t, p) => `trusts/${t}/programs/${p}/pdf_jobs`,
  idempotency: (t, p) => `trusts/${t}/programs/${p}/idempotency`,
};

/* ── Enums ───────────────────────────────────────────────────────────────── */

export const MEMBER_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CLOSED: 'closed',
  BLOCKED: 'blocked',
  LEFT: 'left',
};

/** Statuses that owe contributions going forward. */
export const ACTIVE_MEMBER_STATUSES = [MEMBER_STATUS.ACCEPTED];

export const EXIT_REASON = {
  CLOSED: 'closed',
  LEFT: 'left',
  BLOCKED: 'blocked',
  DELETED: 'deleted',
};

export const CLOSING_STATUS = {
  ACTIVE: 'active',
  REVERTING: 'reverting',
  REVERTED: 'reverted',
};

export const CLOSING_TYPE = {
  MARRIAGE: 'marriage',
  DEATH: 'death',
  OTHER: 'other',
};

export const PAYMENT_STATUS = {
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const PAYMENT_METHOD = {
  CASH: 'cash',
  ONLINE: 'online',
  UPI: 'upi',
  CHEQUE: 'cheque',
  BANK: 'bank',
};

export const COMMISSION_TYPE = {
  JOIN_FEE: 'join_fee',
  COLLECTION: 'collection',
  BONUS: 'bonus',
  ADJUSTMENT: 'adjustment',
};

export const COMMISSION_STATUS = {
  EARNED: 'earned',
  APPROVED: 'approved',
  PAID: 'paid',
  CANCELLED: 'cancelled',
};

export const COMMISSION_MODE = {
  PERCENT: 'percent',
  FIXED: 'fixed',
  FIXED_PER_CLOSING: 'fixed_per_closing',
  SLAB: 'slab',
};

export const ROLE = {
  OWNER: 'owner',
  ADMIN: 'admin',
  OPERATOR: 'operator',
  AGENT: 'agent',
  MEMBER: 'member',
};

/** Higher number = more power. Used by `requireRole`. */
export const ROLE_RANK = {
  [ROLE.MEMBER]: 10,
  [ROLE.AGENT]: 20,
  [ROLE.OPERATOR]: 30,
  [ROLE.ADMIN]: 40,
  [ROLE.OWNER]: 50,
};

/**
 * The reference lists a user can edit.
 *
 * Adding one here is all it takes: the screen, the API and the seeding all
 * read this. `parent` marks a list whose entries hang off another list —
 * districts belong to a state — which is what lets the district dropdown
 * narrow itself once a state is picked.
 */
export const MASTER_TYPES = {
  state: { label: 'राज्य', labelEn: 'State', parent: null },
  district: { label: 'ज़िला', labelEn: 'District', parent: 'state' },
  relation: { label: 'रिश्ता', labelEn: 'Relation', parent: null },
  gender: { label: 'लिंग', labelEn: 'Gender', parent: null },
  jati: { label: 'जाति', labelEn: 'Caste', parent: null },
  paymentMethod: { label: 'भुगतान माध्यम', labelEn: 'Payment method', parent: null },
  closingType: { label: 'क्लोजिंग का प्रकार', labelEn: 'Closing type', parent: null },
  designation: { label: 'पद', labelEn: 'Designation', parent: null },
};

export const MEMBER_REQUEST_STATUS = {
  PENDING: 'pending',
  /** Briefly, while the approval is creating the member. */
  APPROVING: 'approving',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REMOVED: 'removed',
};

export const PDF_JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
};

/* ── Tunables ────────────────────────────────────────────────────────────── */

export const LIMITS = {
  /** Rows per page in every paginated list endpoint. */
  PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 200,
  /** Firestore hard cap is 500 writes per transaction; stay under it. */
  MAX_TX_WRITES: 450,
  /** Max closings on one receipt before it is split into linked receipts. */
  MAX_RECEIPT_ITEMS: 400,
  /**
   * Members in one bulk collection.
   *
   * Each one is its own transaction and its own receipt, so this bounds how
   * long a single request can run — an agent's round is tens of members, not
   * thousands, and a cap that is reached is a clearer failure than a request
   * that times out halfway through writing receipts.
   */
  BULK_MEMBERS: 200,
  /** Entries per closings-index document before it shards. */
  CLOSINGS_INDEX_CHUNK: 1000,
  /**
   * Members per search-index shard.
   *
   * 500, not 1,000. Each entry now carries every field the grid renders and
   * every field you can filter on — roughly 350 bytes once Firestore's own
   * per-field overhead is counted. At 1,000 per shard a big trust would sit
   * around 400 KB, uncomfortably close to the 1 MiB document ceiling, and a
   * shard that overflows fails a write rather than degrading. 500 keeps a
   * shard near 175 KB with room to add a field later, at the cost of one extra
   * read per 500 members — 10 reads for a 5,000-member trust.
   */
  MEMBERS_INDEX_CHUNK: 500,
  /**
   * Rows one list request will return.
   *
   * 100, deliberately. The server could hand back the whole filtered set for
   * the same Firestore cost — it is already in memory — but the browser then
   * has to render and hold thousands of rows, and the response itself becomes
   * megabytes over a phone connection. A hundred rows is more than anyone
   * reads at once, and the page navigator is right there.
   */
  MAX_INDEX_PAGE: 100,
  /**
   * Rows an export may contain. Exports are files, not screens, so the row
   * cap that protects the browser does not apply — but an unbounded one does
   * not either.
   */
  MAX_EXPORT_ROWS: 20000,
  /** Firestore `in` / `array-contains-any` cap. */
  IN_QUERY_CHUNK: 30,
  /** Default per-closing contribution when nothing else is configured. */
  DEFAULT_PAY_AMOUNT: 200,
  /**
   * Closings on one notice.
   *
   * Not a technical limit — the sheet is what stops first. Past about sixty
   * rows the table runs onto a third page and stops being something anybody
   * reads at the counter.
   */
  MAX_BATCH_CLOSINGS: 60,
  /**
   * Days after a closing within which its instalment counts as paid on time,
   * when the closing is not on a notice that names its own last date. A योजना
   * can override it with `paymentGraceDays`. Used only to label payments in
   * the member app (समय पर / देर से) — it never changes what anyone owes.
   */
  PAYMENT_GRACE_DAYS: 30,
};

export const CACHE = {
  CLOSINGS_INDEX_TAG: 'closings-index',
  MEMBERS_INDEX_TAG: 'members-index',
  STATS_TAG: 'stats',
  BRANDING_TAG: 'branding',
};

export const SESSION_COOKIE = 'trust_session';
/** 5 days, in ms — Firebase session cookies max out at 14 days. */
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
