import { paymentMethodLabel, paymentStatusLabel } from '../../config/labels.js';
import { csvFile } from './csv.js';

/**
 * The receipt register as a file.
 *
 * No `server-only` here on purpose: this is pure string work with no database
 * and no secrets, and keeping it importable by a plain `node --test` is what
 * makes the CSV rules in `csv.js` testable at all.
 *
 * Kept separate from the route so the column list is one thing in one place —
 * the grid, the CSV and the printed register show the same columns in the same
 * order, and adding one means editing a single array rather than hoping three
 * files stay in step.
 */

/**
 * What goes in the file, in order.
 *
 * More columns than the grid shows on purpose: the screen is for scanning and
 * a file is for working with elsewhere, so the father's name, the village, the
 * reference and the note belong in it even though they would crowd the grid.
 * Every column is labelled in Hindi because the file is opened by the same
 * office that reads the printed register.
 */
export const PAYMENT_EXPORT_COLUMNS = [
  { key: 'receiptNo', header: 'रसीद नं.' },
  { key: 'paidDate', header: 'तिथि', value: (r) => isoDate(r.paidAtMs) },
  { key: 'memberName', header: 'सदस्य', value: (r) => r.memberSnapshot?.name },
  { key: 'regNo', header: 'रजि. नं.', value: (r) => r.memberSnapshot?.regNo },
  { key: 'fatherName', header: 'पिता का नाम', value: (r) => r.memberSnapshot?.fatherName },
  { key: 'village', header: 'गाँव', value: (r) => r.memberSnapshot?.village },
  { key: 'agent', header: 'एजेंट', value: (r) => r.collectedByAgentName },
  { key: 'method', header: 'तरीका', value: (r) => paymentMethodLabel(r.method) },
  { key: 'reference', header: 'संदर्भ' },
  { key: 'itemCount', header: 'क्लोजिंग' },
  { key: 'closingAmount', header: 'क्लोजिंग राशि', numeric: true },
  { key: 'joinFeeAmount', header: 'नामांकन शुल्क', numeric: true },
  { key: 'totalAmount', header: 'कुल राशि', numeric: true },
  { key: 'status', header: 'स्थिति', value: (r) => paymentStatusLabel(r.status) },
  { key: 'groupCode', header: 'समूह' },
  { key: 'note', header: 'टिप्पणी' },
];

/**
 * One cell.
 *
 * `value` is for columns that are not a field at all but a label or a date —
 * computed here rather than written onto every receipt, so there is no second
 * copy of "how is a payment method said aloud" to drift out of step with the
 * one the screen uses.
 */
export function cellValue(receipt, col) {
  if (col.value) return col.value(receipt);
  const raw = receipt[col.key];
  return col.map ? col.map(raw) : (raw ?? '');
}

/**
 * The whole file, in the register's own order — newest first, because that is
 * the order the operator was reading before they asked for it.
 *
 * No totals row, deliberately: a summary line at the bottom of a CSV is a row
 * that every pivot table and every import then has to be told to ignore. The
 * totals belong on the PDF, where they are meant to be read rather than
 * processed.
 */
export function toCsv(payments) {
  return csvFile(
    PAYMENT_EXPORT_COLUMNS.map((c) => c.header),
    payments.map((r) => PAYMENT_EXPORT_COLUMNS.map((c) => cellValue(r, c))),
  );
}

function isoDate(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}
