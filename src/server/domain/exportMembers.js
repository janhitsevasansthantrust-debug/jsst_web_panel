import { statusLabelFor } from '../../config/labels.js';
import { csvFile } from './csv.js';

/**
 * Turning the member list into a file.
 *
 * No `server-only` here on purpose: this is pure string work with no secrets
 * and no database, and keeping it importable by a plain `node --test` is what
 * makes the CSV-injection and BOM behaviour below testable at all.
 *
 * Kept separate from the route so the column list is one thing in one place —
 * CSV and PDF show the same columns in the same order, and adding one means
 * editing a single array rather than hoping two files stay in step.
 */

/**
 * What goes in an export, in order.
 *
 * More columns than the grid shows on purpose: the screen is for scanning and
 * a file is for working with elsewhere, so the phone number, the address and
 * the Aadhaar belong in it even though they would crowd the grid.
 */
export const EXPORT_COLUMNS = [
  { key: 'registrationNumber', header: 'रजि. नं.', width: 8 },
  { key: 'displayName', header: 'नाम', width: 20 },
  { key: 'fatherName', header: 'पिता का नाम', width: 18 },
  { key: 'gender', header: 'लिंग', width: 7, map: (v) => GENDER[String(v).toLowerCase()] ?? v ?? '' },
  { key: 'age', header: 'उम्र', width: 6 },
  { key: 'ageGroupRange', header: 'आयु समूह', width: 10 },
  { key: 'phone', header: 'मोबाइल', width: 12 },
  { key: 'village', header: 'गाँव', width: 14 },
  { key: 'district', header: 'ज़िला', width: 12 },
  { key: 'status', header: 'स्थिति', width: 9, map: statusLabelFor },
  { key: 'programName', header: 'योजना', width: 14 },
  { key: 'agentName', header: 'एजेंट', width: 14 },
  { key: 'joinDateMs', header: 'जुड़ने की तिथि', width: 12, map: isoDate },
  { key: 'payAmount', header: 'प्रति क्लोजिंग', width: 10, numeric: true },
  { key: 'dueCount', header: 'बकाया क्लोजिंग', width: 10, numeric: true },
  { key: 'dueAmount', header: 'बकाया राशि', width: 11, numeric: true },
  /**
   * `paidAmount` counts closings and nothing else — that is what the ledger
   * moves. It is NOT what the member has paid in total, and labelling it
   * "जमा राशि" said it was: a member who handed over ₹2,100 of their joining
   * fee and owed no closing read as having paid zero.
   */
  { key: 'paidAmount', header: 'क्लोजिंग जमा', width: 11, numeric: true },
  { key: 'joinFees', header: 'नामांकन शुल्क', width: 10, numeric: true },
  /**
   * Paid and outstanding, not just a yes/no.
   *
   * "फीस जमा: नहीं" is the same answer for a member who has paid nothing and
   * one who has ₹400 left of ₹11,000, and those are not the same member. The
   * whole point of a file is that somebody works out who to chase from it.
   */
  { key: 'joinFeesPaid', header: 'शुल्क जमा', width: 11, numeric: true },
  { key: 'joinFeesDue', header: 'शुल्क बाकी', width: 10, numeric: true },
  { key: 'joinFeesDone', header: 'शुल्क पूरा', width: 8, map: (v) => (v ? 'हाँ' : 'नहीं') },
  /** Everything this member has actually handed over: closings plus fee. */
  {
    key: 'totalPaid',
    header: 'कुल जमा',
    width: 11,
    numeric: true,
    value: (m) => round2((Number(m.paidAmount) || 0) + (Number(m.joinFeesPaid) || 0)),
  },
  { key: 'aadhaarNo', header: 'आधार नंबर', width: 14 },
];

const GENDER = { male: 'पुरुष', female: 'महिला', other: 'अन्य' };

function isoDate(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * One cell.
 *
 * `value` is for columns that are not a field at all but a sum of two —
 * computed here rather than written onto every member, so there is no third
 * number to drift out of step with the two it came from.
 */
export function cellValue(member, col) {
  if (col.value) return col.value(member);
  const raw = member[col.key];
  return col.map ? col.map(raw) : (raw ?? '');
}

/**
 * CSV, with a UTF-8 BOM.
 *
 * The BOM itself lives in `csv.js` beside the quoting rules, because it is the
 * same sort of rule: Excel on Windows reads a CSV as the system code page
 * unless the file starts with one, so without it every Hindi name in this file
 * opens as mojibake — and this list is mostly Hindi names. Three bytes are the
 * difference between a usable file and a support call.
 */
export function toCsv(members) {
  return csvFile(
    EXPORT_COLUMNS.map((c) => c.header),
    members.map((m) => EXPORT_COLUMNS.map((c) => cellValue(m, c))),
  );
}

