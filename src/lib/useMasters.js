'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api, keys } from './api.js';
import {
  states as fallbackStates, districtsByState, gender as fallbackGender,
  relations as fallbackRelations, paymentMethods as fallbackMethods,
  closingTypes as fallbackClosingTypes,
} from '../config/staticData.js';

/**
 * The reference lists, live from the master screen.
 *
 * Every form used to import these straight from `config/staticData.js`, which
 * meant adding a district required a code change and a deploy. They come from
 * the database now — but the built-in file is kept as a FALLBACK, not deleted.
 *
 * That fallback matters: the alternative is a member form whose state dropdown
 * is empty because one fetch failed, and an empty dropdown reads as a broken
 * app rather than a slow one. The lists are cached for five minutes and shared
 * across every form on the page, so this is one request per session in
 * practice.
 */
export function useMasters() {
  const query = useQuery({
    queryKey: keys.masters,
    queryFn: () => api.masters.all(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const masters = query.data?.masters;

  return useMemo(() => {
    /** Live list if we have one, the built-in file if we do not. */
    const pick = (key, fallback) => {
      const live = masters?.[key];
      if (!live?.length) return toOptions(fallback);
      return live.filter((i) => i.active !== false).map(toOption);
    };

    const districts = masters?.district?.filter((i) => i.active !== false) ?? null;

    return {
      loading: query.isLoading,
      /** True when these came from the database rather than the built-in file. */
      live: Boolean(masters?.state?.length),

      states: pick('state', fallbackStates),
      genders: pick('gender', fallbackGender),
      relations: pick('relation', fallbackRelations),
      paymentMethods: pick('paymentMethod', fallbackMethods),
      closingTypes: pick('closingType', fallbackClosingTypes),
      jatis: pick('jati', []),
      designations: pick('designation', []),

      /**
       * Districts for one state.
       *
       * The master list is flat with a `parent` on each entry; the built-in
       * file is keyed by state. Both are answered the same way here so no form
       * has to know which one it got.
       */
      districtsFor(stateValue) {
        if (!stateValue) return [];
        if (districts) {
          return districts
            .filter((d) => d.parent === stateValue)
            .map(toOption);
        }
        return toOptions(districtsByState?.[stateValue] ?? []);
      },
    };
  }, [masters, query.isLoading]);
}

const toOption = (i) => ({
  value: i.value,
  label: i.label || i.labelEn || i.value,
});

const toOptions = (list) =>
  (list ?? []).map((o) => ({
    value: o.value,
    label: o.label ?? o.label_en ?? o.value,
  }));
