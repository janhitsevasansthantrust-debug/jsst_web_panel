/**
 * Turning rows into a file — the CSV rules, in one place.
 *
 * No `server-only` here on purpose, for the same reason `exportMembers.js`
 * does not carry it: this is pure string work with no database and no
 * secrets, and keeping it importable by a plain `node --test` is the only
 * reason the two rules below are testable at all.
 *
 * One module, because there is exactly one correct answer to "how is a cell
 * written" and two answers means one of them is wrong. The member list and the
 * receipt register must never disagree about whether a name beginning with `=`
 * is safe to open in Excel — or, worse, about whether a note containing a
 * comma is one column or two.
 */

/**
 * UTF-8 byte-order mark.
 *
 * Excel on Windows reads a CSV without one as the system code page, so every
 * Hindi name in it opens as mojibake. Both of the files this module produces
 * are mostly Hindi names. Three bytes are the difference between a usable file
 * and a support call.
 */
export const CSV_BOM = '﻿';

/**
 * Quote one field.
 *
 * The leading apostrophe on a value starting with `= + - @` (or a tab or a
 * carriage return) is deliberate: without it a spreadsheet treats the cell as a
 * formula, and a member whose name or note begins with one of those characters
 * is otherwise a CSV injection waiting to run in whoever opens the file.
 */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row of cells, comma-joined and individually quoted. */
export const csvRow = (cells) => cells.map(csvCell).join(',');

/**
 * The whole file: header row, one row per record, CRLF between them.
 *
 * CRLF rather than LF because that is what a CSV reader written for Windows
 * expects, and these files' destination is Excel on somebody's office machine.
 */
export function csvFile(headers, rows) {
  const lines = [csvRow(headers)];
  for (const row of rows) lines.push(csvRow(row));

  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}
