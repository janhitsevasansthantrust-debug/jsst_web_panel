import 'server-only';

import { NextResponse } from 'next/server';

/**
 * Uniform HTTP plumbing for every route handler.
 *
 * The old project repeated the same 15 lines of token parsing, try/catch and
 * error shaping in every one of its 20 route files, with slightly different
 * behaviour in each. Everything lives here instead.
 */

/* ── Typed errors ────────────────────────────────────────────────────────── */

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

/* ── Responses ───────────────────────────────────────────────────────────── */

export function ok(data, init = {}) {
  return NextResponse.json({ ok: true, ...data }, init);
}

/**
 * Cacheable GET response. Use only for data that is safe to serve slightly
 * stale — the closings index, branding, static lists.
 */
export function okCached(data, seconds = 60, init = {}) {
  return NextResponse.json(
    { ok: true, ...data },
    {
      ...init,
      headers: {
        'Cache-Control': `private, max-age=${seconds}, stale-while-revalidate=${seconds * 5}`,
        ...(init.headers ?? {}),
      },
    },
  );
}

export function fail(error) {
  const isApp = error instanceof AppError;
  const status = isApp ? error.status : 500;

  if (!isApp) {
    // Never leak an internal stack trace to the browser.
    console.error('[api] unhandled', error);
  }

  return NextResponse.json(
    {
      ok: false,
      error: isApp ? error.message : 'Something went wrong on the server',
      code: isApp ? error.code : 'internal_error',
      ...(isApp && error.details ? { details: error.details } : {}),
    },
    { status },
  );
}

/**
 * Wrap a route handler so it can just `throw` and get a correct response.
 *
 *   export const GET = handler(async (req, ctx) => { ... return ok({...}) })
 */
export function handler(fn) {
  return async function wrapped(request, context) {
    const started = Date.now();
    try {
      const response = await fn(request, context);
      logRequest(request, response?.status ?? 200, started);
      return response;
    } catch (error) {
      const response = fail(error);
      logRequest(request, response.status, started, error);
      return response;
    }
  };
}

function logRequest(request, status, started, error) {
  const ms = Date.now() - started;
  const method = request?.method ?? '?';
  let path = '?';
  try {
    path = new URL(request.url).pathname;
  } catch {
    /* ignore */
  }
  const tail = error ? ` — ${error.message}` : '';
  console.log(`[api] ${method} ${path} → ${status} in ${ms}ms${tail}`);
}

/* ── Input parsing ───────────────────────────────────────────────────────── */

/** Parse and validate a JSON body with a zod schema. */
export async function readBody(request, schema) {
  let raw;
  try {
    raw = await request.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
  if (!schema) return raw;

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest('Invalid request body', flattenZod(parsed.error));
  }
  return parsed.data;
}

/** Parse and validate the query string with a zod schema. */
export function readQuery(request, schema) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  if (!schema) return params;

  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw badRequest('Invalid query parameters', flattenZod(parsed.error));
  }
  return parsed.data;
}

function flattenZod(error) {
  const out = {};
  for (const issue of error.issues ?? []) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/* ── Pagination ──────────────────────────────────────────────────────────── */

/** Encode a Firestore cursor so it can travel in a URL. */
export const encodeCursor = (values) =>
  Buffer.from(JSON.stringify(values)).toString('base64url');

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    throw badRequest('Invalid pagination cursor');
  }
}
