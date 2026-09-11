import 'server-only';

import { db, serverNow } from '../firebase/admin.js';
import { badRequest, notFound } from '../http.js';
import { MASTER_TYPES, paths } from '../../config/constants.js';
import {
  states, districtsByState, gender, relations, paymentMethods, closingTypes,
} from '../../config/staticData.js';

/**
 * masters.js — the reference lists every form picks from.
 *
 * States, districts, relations and the rest used to be a hardcoded file, which
 * meant a trust in another state needed a code change and a redeploy to add a
 * district. They are data now: one document per list, editable from the master
 * screen, seeded from that same file the first time each list is read so
 * nobody starts from an empty dropdown.
 *
 * One document per list rather than one per entry. A district list is a few
 * hundred short strings — as documents that is a few hundred reads every time
 * a form opens, plus an index for the ordering. As one document it is a single
 * read, cached in memory, and it is edited the way people think about a list:
 * as a whole.
 */

const memo = new Map();
const MEMO_TTL_MS = 5 * 60 * 1000;

/* ══════════════════════════════════════════════════════════════════════════
   Reading
   ══════════════════════════════════════════════════════════════════════════ */

/** One list, seeded from the built-in defaults if it has never been saved. */
export async function getMaster(trustId, type) {
  assertType(type);

  const key = `${trustId}:${type}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.value;

  const snap = await db.doc(paths.master(trustId, type)).get();

  const items = snap.exists
    ? (snap.data().items ?? [])
    : await seed(trustId, type);

  const value = { type, items, updatedAt: snap.data()?.updatedAt ?? null };
  memo.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Every list at once — what a form needs to open.
 *
 * Eight documents, cached for five minutes, so in practice a form costs
 * nothing. Fetching them one screen at a time would be the same total cost
 * spread over more round trips.
 */
export async function getAllMasters(trustId) {
  const types = Object.keys(MASTER_TYPES);
  const lists = await Promise.all(types.map((t) => getMaster(trustId, t)));

  const masters = {};
  types.forEach((t, i) => {
    masters[t] = lists[i].items;
  });

  return { masters };
}

/* ══════════════════════════════════════════════════════════════════════════
   Writing
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Replace a whole list.
 *
 * Whole-list replacement, not per-entry edits, because the screen edits it as
 * a list — reordering three rows is one intention, not three. The cost is that
 * two people editing the same list at once will have the last save win; for
 * eight lists that change a few times a year that is the right trade.
 *
 * `value` is what gets stored on member records, so it is generated once from
 * the label and then frozen. Letting it change later would silently orphan
 * every member already carrying the old one.
 */
export async function saveMaster(scope, type, items) {
  assertType(type);

  const parentType = MASTER_TYPES[type].parent;
  const parentValues = parentType
    ? new Set((await getMaster(scope.trustId, parentType)).items.map((i) => i.value))
    : null;

  const seen = new Set();
  const clean = items.map((raw, index) => {
    const label = String(raw.label ?? '').trim();
    if (!label) throw badRequest(`पंक्ति ${index + 1}: नाम खाली नहीं हो सकता`);

    const value = String(raw.value ?? '').trim() || slug(label);
    if (seen.has(value)) {
      throw badRequest(`"${label}" दो बार है — हर प्रविष्टि अलग होनी चाहिए`);
    }
    seen.add(value);

    if (parentValues && raw.parent && !parentValues.has(raw.parent)) {
      throw badRequest(`"${label}" का ${MASTER_TYPES[parentType].label} मौजूद नहीं है`);
    }
    if (parentValues && !raw.parent) {
      throw badRequest(`"${label}" के लिए ${MASTER_TYPES[parentType].label} चुनें`);
    }

    return {
      value,
      label,
      labelEn: String(raw.labelEn ?? '').trim(),
      parent: raw.parent ?? null,
      active: raw.active !== false,
      order: index,
    };
  });

  await db.doc(paths.master(scope.trustId, type)).set({
    type,
    items: clean,
    count: clean.length,
    updatedAt: serverNow(),
    updatedBy: scope.uid,
  });

  memo.delete(`${scope.trustId}:${type}`);

  // Districts hang off states, so a state that disappears leaves districts
  // pointing at nothing. Say so rather than silently keeping orphans.
  const orphans = await findOrphans(scope.trustId, type, clean);

  return { type, items: clean, orphans };
}

/**
 * Which child entries would be left pointing at a parent that no longer
 * exists. Reported, not auto-deleted: quietly removing forty districts because
 * someone renamed a state is not a fix, it is a second problem.
 */
async function findOrphans(trustId, parentType, parentItems) {
  const children = Object.entries(MASTER_TYPES)
    .filter(([, def]) => def.parent === parentType)
    .map(([t]) => t);

  if (!children.length) return [];

  const values = new Set(parentItems.map((i) => i.value));
  const out = [];

  for (const child of children) {
    const { items } = await getMaster(trustId, child);
    for (const item of items) {
      if (item.parent && !values.has(item.parent)) {
        out.push({ type: child, label: item.label, missingParent: item.parent });
      }
    }
  }

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   Seeding
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * First read of a list writes the built-in default and returns it.
 *
 * The alternative — an empty list until someone fills it in — means a member
 * form with an empty state dropdown on day one, which looks broken rather than
 * unconfigured.
 */
async function seed(trustId, type) {
  const items = defaultsFor(type);
  if (!items.length) return [];

  await db.doc(paths.master(trustId, type)).set({
    type,
    items,
    count: items.length,
    seeded: true,
    updatedAt: serverNow(),
  });

  return items;
}

function defaultsFor(type) {
  const norm = (list, parent = null) =>
    (list ?? []).map((o, i) => ({
      value: o.value ?? slug(o.label),
      label: o.label ?? '',
      labelEn: o.label_en ?? o.labelEn ?? '',
      parent,
      active: true,
      order: i,
    }));

  switch (type) {
    case 'state':
      return norm(states);

    case 'district': {
      // The hardcoded file keys districts by state; flatten it into one list
      // where each entry names its parent, which is how the screen edits it.
      const out = [];
      for (const [stateValue, list] of Object.entries(districtsByState ?? {})) {
        out.push(...norm(list, stateValue));
      }
      return out.map((d, i) => ({ ...d, order: i }));
    }

    case 'relation': return norm(relations);
    case 'gender': return norm(gender);
    case 'paymentMethod': return norm(paymentMethods);
    case 'closingType': return norm(closingTypes);

    case 'jati': return [];
    case 'designation':
      return norm([
        { label: 'अध्यक्ष' }, { label: 'उपाध्यक्ष' }, { label: 'सचिव' },
        { label: 'कोषाध्यक्ष' }, { label: 'सदस्य' },
      ]);

    default: return [];
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function assertType(type) {
  if (!MASTER_TYPES[type]) throw notFound(`अज्ञात सूची: ${type}`);
}

/**
 * A stable machine value from a label.
 *
 * Devanagari survives `toLowerCase` unchanged and has no ASCII equivalent, so
 * a Hindi-only label produces an empty slug — hence the timestamp fallback.
 * It is ugly and it is never shown; what matters is that it is unique and
 * never changes once a member is carrying it.
 */
function slug(label) {
  const ascii = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return ascii || `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
