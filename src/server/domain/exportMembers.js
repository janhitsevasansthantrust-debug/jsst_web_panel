import { statusLabelFor } from '../../config/labels.js';

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
  { key: 'paidAmount', header: 'जमा राशि', width: 11, numeric: true },
  { key: 'joinFees', header: 'जॉइनिंग फीस', width: 10, numeric: true },
  { key: 'joinFeesDone', header: 'फीस जमा', width: 8, map: (v) => (v ? 'हाँ' : 'नहीं') },
  { key: 'aadhaarNo', header: 'आधार नंबर', width: 14 },
];

const GENDER = { male: 'पुरुष', female: 'महिला', other: 'अन्य' };

function isoDate(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function cellValue(member, col) {
  const raw = member[col.key];
  return col.map ? col.map(raw) : (raw ?? '');
}

/**
 * CSV, with a UTF-8 BOM.
 *
 * The BOM is not decoration. Excel on Windows reads a CSV as the system code
 * page unless the file starts with one, so without it every Hindi name in this
 * file opens as mojibake — and this list is mostly Hindi names. Three bytes
 * are the difference between a usable file and a support call.
 */
export function toCsv(members) {
  const lines = [EXPORT_COLUMNS.map((c) => csvCell(c.header)).join(',')];

  for (const m of members) {
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(cellValue(m, c))).join(','));
  }

  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * Quote a CSV field.
 *
 * The leading apostrophe on values starting with `= + - @` is deliberate:
 * without it a spreadsheet treats the cell as a formula. A member whose name
 * or note begins with one of those characters is otherwise a CSV injection
 * waiting to run in whoever opens the file.
 */
function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
