/**
 * Typed errors — the one shared, framework-free piece of HTTP plumbing.
 *
 * Deliberately separate from `http.js`, which also imports `next/server`.
 * Scripts that run under plain Node (`scripts/create-owner.js`) pull these
 * constructors in through the domain layer and can never resolve `next/server`
 * the way the Next.js bundler can — so nothing a script touches may import it.
 * Error types carry no framework dependency, so they live here.
 */

export class AppError extends Error {
  constructor(message, { status = 400, code = 'bad_request', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (m, details) =>
  new AppError(m, { status: 400, code: 'bad_request', details });
export const unauthorized = (m = 'Not signed in') =>
  new AppError(m, { status: 401, code: 'unauthorized' });
export const forbidden = (m = 'Not allowed') =>
  new AppError(m, { status: 403, code: 'forbidden' });
export const notFound = (m = 'Not found') =>
  new AppError(m, { status: 404, code: 'not_found' });
export const conflict = (m, details) =>
  new AppError(m, { status: 409, code: 'conflict', details });
export const tooLarge = (m) =>
  new AppError(m, { status: 413, code: 'too_large' });