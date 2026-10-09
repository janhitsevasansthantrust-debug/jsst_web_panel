import { handler, okCached } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { getAllMasters } from '../../../server/domain/masters.js';
import { ROLE, MASTER_TYPES } from '../../../config/constants.js';
import {
  states as fallbackStates, districtsByState, gender as fallbackGender,
  relations as fallbackRelations, paymentMethods as fallbackMethods,
} from '../../../config/staticData.js';

/**
 * GET /api/masters — every reference list, in one response.
 *
 * Readable by anyone signed in: these are the dropdowns on the forms, not
 * privileged data. Editing them is admin-only (see the [type] route).
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { masters } = await getAllMasters(scope.trustId);

  // `?resolved=1` — the phone app's form: ready-to-use option lists with the
  // same built-in fallbacks the office form uses (lib/useMasters.js), so both
  // forms always offer the same choices.
  if (new URL(request.url).searchParams.get('resolved')) {
    return okCached({ lists: resolve(masters) }, 300);
  }

  return okCached({ masters, types: MASTER_TYPES }, 300);
});

const opt = (i) => ({ value: i.value, label: i.label || i.labelEn || i.label_en || i.value });
const live = (list) => (list ?? []).filter((i) => i.active !== false);

function resolve(masters) {
  const pick = (key, fallback) => (live(masters?.[key]).length ? live(masters[key]).map(opt) : (fallback ?? []).map(opt));
  const districts = live(masters?.district).length
    ? live(masters.district).map((d) => ({ ...opt(d), parent: d.parent }))
    : Object.entries(districtsByState ?? {}).flatMap(([parent, list]) => list.map((d) => ({ ...opt(d), parent })));
  return {
    states: pick('state', fallbackStates),
    districts,
    genders: pick('gender', fallbackGender),
    relations: pick('relation', fallbackRelations),
    jatis: pick('jati', []),
    paymentMethods: pick('paymentMethod', fallbackMethods),
  };
}
