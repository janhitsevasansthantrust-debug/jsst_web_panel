'use client';

import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from './api.js';
import { useActiveProgramId } from './activeProgram.js';
import { fromSearchRow, searchEntries } from './memberSearch.js';

/**
 * Instant member search, in the browser.
 *
 * The searchable list is downloaded once per session and searched locally, so
 * typing costs nothing — no request per keystroke, no debounce compromise, and
 * it keeps working while the connection does not.
 *
 * Above the server's size limit it answers `mode: 'remote'` instead, and this
 * hook falls back to querying the API. The caller does not need to know which
 * happened; `search()` returns members either way.
 */
export function useMemberSearch({ allPrograms = false } = {}) {
  const programId = useActiveProgramId();

  const query = useQuery({
    queryKey: ['members', 'search-index', programId, allPrograms],
    queryFn: () => api.members.searchIndex({ allPrograms: allPrograms || undefined }),
    // The list changes when a member is added, which is rare next to how often
    // someone searches. Ten minutes, and the box falls back to the server for
    // anything it cannot find locally.
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const entries = useMemo(
    () => (query.data?.rows ?? []).map(fromSearchRow),
    [query.data],
  );

  // The scorer caches its folded form on each entry, so keeping the SAME array
  // between renders is what makes the second keystroke faster than the first.
  const ref = useRef(entries);
  if (ref.current !== entries) ref.current = entries;

  const local = query.data?.mode === 'local';

  return {
    ready: query.isSuccess,
    local,
    count: query.data?.count ?? 0,
    loading: query.isLoading,

    /**
     * Members matching `term`, best first.
     *
     * Synchronous when the list is local — which is the point: the results are
     * already there as the character lands.
     */
    search(term, limit = 20) {
      if (!local) return null; // caller falls back to the API
      return searchEntries(ref.current, term, { limit });
    },
  };
}
