'use client';

/**
 * The one place the browser talks to the server.
 *
 * Notice what is not here: no Firestore queries, no bearer tokens, no
 * `Authorization` header plumbing. The session cookie travels automatically
 * and every read is a bounded, server-controlled endpoint.
 */

import { getActiveProgramId, setActiveProgramId } from './activeProgram.js';

/**
 * Endpoints that must NOT carry the active programId.
 *
 * `/programs` is how the header switcher discovers which programs exist. If a
 * stale id were attached to it, the server would reject it as an unknown
 * program and the one screen that could fix the stale id would be the one that
 * could never load. Auth and setup are not program-scoped at all.
 */
const NOT_PROGRAM_SCOPED = /^\/(programs(\?|$)|auth\/|setup(\?|$)|health(\?|$)|branding(\?|$)|portal\/)/;

/**
 * Attach the active योजना to every request.
 *
 * Without this the server falls back to the `programId` claim in the session
 * cookie, which is written once at user creation and never updated — so adding
 * a member to a newly created योजना would write to one book while the list read
 * another. See `lib/activeProgram.js`.
 */
function withProgram(path) {
  const id = getActiveProgramId();
  if (!id) return path;
  if (NOT_PROGRAM_SCOPED.test(path)) return path;
  if (/[?&]programId=/.test(path)) return path; // caller was explicit — respect it

  return `${path}${path.includes('?') ? '&' : '?'}programId=${encodeURIComponent(id)}`;
}

/**
 * A full `/api/...` URL with the active योजना attached.
 *
 * `request()` gets this for free; the URL builders below do NOT, because they
 * hand a string to `window.open` or to a bare `fetch` rather than going through
 * `request()`. That gap is what made a certificate opened from a member row
 * answer "सदस्य इस योजना में नहीं है": with no `programId` in the query the
 * server fell back to the `programId` claim baked into the session cookie at
 * user-creation time, compared it against the member's real योजना, and quite
 * correctly refused. Any endpoint reached by URL rather than by `request()`
 * must be built through here.
 */
export const apiUrl = (path) => `/api${withProgram(path)}`;

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, signal, headers } = {}) {
  const response = await fetch(`/api${withProgram(path)}`, {
    method,
    signal,
    credentials: 'same-origin',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON response (a proxy error page, say) — fall through.
  }

  if (!response.ok || payload?.ok === false) {
    // A remembered program that no longer exists would otherwise poison every
    // request for good. Forget it so the next load falls back to the session
    // claim and the header switcher can pick a live one.
    if (response.status === 403 && /Unknown program/i.test(payload?.error ?? '')) {
      setActiveProgramId(null);
    }

    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, {
      status: response.status,
      code: payload?.code,
      details: payload?.details,
    });
  }

  return payload;
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
};

/**
 * Upload a member photo / document through the server (see
 * /api/uploads/member-doc) rather than straight to Storage, so it never
 * depends on Storage security rules being deployed.
 */
async function uploadMemberDoc(file, folder = 'members') {
  const body = new FormData();
  body.set('file', file, file.name || 'upload.jpg');
  body.set('folder', folder);
  const response = await fetch(apiUrl('/uploads/member-doc'), { method: 'POST', credentials: 'same-origin', body });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(payload?.error ?? `अपलोड नहीं हुआ (${response.status})`, { status: response.status, code: payload?.code });
  }
  return payload.url;
}

export const api = {
  uploads: { memberDoc: uploadMemberDoc },

  /** The phone app's switches — maintenance, update versions, support numbers. */
  push: {
    overview: () => request('/push/send'),
    send: (body) => request('/push/send', { method: 'POST', body }),
  },

  memberLogins: {
    backfill: () => request('/members/logins/backfill', { method: 'POST', body: {} }),
  },

  appConfig: {
    get: () => request('/app/config'),
    update: (body) => request('/app/config', { method: 'PATCH', body }),
    paymentPreview: (amount) => request(`/app/payment?preview=1&amount=${Number(amount) || 0}&note=TEST`),
  },

  /* auth */
  session: {
    create: (idToken) => request('/auth/session', { method: 'POST', body: { idToken } }),
    me: () => request('/auth/session'),
    destroy: () => request('/auth/session', { method: 'DELETE' }),
  },

  /* members */
  members: {
    /**
     * Filters go in the query string as a flat object; arrays become
     * comma-separated lists, which is what the server's schema expects. The
     * whole thing is answered from the search index, so twelve filters cost
     * the same as none.
     */
    /** What a new joining / birth date would do to this member's bill — nothing saved. */
    previewDates: (id, body) => request(`/members/${id}/preview-dates`, { method: 'POST', body }),
    list: (params, signal) => request(`/members${qs(params)}`, { signal }),
    search: (q, params, signal) =>
      request(`/members/search${qs({ q, ...params })}`, { signal }),
    /**
     * Counts, grouped. `groupBy: 'agent,village'` returns one block per
     * dimension. Same index as the list, so the numbers agree with the rows.
     */
    summary: (params, signal) => request(`/members/summary${qs(params)}`, { signal }),
    /**
     * The searchable list, once, so the browser can search without asking.
     * Answers `mode: 'remote'` for a trust too large to be worth downloading.
     */
    searchIndex: (params) => request(`/members/search-index${qs(params)}`),
    byPhone: (phone) => request(`/members/by-phone${qs({ phone })}`),
    /**
     * Is this आधार already on someone in this योजना? Used by the member form
     * as the number is typed, so the clash is found before the rest of the
     * form is filled in rather than on Save.
     */
    byAadhaar: (aadhaar, except) =>
      request(`/members/by-aadhaar${qs({ aadhaar, except })}`),
    get: (id) => request(`/members/${id}`),
    create: (body) => request('/members', { method: 'POST', body }),
    update: (id, body) => request(`/members/${id}`, { method: 'PATCH', body }),
    ledger: (id, params) => request(`/members/${id}/ledger${qs(params)}`),
    /**
     * The printable बकाया / जमा sheet. A URL, not a fetch — it opens in a tab
     * so the next keystroke can be print.
     */
    statementUrl: (id, mode = 'pending') =>
      apiUrl(`/members/${id}/statement?mode=${mode}`),
    /**
     * सदस्यता प्रमाण पत्र and सदस्यता फॉर्म — the two sheets the old system
     * printed per member. Same URL shape as the statement, for the same
     * reason: these go straight to a printer.
     */
    documentUrl: (id, type = 'certificate') =>
      apiUrl(`/members/${id}/document?type=${type}`),
    setStatus: (id, body) => request(`/members/${id}/status`, { method: 'POST', body }),
    /**
     * Soft delete. The server refuses once the member has any payment history —
     * a receipt that points at a member who no longer exists is not a record,
     * it is a hole. Block or mark them as left instead.
     */
    remove: (id) => request(`/members/${id}`, { method: 'DELETE' }),
  },

  /* closings */
  closings: {
    report: (params) => request(`/closings/collection${qs(params)}`),
    billsUrl: (params) => apiUrl(`/closings/bills${qs(params)}`),
    list: (params) => request(`/closings${qs(params)}`),
    create: (body) => request('/closings', { method: 'POST', body }),
    collection: (id, params) => request(`/closings/${id}/collection${qs(params)}`),
    update: (id, body) => request(`/closings/${id}`, { method: 'PATCH', body }),
    revert: (id, body) => request(`/closings/${id}/revert`, { method: 'POST', body }),
    /** सदस्यता समापन पत्र — the sheet the family signs for the payout. */
    formPdfUrl: (id) => apiUrl(`/closings/${id}/form-pdf`),
    closable: (q) => request(`/closings/closable${qs({ q })}`),
    /**
     * The क्लोजिंग सूची for a period — the office's register page, with what
     * each closing was billed at and what has come in against it.
     */
    listPdfUrl: (params) => apiUrl(`/closings/list-pdf${qs(params)}`),
  },

  /**
   * क्लोजिंग समूह — the batch a month's closings are billed on.
   *
   * Separate from `groups` below, which is the यूनिट (a member's rate card).
   * Same word in English, entirely different thing.
   */
  closingBatches: {
    list: (params) => request(`/closing-batches${qs(params)}`),
    get: (id) => request(`/closing-batches/${id}`),
    create: (body) => request('/closing-batches', { method: 'POST', body }),
    update: (id, body) => request(`/closing-batches/${id}`, { method: 'PATCH', body }),
    /** Closings not yet on this notice — including ones on another batch. */
    assignable: (id) => request(`/closing-batches/${id}/closings`),
    addClosings: (id, closingIds) =>
      request(`/closing-batches/${id}/closings`, { method: 'POST', body: { closingIds } }),
    removeClosings: (id, closingIds) =>
      request(`/closing-batches/${id}/closings`, {
        method: 'POST',
        body: { closingIds, remove: true },
      }),
    /** Freeze the batch: no more closings may be added once the sheet is out. */
    issue: (id) => request(`/closing-batches/${id}`, { method: 'PATCH', body: { status: 'issued' } }),
    /** The printable सूचना पत्र. A URL, because it goes straight to a printer. */
    noticeUrl: (id) => apiUrl(`/closing-batches/${id}/notice`),
    /**
     * The two collection documents: a सहयोग राशि रसीद per member, and the
     * agent-wise सारांश that goes on top of the stack. One endpoint because
     * they are one calculation — see the route for why that matters.
     */
    receiptsUrl: (id, agentId) =>
      apiUrl(`/closing-batches/${id}/bills${qs({ doc: 'receipts', agentId })}`),
    summaryUrl: (id, agentId) =>
      apiUrl(`/closing-batches/${id}/bills${qs({ doc: 'summary', agentId })}`),
  },

  /* programs & groups */
  programs: {
    list: () => request('/programs'),
    get: (id) => request(`/programs/${id}`),
    /** Age bands + location groups — what the member form needs to show rates. */
    rules: (id) => request(`/programs/${id}${qs({ rules: true })}`),
    create: (body) => request('/programs', { method: 'POST', body }),
    update: (id, body) => request(`/programs/${id}`, { method: 'PATCH', body }),
    remove: (id) => request(`/programs/${id}`, { method: 'DELETE' }),
  },
  groups: {
    list: () => request('/groups'),
    create: (body) => request('/groups', { method: 'POST', body }),
  },

  /* payments */
  payments: {
    /**
     * `idempotencyKey` is generated per submit attempt, not per retry — so a
     * double-tap or a network retry returns the ORIGINAL receipt instead of
     * charging the member twice.
     */
    create: (body, idempotencyKey) =>
      request('/payments', {
        method: 'POST',
        body,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      }),
    /**
     * One deposit, many members — an agent banking a whole round.
     *
     * Call it once with `preview: true` to get the proposed split, show that,
     * and call it again without `preview` to write it. The same
     * `idempotencyKey` on both the preview and the real submit is harmless —
     * a preview writes nothing — and on a retried submit it is what returns
     * the receipts already written instead of taking the money twice.
     */
    bulk: (body, idempotencyKey) =>
      request('/payments/bulk', {
        method: 'POST',
        body,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      }),
    /** The printed रसीद. A URL, not a fetch — it opens in a tab to print. */
    receiptUrl: (id) => apiUrl(`/payments/${id}/receipt`),
    cancel: (id, reason) =>
      request(`/payments/${id}/cancel`, { method: 'POST', body: { reason } }),
    list: (params) => request(`/payments${qs(params)}`),
    /**
     * The whole filtered register as totals — the figures at the top of the
     * report page.
     *
     * A separate call from `list` on purpose: the totals are worked out over
     * every receipt the filter matches, while `list` returns one screenful. A
     * total derived from the rows that happen to be loaded would grow as the
     * operator scrolls, and a collection figure that moves is not a figure.
     */
    report: (params) => request(`/payments/report${qs({ ...params, format: 'json' })}`),
    /** The same filters as a file. A URL, because it goes to `fetch` + download. */
    reportUrl: (params, format) =>
      apiUrl(`/payments/report${qs({ ...params, format })}`),
  },

  /* reference lists — states, districts, relations… */
  masters: {
    all: () => request('/masters'),
    get: (type) => request(`/masters/${type}`),
    save: (type, items) => request(`/masters/${type}`, { method: 'PUT', body: { items } }),
  },

  /* the trust — one per deployment, edited in place, never created here */
  trust: {
    get: () => request('/trust'),
    update: (body) => request('/trust', { method: 'PATCH', body }),
    /**
     * Upload a branding image through the server.
     *
     * A raw `fetch` rather than `request()`, because `request()` JSON-encodes
     * its body and sets `Content-Type: application/json`; a multipart upload
     * needs the browser to set that header itself, boundary and all.
     */
    uploadBranding: async (kind, file) => {
      const body = new FormData();
      body.set('kind', kind);
      body.set('file', file, `${kind}.jpg`);

      const response = await fetch(apiUrl('/trust/branding'), {
        method: 'POST',
        credentials: 'same-origin',
        body,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new ApiError(payload?.error ?? `अपलोड नहीं हुआ (${response.status})`, {
          status: response.status,
          code: payload?.code,
        });
      }
      return payload.url;
    },
    team: {
      list: () => request('/trust/team'),
      add: (body) => request('/trust/team', { method: 'POST', body }),
      update: (uid, body) => request(`/trust/team/${uid}`, { method: 'PATCH', body }),
      /** Returns a one-time password. It is not stored anywhere. */
      resetPassword: (uid) =>
        request(`/trust/team/${uid}/password`, { method: 'POST' }),
    },
  },

  /**
   * The trust's public face — name, logo, colours. No session needed, so the
   * login screen is branded like everything else.
   */
  branding: () => request('/branding'),

  /* misc */
  setup: (body) => request('/setup', { method: 'POST', body }),
  stats: (params) => request(`/stats${qs(params)}`),

  agents: {
    list: (params) => request(`/agents${qs(params)}`),
    get: (id) => request(`/agents/${id}`),
    create: (body) => request('/agents', { method: 'POST', body }),
    update: (id, body) => request(`/agents/${id}`, { method: 'PATCH', body }),
    /** Returns a one-time password and revokes the agent's existing sessions. */
    resetPassword: (id) => request(`/agents/${id}/password`, { method: 'POST' }),
    /**
     * Give this agent's position to a different person. The members and the
     * commission history stay; the login, the name and the signature change.
     */
    handover: (id, body) => request(`/agents/${id}/handover`, { method: 'POST', body }),
  },

  /**
   * The agent's phone app. Every call is scoped on the server to the signed-in
   * agent; the योजना comes from the active program like everywhere else.
   */
  agentApp: {
    overview: () => request('/agent/overview'),
    closings: () => request('/agent/closings'),
    closing: (id) => request(`/agent/closings/${id}`),
    member: (id) => request(`/agent/members/${id}`),
    commission: () => request('/agent/commission'),
    /** Who owes / who paid one closing — a sheet for the round. */
    closingPdfUrl: (id, mode = 'pending') => apiUrl(`/agent/closings/${id}/pdf${qs({ mode })}`),
    /** The whole योजना's pending / paid / joining-fee list for this agent. */
    duesPdfUrl: (mode = 'pending') => apiUrl(`/agent/dues-pdf${qs({ mode })}`),
    /** One member's closing-by-closing statement. */
    memberPdfUrl: (id, mode = 'all', programId) =>
      apiUrl(`/agent/members/${id}/pdf${qs({ mode, programId })}`),
    /** सदस्यता प्रमाण पत्र — checked against the member's own योजना. */
    certificateUrl: (id, programId) =>
      apiUrl(`/members/${id}/document${qs({ type: 'certificate', programId })}`),
  },

  /** सदस्य अनुरोध — agent asks, office approves / rejects / removes. */
  memberRequests: {
    list: (params) => request(`/member-requests${qs(params)}`),
    pendingCount: () => request('/member-requests?count=pending'),
    get: (id) => request(`/member-requests/${id}`),
    create: (body) => request('/member-requests', { method: 'POST', body }),
    resubmit: (id, body) => request(`/member-requests/${id}`, { method: 'PUT', body }),
    approve: (id, body = {}) =>
      request(`/member-requests/${id}`, { method: 'PATCH', body: { action: 'approve', ...body } }),
    reject: (id, reason) =>
      request(`/member-requests/${id}`, { method: 'PATCH', body: { action: 'reject', reason } }),
    remove: (id) => request(`/member-requests/${id}`, { method: 'DELETE' }),
  },

  /** The member's own app. Not योजना-scoped: a family spans several. */
  portal: {
    home: () => request('/portal/home'),
    member: (id) => request(`/portal/members/${id}`),
    pdfUrl: (id, doc = 'statement', mode) => `/api/portal/members/${id}/pdf${qs({ doc, mode })}`,
    receiptUrl: (id, memberId) => `/api/portal/receipts/${id}${qs({ memberId })}`,
  },

  /** A member's login for the member app — set by the office. */
  memberLogin: {
    get: (id) => request(`/members/${id}/login`),
    set: (id, body = {}) => request(`/members/${id}/login`, { method: 'POST', body }),
  },

  commission: {
    payouts: (params) => request(`/commission/payouts${qs(params)}`),
    createPayout: (body) =>
      request('/commission/payouts', { method: 'POST', body }),
  },
};

/** A fresh idempotency key for one user-initiated submit. */
export const newIdempotencyKey = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Query keys, in one place so invalidation is never guesswork. */
export const keys = {
  stats: ['stats'],
  members: (params) => ['members', params],
  memberFacets: (programId) => ['members', 'facets', programId],
  member: (id) => ['member', id],
  memberLedger: (id) => ['member', id, 'ledger'],
  memberSearch: (q) => ['members', 'search', q],
  memberByPhone: (phone) => ['members', 'by-phone', phone],
  closings: ['closings'],
  closingBatches: ['closing-batches'],
  closingBatch: (id) => ['closing-batch', id],
  closable: (q) => ['closings', 'closable', q],
  closingCollection: (id) => ['closing', id, 'collection'],
  agents: ['agents'],
  agent: (id) => ['agent', id],
  programs: ['programs'],
  groups: ['groups'],
  masters: ['masters'],
  trust: ['trust'],
  team: ['trust', 'team'],
  payments: (params) => ['payments', params],
  payouts: (params) => ['payouts', params],
  agentOverview: (programId) => ['agent-app', 'overview', programId],
  agentClosings: (programId) => ['agent-app', 'closings', programId],
  agentClosing: (id) => ['agent-app', 'closing', id],
  agentMember: (id) => ['agent-app', 'member', id],
  agentCommission: (programId) => ['agent-app', 'commission', programId],
  memberRequests: (params) => ['member-requests', params],
  memberRequestsPending: ['member-requests', 'pending-count'],
  portalHome: ['portal', 'home'],
  portalMember: (id) => ['portal', 'member', id],
  memberLogin: (id) => ['member', id, 'login'],
};
