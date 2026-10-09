import { notFound } from '../errors.js';

/**
 * Refuse to act on a member who belongs to a different योजना.
 *
 * Flattening members into one collection per trust made every member reachable
 * by id alone, which is exactly what makes cross-program search possible — and
 * exactly what makes this check necessary. A member's obligations are derived
 * against THEIR program's closings; running that derivation against another
 * program's closing list would not error, it would quietly produce a wrong
 * number and then take a payment against it.
 *
 * `notFound`, not `forbidden`: whether a member exists in a program the caller
 * is not looking at is not information worth handing out, and "not in this
 * योजना" is the honest description either way.
 */
export function assertSameProgram(member, programId, what = 'सदस्य') {
  if (!member) throw notFound(`${what} नहीं मिला`);
  if (!programId || !member.programId) return;
  if (member.programId !== programId) {
    throw notFound(`${what} इस योजना में नहीं है`);
  }
}
