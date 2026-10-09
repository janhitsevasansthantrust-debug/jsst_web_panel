import 'server-only';

import { db, serverNow, getAllDocs } from '../firebase/admin.js';
import { LIMITS, paths, CLOSING_STATUS } from '../../config/constants.js';
import { MEMBER_INDEX_FIELDS, toMemberEntry, fromMemberEntry } from './indexEntry.js';
import { computeDue } from './ledger.js';

// Re-exported so callers keep one import for "the member index".
export { fromMemberEntry } from './indexEntry.js';

/**
 * Index documents — the single biggest reason this system is cheap.
 *
 * ─── The closings index ──────────────────────────────────────────────────
 *
 * The 500 closings are identical for every user of the trust, and every screen
 * that touches money needs all of them. Reading 500 documents on every page
 * load is what made the old system expensive. Instead we keep ONE document
 * holding all of them, and read that.
 *
 *     500 closings × ~150 bytes ≈ 75 KB in one document
 *     → 1 Firestore read serves the entire application
 *
 * It is rebuilt only when a closing is created, edited or reverted — a few
 * times a week, not a few times a second. A `version` counter lets a client
 * (or the in-process cache) check freshness without re-downloading.
 *
 * ─── The member search index ─────────────────────────────────────────────
 *
 * Same trick for search: 5,000 members compressed into 5 shard documents of
 * the handful of fields you search on. The browser downloads them once and
 * then searches 5,000 members instantly, offline, for 5 reads — instead of the
 * old system's `search_keywords` prefix arrays, which wrote 200+ tokens into
 * every member document on every single save.
 */

/* ══════════════════════════════════════════════════════════════════════════
   In-process cache
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A warm serverless instance keeps the index in memory, so consecutive
 * requests cost zero reads. TTL is short because correctness after a new
 * closing matters more than a few extra reads.
 */
const memo = new Map();
const MEMO_TTL_MS = 60_000;

function memoGet(key) {
  const hit = memo.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEMO_TTL_MS) {
    memo.delete(key);
    return null;
  }
  return hit.value;
}

function memoSet(key, value) {
  memo.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Drop the cached closings index for one program.
 *
 * The member index goes with it on purpose. Each entry in that index now carries
 * the member's `due` and `dueC`, DERIVED from this trust's closings — so a
 * closing created or reverted has changed what the member index says. Leaving
 * it warm would keep serving dues that no longer exist for up to a minute,
 * which is exactly the "the screen says one thing and the receipt says another"
 * failure this system exists to avoid.
 */
export function invalidateIndexCache(trustId, programId) {
  memo.delete(`closings:${trustId}:${programId}`);
  memo.delete(`members:${trustId}`);
}

/* ══════════════════════════════════════════════════════════════════════════
   Closings index
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every active closing, cheapest way possible.
 * @returns {Promise<{items:Array, version:number, maxSeq:number}>}
 */
export async function getClosingsIndex(trustId, programId, { fresh = false } = {}) {
  const key = `closings:${trustId}:${programId}`;
  if (!fresh) {
    const cached = memoGet(key);
    if (cached) return cached;
  }

  const snap = await db.doc(paths.closingsIndex(trustId, programId)).get();

  if (!snap.exists) {
    // First run, or the index was lost — rebuild from source rather than
    // silently returning "no closings", which would zero out everyone's dues.
    return memoSet(key, await rebuildClosingsIndex(trustId, programId));
  }

  const data = snap.data();
  const items = data.items ?? [];

  return memoSet(key, {
    items,
    version: data.version ?? 0,
    maxSeq: data.maxSeq ?? items.reduce((m, c) => Math.max(m, c.seq), 0),
    updatedAt: data.updatedAt ?? null,
  });
}

/** The compact shape stored in the index — keep it small, it is read constantly. */
export function toIndexEntry(id, c) {
  return {
    seq: c.seq,
    id,
    memberId: c.memberId ?? null,
    name: c.displayName ?? '',
    regNo: c.registrationNumber ?? '',
    fatherName: c.fatherName ?? '',
    village: c.village ?? '',
    // Carried so the batch notice can list जाति and फ़ोन without reading every
    // closing document back — the sheet names the family, and a name with no
    // village or caste beside it is not enough to identify one.
    jati: c.jati ?? '',
    phone: c.phone ?? '',
    dateMs: c.closingDateMs ?? null,
    amount: c.amountPerMember ?? LIMITS.DEFAULT_PAY_AMOUNT,
    groupId: c.groupId ?? null,
    batchId: c.batchId ?? null,
    /**
     * Carried because `computeDue` runs against the INDEX, not the closing
     * documents. A rule that lived only on the document would be invisible to
     * the one place that decides what anybody owes.
     */
    includeBlocked: c.includeBlocked !== false,
    status: c.status ?? CLOSING_STATUS.ACTIVE,
  };
}

/**
 * Rebuild the closings index from the `closings` collection.
 *
 * Costs one read per closing, so it is called only on write paths — never on
 * a page load. Reverted closings are KEPT in the index (with their status) so
 * that a member's ledger can still tell the difference between "this seq is a
 * gap" and "this seq does not exist yet".
 */
export async function rebuildClosingsIndex(trustId, programId) {
  const snap = await db
    .collection(paths.closings(trustId, programId))
    .orderBy('seq', 'asc')
    .select(
      'seq', 'memberId', 'displayName', 'registrationNumber', 'fatherName',
      'village', 'jati', 'phone', 'closingDateMs', 'amountPerMember',
      'groupId', 'batchId', 'includeBlocked', 'status',
    )
    .get();

  const items = snap.docs.map((d) => toIndexEntry(d.id, d.data()));
  const maxSeq = items.reduce((m, c) => Math.max(m, c.seq ?? 0), 0);

  if (items.length > LIMITS.CLOSINGS_INDEX_CHUNK) {
    // Not reachable at the current scale (500), but fail loudly rather than
    // silently writing a document that exceeds Firestore's 1 MB limit.
    throw new Error(
      `Closings index has ${items.length} entries, above the ` +
      `${LIMITS.CLOSINGS_INDEX_CHUNK} single-document limit. Enable sharding.`,
    );
  }

  const payload = {
    items,
    maxSeq,
    count: items.length,
    version: Date.now(),
    updatedAt: serverNow(),
  };

  await db.doc(paths.closingsIndex(trustId, programId)).set(payload);
  invalidateIndexCache(trustId, programId);

  return { items, maxSeq, version: payload.version };
}

/**
 * ─── There is deliberately no "append one closing" or "patch one closing"
 * helper here any more ──────────────────────────────────────────────────────
 *
 * Both used to exist, and both were a trap. They ran a read-modify-write on
 * the index document in a transaction of their own — AFTER the transaction that
 * wrote the closing had already committed. So the closing document and the
 * index that every notice, bill and due-amount is computed from could disagree:
 * a crash, a contention retry or a failed rule could leave a closing that
 * exists but is not on the sheet, and nothing detects that.
 *
 * The index is now written inside the same transaction as the closing itself
 * (create) or inside the revert's own transaction (retire, re-batch), so the
 * two are always committed together. If you need to change the index, you are
 * changing it in that transaction — not afterwards.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Member search index
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Rebuild the member search shards for a whole trust.
 *
 * Costs one read per member, so it runs on a schedule or after a bulk import,
 * not on every edit — individual edits patch a single shard through
 * `patchMemberInIndex`.
 */
export async function rebuildMembersIndex(trustId) {
  const snap = await db
    .collection(paths.members(trustId))
    .where('delete_flag', '==', false)
    .select(...MEMBER_INDEX_FIELDS)
    .get();

  const entries = snap.docs
    .map((d) => toMemberEntry(d.id, d.data()))
    // Sorted by registration number so a shard's contents are stable across
    // rebuilds — otherwise every rebuild rewrites every shard.
    .sort((a, b) => collateReg(a.reg, b.reg));

  const shards = [];
  for (let i = 0; i < entries.length; i += LIMITS.MEMBERS_INDEX_CHUNK) {
    shards.push(entries.slice(i, i + LIMITS.MEMBERS_INDEX_CHUNK));
  }
  if (!shards.length) shards.push([]);

  const version = Date.now();
  const batch = db.batch();

  shards.forEach((items, n) => {
    batch.set(db.doc(paths.membersIndexShard(trustId, n)), {
      items,
      shard: n,
      shardCount: shards.length,
      count: items.length,
      version,
      schemaVersion: 2,
      updatedAt: serverNow(),
    });
  });

  // Clear any shards left over from a previous, larger rebuild.
  for (let n = shards.length; n < shards.length + 10; n += 1) {
    batch.delete(db.doc(paths.membersIndexShard(trustId, n)));
  }

  await batch.commit();
  invalidateMembersIndexCache(trustId);

  return { total: entries.length, shardCount: shards.length, version };
}

/** Registration numbers are numeric strings — compare them as numbers. */
function collateReg(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

/**
 * Every member in the trust — 10 reads for 5,000 members, 0 while warm.
 *
 * This is what makes "filter by anything, in any combination" affordable. The
 * alternative is a Firestore composite index per combination of filters, which
 * is both a combinatorial explosion and still cannot do free-text search.
 */
export async function getMembersIndex(trustId, { fresh = false } = {}) {
  const key = `members:${trustId}`;
  if (!fresh) {
    const cached = memoGet(key);
    // `derived` means the dues are already worked out. Re-working them for
    // 5,000 members against 500 closings is 2.5 million comparisons, which is
    // not something to repeat on every request that happens to read the index.
    if (cached) return cached.derived ? cached : deriveMemberDues(trustId, cached);
  }

  const first = await db.doc(paths.membersIndexShard(trustId, 0)).get();
  if (!first.exists) {
    // No index yet — build it now rather than returning an empty list, which
    // would read as "this trust has no members".
    const built = await rebuildMembersIndex(trustId);
    if (built.total === 0) {
      return memoSet(key, { items: [], version: built.version, shardCount: 1 });
    }
    return getMembersIndex(trustId, { fresh: true });
  }

  const head = first.data();
  if (head.schemaVersion !== 2) {
    await rebuildMembersIndex(trustId);
    return getMembersIndex(trustId, { fresh: true });
  }
  const shardCount = head.shardCount ?? 1;

  const rest = shardCount > 1
    ? await getAllDocs(
        Array.from({ length: shardCount - 1 }, (_, i) =>
          db.doc(paths.membersIndexShard(trustId, i + 1)),
        ),
      )
    : [];

  const items = [...(head.items ?? []), ...rest.flatMap((s) => s.items ?? [])];

  /**
   * An index that exists but is empty, over a collection that is not.
   *
   * `bootstrap` writes an empty shard 0 when a trust is created, so the
   * "no shard → build it" branch above never fires afterwards. If the shards
   * are then lost or left behind — a restored backup, a migration that only
   * copied documents, a failed rebuild — every list, filter and search in the
   * app returns nothing, for ever, and the members are all still sitting in
   * Firestore. That reads as "the app lost my members".
   *
   * A `count()` costs a handful of reads regardless of collection size, and
   * this only runs when the index came back empty, so the check is close to
   * free and the repair is automatic.
   */
  if (items.length === 0 && !fresh) {
    const actual = await db
      .collection(paths.members(trustId))
      .where('delete_flag', '==', false)
      .count()
      .get();

    if ((actual.data().count ?? 0) > 0) {
      await rebuildMembersIndex(trustId);
      return getMembersIndex(trustId, { fresh: true });
    }
  }

  return deriveMemberDues(trustId, memoSet(key, { items, version: head.version ?? 0, shardCount }));
}

/**
 * Work out what every member owes, once, and remember it.
 *
 * The alternative is storing a `dueCount`/`dueAmount` on each member document
 * and rewriting all 5,000 of them every time a closing is created — the loop
 * over members this whole system is built to avoid. Deriving it here costs
 * arithmetic, not writes, and the result is cached until a closing changes
 * (`invalidateIndexCache` drops it).
 */
async function deriveMemberDues(trustId, index) {
  const programs = [...new Set(index.items.map((m) => m.pid).filter(Boolean))];
  const indexes = await Promise.all(programs.map((pid) => getClosingsIndex(trustId, pid)));
  const byProgram = new Map(programs.map((pid, i) => [pid, indexes[i].items]));
  return memoSet(`members:${trustId}`, {
    ...index,
    derived: true,
    items: index.items.map((entry) => {
      const due = computeDue(fromMemberEntry(entry), byProgram.get(entry.pid) ?? []);
      return { ...entry, dueC: due.dueCount, due: due.dueAmount };
    }),
  });
}

export function invalidateMembersIndexCache(trustId) {
  memo.delete(`members:${trustId}`);
}

/**
 * Update (or insert) one member inside whichever shard holds them.
 *
 * Every shard is checked before giving up, because a member's shard changes
 * whenever the index is rebuilt. When nobody holds them and the last shard is
 * full, a new shard is opened and the head's `shardCount` is bumped — that
 * bump is what makes the new shard visible to readers, so it happens last.
 */
export async function patchMemberInIndex(trustId, memberId, member) {
  const headRef = db.doc(paths.membersIndexShard(trustId, 0));
  const head = await headRef.get();
  if (!head.exists) return; // no index yet — the next read builds it

  const shardCount = head.data().shardCount ?? 1;
  const entry = toMemberEntry(memberId, member);

  for (let n = 0; n < shardCount; n += 1) {
    const ref = db.doc(paths.membersIndexShard(trustId, n));

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return 'missing';

      const items = snap.data().items ?? [];
      const at = items.findIndex((i) => i.id === memberId);

      if (at !== -1) {
        items[at] = entry;
        tx.update(ref, { items, version: Date.now(), updatedAt: serverNow() });
        return 'done';
      }

      // Not here. Only the last shard may take a new member, and only if it
      // has room.
      if (n < shardCount - 1) return 'next';
      if (items.length >= LIMITS.MEMBERS_INDEX_CHUNK) return 'full';

      items.push(entry);
      tx.update(ref, { items, version: Date.now(), updatedAt: serverNow() });
      return 'done';
    });

    if (outcome === 'done') {
      invalidateMembersIndexCache(trustId);
      return;
    }

    if (outcome === 'full') {
      await openShard(trustId, shardCount, entry);
      invalidateMembersIndexCache(trustId);
      return;
    }
  }

  invalidateMembersIndexCache(trustId);
}

/**
 * Update MANY members inside the index in one pass.
 *
 * `patchMemberInIndex` is right for one member and wrong for forty. Each call
 * reads the head, then runs a transaction per shard until it finds its member
 * — and each of those transactions reads a whole shard document (up to a few
 * hundred kilobytes) and writes the entire thing back. Called in a loop it
 * rewrites the SAME shard once per member, serially, and because every one of
 * those writes contends on the same document Firestore makes them queue and
 * retry. Four members banked together spent most of their time here.
 *
 * This reads the head once and touches each shard once, applying every member
 * that lives in it inside a single transaction. Forty members in one shard is
 * one read and one write instead of forty of each.
 *
 * Members not found anywhere are returned rather than inserted: this is the
 * path taken after a payment, where the member certainly exists in the index
 * already, and quietly appending them to the last shard would hide a real
 * inconsistency. The caller can fall back to the single-member path, which
 * does handle insertion.
 *
 * @param {string} trustId
 * @param {Array<{id:string, member:object}>} members
 * @returns {Promise<{updated:number, missing:string[]}>}
 */
export async function patchMembersInIndex(trustId, members) {
  const list = (members ?? []).filter((m) => m?.id && m.member);
  if (!list.length) return { updated: 0, missing: [] };
  if (list.length === 1) {
    await patchMemberInIndex(trustId, list[0].id, list[0].member);
    return { updated: 1, missing: [] };
  }

  const headRef = db.doc(paths.membersIndexShard(trustId, 0));
  const head = await headRef.get();
  if (!head.exists) return { updated: 0, missing: list.map((m) => m.id) };

  const shardCount = head.data().shardCount ?? 1;

  const pending = new Map(list.map((m) => [m.id, toMemberEntry(m.id, m.member)]));
  let updated = 0;

  for (let n = 0; n < shardCount && pending.size; n += 1) {
    const ref = db.doc(paths.membersIndexShard(trustId, n));

    const applied = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return [];

      const items = snap.data().items ?? [];
      const hit = [];

      // One scan of the shard for all of them, rather than one scan each.
      const at = new Map();
      for (let i = 0; i < items.length; i += 1) at.set(items[i].id, i);

      for (const [id, entry] of pending) {
        const i = at.get(id);
        if (i !== undefined) {
          items[i] = entry;
          hit.push(id);
        }
      }

      if (!hit.length) return [];

      tx.update(ref, { items, version: Date.now(), updatedAt: serverNow() });
      return hit;
    });

    for (const id of applied) pending.delete(id);
    updated += applied.length;
  }

  if (updated) invalidateMembersIndexCache(trustId);

  return { updated, missing: [...pending.keys()] };
}

/** Start a new shard and publish it by raising the head's `shardCount`. */
async function openShard(trustId, n, entry) {
  const batch = db.batch();

  batch.set(db.doc(paths.membersIndexShard(trustId, n)), {
    items: [entry],
    shard: n,
    shardCount: n + 1,
    count: 1,
    version: Date.now(),
    updatedAt: serverNow(),
  });

  // Readers take `shardCount` from shard 0, so this is the line that makes the
  // new shard real. It goes in the same batch — a new shard nobody reads is
  // just a lost member.
  batch.update(db.doc(paths.membersIndexShard(trustId, 0)), {
    shardCount: n + 1,
    version: Date.now(),
  });

  await batch.commit();
}

/**
 * Drop a member from the index.
 *
 * Used on soft delete. The member document stays — the index is only ever a
 * view of the members you can still act on, so leaving a deleted member in it
 * would put them back in every list and every filter.
 */
export async function removeMemberFromIndex(trustId, memberId) {
  const headRef = db.doc(paths.membersIndexShard(trustId, 0));
  const head = await headRef.get();
  if (!head.exists) return;

  const shardCount = head.data().shardCount ?? 1;

  for (let n = 0; n < shardCount; n += 1) {
    const ref = db.doc(paths.membersIndexShard(trustId, n));

    const removed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;

      const items = snap.data().items ?? [];
      const next = items.filter((i) => i.id !== memberId);
      if (next.length === items.length) return false;

      tx.update(ref, {
        items: next,
        count: next.length,
        version: Date.now(),
        updatedAt: serverNow(),
      });
      return true;
    });

    if (removed) break;
  }

  invalidateMembersIndexCache(trustId);
}

/**
 * Rewrite one agent's name across every index entry that carries it.
 *
 * The member index stores `agent` as a name, not a reference — that is what
 * makes "filter by agent" and "group by agent" cost nothing. The price is this
 * function: when an agent is renamed, the copies have to be corrected.
 *
 * Walking the shards costs one read and one write per shard — about ten for a
 * 5,000-member trust — instead of the full rebuild a naive fix would do, which
 * would be one read per member.
 */
export async function renameAgentInIndex(trustId, agentId, displayName) {
  const head = await db.doc(paths.membersIndexShard(trustId, 0)).get();
  if (!head.exists) return { shards: 0, entries: 0 };

  const shardCount = head.data().shardCount ?? 1;
  let touched = 0;
  let shards = 0;

  for (let n = 0; n < shardCount; n += 1) {
    const ref = db.doc(paths.membersIndexShard(trustId, n));

    const changed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return 0;

      const items = snap.data().items ?? [];
      let count = 0;

      const next = items.map((i) => {
        if (i.agentId !== agentId || i.agent === displayName) return i;
        count += 1;
        return { ...i, agent: displayName };
      });

      if (!count) return 0;

      tx.update(ref, { items: next, version: Date.now(), updatedAt: serverNow() });
      return count;
    });

    if (changed) {
      touched += changed;
      shards += 1;
    }
  }

  invalidateMembersIndexCache(trustId);
  return { shards, entries: touched };
}
