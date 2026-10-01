/**
 * The shape of one member inside the search index.
 *
 * Pure mapping, deliberately kept out of `indexes.js`: that file talks to
 * Firestore and carries `server-only`, which makes everything in it
 * unreachable from a plain `node --test`. These two functions are the contract
 * between the stored index and every screen that reads it — exactly the part
 * worth testing directly.
 */

/**
 * Every field the member index carries.
 *
 * This list is the contract between the grid, the filter bar and Firestore: if
 * a column is shown or a filter is offered, the field must be here, because
 * nothing downstream reads the member documents themselves. Adding one costs
 * a `reindex`; forgetting one shows a blank column that looks like missing
 * data rather than a missing field.
 */
export const MEMBER_INDEX_FIELDS = [
  'registrationNumber', 'displayName', 'fatherName', 'phone', 'phoneAlt',
  'aadhaarNo', 'village', 'district', 'state', 'gender', 'jati',
  'ageGroupRange', 'age', 'status', 'agentId', 'agentName', 'programId',
  'programName', 'joinDateMs', 'bobDateMs', 'payAmount', 'joinFees',
  'joinFeesDone', 'joinFeesPaid', 'joinFeesDue',
  'dueCount', 'dueAmount', 'paidCount', 'paidAmount',
  'lastPaymentAt', 'photoURL', 'delete_flag',
];

/**
 * One member, squeezed into the index.
 *
 * Keys are short on purpose. Firestore stores the field name inside every
 * element of an array of maps, so a 5,000-member index pays for the word
 * "registrationNumber" 5,000 times. Two-letter keys turn roughly 900 bytes an
 * entry into roughly 350, which is the difference between 10 shards and 25.
 */
export function toMemberEntry(id, m) {
  return {
    id,
    reg: m.registrationNumber ?? '',
    name: m.displayName ?? '',
    father: m.fatherName ?? '',
    phone: m.phone ?? '',
    ph2: m.phoneAlt ?? '',
    aadhaar: m.aadhaarNo ?? '',
    village: m.village ?? '',
    dist: m.district ?? '',
    gen: m.gender ?? '',
    jati: m.jati ?? '',
    ageBand: m.ageGroupRange ?? '',
    age: m.age ?? null,
    status: m.status ?? '',
    agentId: m.agentId ?? null,
    agent: m.agentName ?? '',
    pid: m.programId ?? '',
    prog: m.programName ?? '',
    joinMs: m.joinDateMs ?? null,
    dobMs: m.bobDateMs ?? null,
    pay: m.payAmount ?? 0,
    fee: m.joinFees ?? 0,
    feeDone: Boolean(m.joinFeesDone),
    /**
     * How much of the fee has arrived, and how much has not.
     *
     * `feeDone` alone cannot answer "who still owes part of their joining
     * fee", which is the whole question the bulk-collection screen is built
     * around. Members enrolled before the amount was tracked have neither
     * field, so the old boolean fills them in: paid means all of it.
     */
    feePaid: m.joinFeesPaid ?? (m.joinFeesDone ? (m.joinFees ?? 0) : 0),
    feeDue: m.joinFeesDue ?? (m.joinFeesDone ? 0 : (m.joinFees ?? 0)),
    dueC: m.dueCount ?? 0,
    due: m.dueAmount ?? 0,
    paidC: m.paidCount ?? 0,
    paid: m.paidAmount ?? 0,
    lastPay: m.lastPaymentAt ?? null,
    photo: m.photoURL ?? '',
  };
}

/**
 * Expand an index entry back into the shape the grid expects.
 *
 * The browser should not have to know that the index uses short keys — that is
 * a storage decision, and leaking it would tie every component to it.
 */
export function fromMemberEntry(e) {
  return {
    id: e.id,
    registrationNumber: e.reg,
    displayName: e.name,
    fatherName: e.father,
    phone: e.phone,
    phoneAlt: e.ph2,
    aadhaarNo: e.aadhaar,
    village: e.village,
    district: e.dist,
    gender: e.gen,
    jati: e.jati,
    ageGroupRange: e.ageBand,
    age: e.age,
    status: e.status,
    agentId: e.agentId,
    agentName: e.agent,
    programId: e.pid,
    programName: e.prog,
    joinDateMs: e.joinMs,
    bobDateMs: e.dobMs,
    payAmount: e.pay,
    joinFees: e.fee,
    joinFeesDone: e.feeDone,
    joinFeesPaid: e.feePaid ?? (e.feeDone ? e.fee : 0),
    joinFeesDue: e.feeDue ?? (e.feeDone ? 0 : e.fee),
    dueCount: e.dueC,
    dueAmount: e.due,
    paidCount: e.paidC,
    paidAmount: e.paid,
    lastPaymentAt: e.lastPay,
    photoURL: e.photo,
  };
}
