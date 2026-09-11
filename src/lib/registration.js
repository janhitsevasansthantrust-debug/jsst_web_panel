/**
 * How a member's registration number is made.
 *
 * In `lib/` rather than `server/domain/` because both sides need it: the
 * server issues the numbers, and the program form previews them as you type.
 * Same reason `ageGroup.js` lives here.
 *
 * A trust's registration numbers are not an implementation detail — they are
 * printed on every receipt, read out over the phone and written in ledgers by
 * hand. So the shape is the trust's decision, not ours: a prefix, where to
 * start counting, how much to zero-pad, or random digits entirely.
 *
 * Pure functions on plain values, so the whole thing is testable without a
 * database — which matters, because a bug here is not a wrong pixel, it is two
 * members sharing a number.
 */

export const REGISTRATION_MODE = {
  /** 1001, 1002, 1003 — counts up from a chosen start. */
  SEQUENTIAL: 'sequential',
  /** RJ-482913 — random digits, checked for a clash before use. */
  RANDOM: 'random',
};

export const DEFAULT_REGISTRATION = {
  mode: REGISTRATION_MODE.SEQUENTIAL,
  prefix: '',
  suffix: '',
  startFrom: 1001,
  /** Zero-pad the number to this width. 0 means "do not pad". */
  padding: 0,
  /** Digits in a random number. */
  randomLength: 6,
};

export function resolveRegistrationConfig(program) {
  const c = program?.registration ?? {};
  const mode =
    c.mode === REGISTRATION_MODE.RANDOM
      ? REGISTRATION_MODE.RANDOM
      : REGISTRATION_MODE.SEQUENTIAL;

  return {
    mode,
    prefix: String(c.prefix ?? '').trim(),
    suffix: String(c.suffix ?? '').trim(),
    startFrom: clampInt(c.startFrom, 1, 1_000_000_000, DEFAULT_REGISTRATION.startFrom),
    padding: clampInt(c.padding, 0, 12, 0),
    randomLength: clampInt(c.randomLength, 4, 12, DEFAULT_REGISTRATION.randomLength),
  };
}

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** `1001` with `{prefix:'RJ-', padding:6}` → `RJ-001001`. */
export function formatRegistration(config, number) {
  const digits = String(Math.trunc(Number(number) || 0));
  const padded = config.padding > 0 ? digits.padStart(config.padding, '0') : digits;
  return `${config.prefix}${padded}${config.suffix}`;
}

/**
 * The next sequential number, given what the counter currently holds.
 *
 * The counter stores the last number ISSUED, so the first member of a program
 * configured to start at 1001 needs the counter seeded to 1000. A counter that
 * has fallen behind `startFrom` — because the setting was raised later — jumps
 * forward rather than re-issuing numbers that are already on receipts.
 */
export function nextSequential(config, counterValue) {
  const current = Number(counterValue);
  const last = Number.isFinite(current) ? current : config.startFrom - 1;
  return Math.max(last + 1, config.startFrom);
}

/**
 * A random registration number.
 *
 * The first digit is never zero: a number that renders as `048213` in one
 * place and `48213` in another is the same number to a spreadsheet and a
 * different one to a person reading a receipt.
 */
export function randomRegistrationNumber(config, random = Math.random) {
  const length = config.randomLength;
  let digits = String(1 + Math.floor(random() * 9));
  for (let i = 1; i < length; i += 1) {
    digits += String(Math.floor(random() * 10));
  }
  return `${config.prefix}${digits}${config.suffix}`;
}

/** What the next number would look like — for the preview on the program form. */
export function previewRegistration(config, count = 3) {
  const resolved = resolveRegistrationConfig({ registration: config });

  if (resolved.mode === REGISTRATION_MODE.RANDOM) {
    return Array.from({ length: count }, () => randomRegistrationNumber(resolved));
  }

  return Array.from({ length: count }, (_, i) =>
    formatRegistration(resolved, resolved.startFrom + i),
  );
}
