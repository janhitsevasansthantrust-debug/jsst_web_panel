import { badRequest } from '../http.js';
import { db } from '../firebase/admin.js';
import { paths, LIMITS } from '../../config/constants.js';
import { getClosingsIndex } from './indexes.js';
import { selectClosings } from '../../lib/closingSelection.js';
import { matchesPayment } from '../../lib/paymentReport.js';

/**
 * Reading the receipt register.
 *
 * One module for both readers — the paginated screen and the report that walks
 * the whole filtered set — because they are two views of one question and a
 * filter written twice is a filter that drifts. When the screen shows thirty
 * rows and the file somebody downloads shows thirty-two, neither number can be
 * used in an argument afterwards.
 *
 * ## What goes into Firestore and what happens here
 *
 * A date range and an agent are pushed into the query, because the indexes
 * that serve the register already carry them (`delete_flag`, `paidAtMs` and
 * `collectedByAgentId`) — so a period costs the reads of that period and no
 * more, and the cursor still walks the right stretch of the collection.
 *
 * A payment method, a status and a free-text search are NOT, and deliberately
 * so. Firestore needs one composite index per *combination* of equality
 * filters, so every extra dropdown would be another index, another deploy-time
 * failure waiting to happen, and another entry in `firestore.indexes.json`
 * that quietly gets removed by the next deploy if it is forgotten there. Five
 * filters would be a combinatorial mess of indexes for a collection measured
 * in thousands of documents.
 *
 * Those three are applied in memory instead, with a bounded walk: keep reading
 * pages until this page is full, the collection is exhausted, or the walk
 * reaches its cap. The cap is what keeps a very selective filter — "only
 * cancelled", which might be one receipt in five hundred — from reading the
 * whole collection to fill a screen of fifty.
 */

/** How many Firestore pages one screenful may read before it gives up. */
const MAX_PAGE_PASSES = 10;

/** Rows read per pass while filling a page. */
const SCAN_PAGE = LIMITS.PAGE_SIZE;

/**
 * A report may not walk the collection forever.
 *
 * A receipt exists only when money moved, so this is a generous ceiling —
 * far more than the "few thousand documents at most" the register is built
 * for. Hitting it means the period is wrong rather than the trust is big.
 */
const MAX_SCAN = 60_000;

/** Rows one printed register page may carry. */
export const MAX_PDF_ROWS = 2_000;

/**
 * The query both readers start from.
 *
 * Ordered by date AND document id, and the second half is not decoration.
 *
 * A bulk deposit stamps the same `paidAtMs` on all forty receipts it creates —
 * they were handed over together. With only `paidAtMs` to sort on, those forty
 * are tied, and a cursor made of the timestamp alone skips straight over the
 * rest of them: page 2 quietly begins at the next deposit, and thirty-nine
 * receipts never appear in the register at all.
 *
 * The cursor is a document, not a number, for the same reason. Firestore builds
 * a cursor from the query's own orderBy fields, so both are needed for "start
 * after this exact receipt".
 */
function paymentsQuery(scope, filters) {
  let query = db
    .collection(paths.payments(scope.trustId, scope.programId))
    .where('delete_flag', '==', false);

  if (filters.memberId) query = query.where('memberId', '==', filters.memberId);
  if (filters.agentId) query = query.where('collectedByAgentId', '==', filters.agentId);

  // Range filters belong on the field being ordered by — which is exactly what
  // `paidAtMs` is, so this rides the register's existing index rather than
  // asking for a new one.
  if (filters.paidFromMs) query = query.where('paidAtMs', '>=', Number(filters.paidFromMs));
  if (filters.paidToMs) query = query.where('paidAtMs', '<=', Number(filters.paidToMs));

  return query.orderBy('paidAtMs', 'desc').orderBy('__name__', 'desc');
}

/**
 * The seqs the closing filters picked, or `null` when none is on.
 *
 * Read from the closings index rather than from the receipts because that is
 * where "which closings are on this batch" is decided — restating it from the
 * receipts would be a second opinion about the same fact.
 */
async function closingSeqs(scope, filters) {
  const wanted = filters.closingId || filters.batchId || filters.fromMs || filters.toMs;
  if (!wanted) return null;

  const { items } = await getClosingsIndex(scope.trustId, scope.programId);
  return new Set(selectClosings(items, filters).map((c) => c.seq));
}

/**
 * One page for the screen.
 *
 * The in-memory half of the filter can make a Firestore page come back short,
 * so this walks on until the page is full. Bounded by `MAX_PAGE_PASSES`, which
 * is the honest trade: a screen that says "load more" and means it, for at most
 * ten reads of the collection's own page size.
 */
export async function listPaymentsPage(scope, filters, limit) {
  const seqs = await closingSeqs(scope, filters);
  const base = paymentsQuery(scope, filters);

  let query = base;
  if (filters.cursor) {
    const doc = await db
      .doc(paths.payment(scope.trustId, scope.programId, filters.cursor))
      .get();
    if (!doc.exists) throw badRequest('रिपोर्ट फिर से लोड करें');
    query = base.startAfter(doc);
  }

  const rows = [];
  let last = null;
  let exhausted = false;

  for (let pass = 0; pass < MAX_PAGE_PASSES && rows.length < limit; pass += 1) {
    const snap = await query.limit(limit).get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const receipt = { id: doc.id, ...doc.data() };
      if (matchesPayment(receipt, filters, seqs)) rows.push(receipt);
    }

    last = snap.docs.at(-1);
    if (snap.size < limit) {
      exhausted = true;
      break;
    }
    query = base.startAfter(last);
  }

  return {
    payments: rows.slice(0, limit),
    nextCursor: exhausted ? null : (last?.id ?? null),
  };
}

/**
 * Every receipt the filter matches, newest first.
 *
 * This is the whole set — the totals on screen, the CSV and the printed
 * register all come from this one array, so three documents cannot report three
 * different sums for the same period. It is deliberately NOT capped at a row
 * count: a total over part of the data is not a smaller total, it is a wrong
 * one. The ceiling is the read guard below, which refuses rather than quietly
 * leaving rows out.
 */
export async function scanPayments(scope, filters) {
  const seqs = await closingSeqs(scope, filters);
  const base = paymentsQuery(scope, filters);

  const rows = [];
  let query = base;
  let scanned = 0;

  for (;;) {
    const snap = await query.limit(SCAN_PAGE).get();
    scanned += snap.size;
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const receipt = { id: doc.id, ...doc.data() };
      if (matchesPayment(receipt, filters, seqs)) rows.push(receipt);
    }

    if (scanned > MAX_SCAN) {
      throw badRequest(
        `इस फ़िल्टर पर ${scanned} से ज़्यादा रसीदें हैं — रिपोर्ट इतनी पढ़ नहीं सकती। तारीख़ की अवधि छोटी करें।`,
      );
    }

    if (snap.size < SCAN_PAGE) break;
    query = base.startAfter(snap.docs.at(-1));
  }

  return { rows, scanned };
}
