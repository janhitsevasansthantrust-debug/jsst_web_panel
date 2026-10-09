/** Reconcile the new inclusive closing-date rule against immutable receipts.
 * Usage: npm run repair:closings -- --trust=ID [--program=ID] [--apply]
 * Default is a read-only report; no receipts are changed or deleted.
 */
import { db, serverNow } from '../src/server/firebase/admin.js';
import { paths } from '../src/config/constants.js';
import { rebuildLedger } from '../src/server/domain/ledger.js';
import { getClosingsIndex, rebuildMembersIndex } from '../src/server/domain/indexes.js';

const args = process.argv.slice(2);
const trustId = args.find((a) => a.startsWith('--trust='))?.slice(8) || process.env.TRUST_ID;
const programId = args.find((a) => a.startsWith('--program='))?.slice(10);
const apply = args.includes('--apply');
if (!trustId) throw new Error('--trust=ID ज़रूरी है');
let query = db.collection(paths.members(trustId)).where('delete_flag', '==', false);
if (programId) query = query.where('programId', '==', programId);
const members = await query.get();
let changed = 0;
let skipped = 0;
for (const doc of members.docs) {
  const pid = doc.data().programId;
  if (!pid) continue;
  const { items: closings } = await getClosingsIndex(trustId, pid);
  const reconcile = async (tx) => {
    const ref = db.collection(paths.payments(trustId, pid)).where('memberId', '==', doc.id);
    const [memberSnap, payments] = tx
      ? await Promise.all([tx.get(doc.ref), tx.get(ref)])
      : await Promise.all([doc.ref.get(), ref.get()]);
    const member = { id: doc.id, ...memberSnap.data() };
    const receipts = payments.docs.map((p) => p.data());
    // Imported balances without receipt history cannot safely be reconstructed.
    if (!receipts.length && Number(member.paidAmount) > 0) return { skipped: true, id: doc.id };
    const rebuilt = rebuildLedger(member, closings, receipts);
    const fields = { ...rebuilt.ledger, ...rebuilt.counters };
    const differs = Object.entries(fields).some(([key, value]) =>
      JSON.stringify(member[key]) !== JSON.stringify(value));
    if (differs && tx) {
      const auditRef = db.collection(paths.auditLogs(trustId, pid)).doc();
      tx.update(doc.ref, { ...fields, updatedAt: serverNow(), updatedBy: 'repair-closing-ledgers' });
      tx.set(auditRef, { action: 'member.ledger.reconcile', memberId: doc.id,
        before: Object.fromEntries(Object.keys(fields).map((key) => [key, member[key] ?? null])),
        after: fields, at: serverNow() });
    }
    return { id: doc.id, changed: differs, dueBefore: member.dueAmount ?? 0, dueAfter: fields.dueAmount };
  };
  const result = apply ? await db.runTransaction(reconcile) : await reconcile(null);
  if (result.skipped) skipped += 1;
  if (result.changed) changed += 1;
  if (result.skipped || result.changed) console.log(JSON.stringify(result));
}
if (apply) await rebuildMembersIndex(trustId);
console.log(JSON.stringify({ mode: apply ? 'applied' : 'report-only', checked: members.size, changed, skipped }));
