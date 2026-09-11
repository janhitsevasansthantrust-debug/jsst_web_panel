import dayjs from 'dayjs';

/**
 * Age-group matching — the rule that decides a member's rates.
 *
 * A program defines age bands:
 *
 *   ageGroups: [
 *     { id, startAge: 0,  endAge: 18, joinFee: 500,  payAmount: 100 },
 *     { id, startAge: 18, endAge: 45, joinFee: 1100, payAmount: 200 },
 *   ]
 *
 * The member's age is measured in FRACTIONAL years, from date of birth to
 * their joining date — not to today. That matters: a member's rate is fixed by
 * how old they were when they joined, and must not silently change on their
 * next birthday.
 *
 * Bands are half-open: `startAge <= age < endAge`. So 18.0 falls in the second
 * band above, not the first, and there is never an overlap or a gap at the
 * boundary.
 *
 * Shared deliberately: the form uses it to show the rate as you type, and the
 * server uses the SAME function to decide what is actually stored. The browser
 * never gets to choose a member's contribution amount.
 */

/** Fractional years between two dates — matches the old system's `getDecimalAge`. */
export function decimalAge(dobMs, joinMs) {
  if (!dobMs || !joinMs) return null;
  const age = dayjs(joinMs).diff(dayjs(dobMs), 'year', true);
  return Number.isFinite(age) ? age : null;
}

/**
 * The band a member falls into, or null if their age fits no band.
 * Returning null is meaningful: the program simply does not cover that age,
 * and the member must not be created with a silent rate of zero.
 */
export function matchAgeGroup(ageGroups, dobMs, joinMs) {
  const age = decimalAge(dobMs, joinMs);
  if (age == null || !Array.isArray(ageGroups)) return null;

  const match = ageGroups.find(
    (g) => age >= Number(g.startAge) && age < Number(g.endAge),
  );

  if (!match) return null;

  return {
    ...match,
    age,
    ageYears: Math.floor(age),
    range: `${match.startAge}-${match.endAge}`,
  };
}

/** Human-readable summary used in form hints and error messages. */
export function describeAgeGroups(ageGroups) {
  if (!ageGroups?.length) return 'कोई आयु समूह नहीं';
  return ageGroups
    .map((g) => `${g.startAge}–${g.endAge} वर्ष: ₹${g.payAmount}`)
    .join(' · ');
}

/**
 * Bands must not overlap or leave a hole, or a member's rate becomes ambiguous
 * (or zero). Validated when a program is saved rather than discovered later
 * when someone cannot be added.
 */
export function validateAgeGroups(ageGroups) {
  const problems = [];
  if (!ageGroups?.length) return problems;

  const sorted = [...ageGroups].sort((a, b) => a.startAge - b.startAge);

  for (const g of sorted) {
    if (Number(g.endAge) <= Number(g.startAge)) {
      problems.push(
        `आयु समूह ${g.startAge}-${g.endAge}: अंतिम आयु शुरुआती से बड़ी होनी चाहिए`,
      );
    }
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (Number(cur.startAge) < Number(prev.endAge)) {
      problems.push(
        `आयु समूह ${prev.startAge}-${prev.endAge} और ${cur.startAge}-${cur.endAge} आपस में टकराते हैं`,
      );
    }
  }

  return problems;
}
