'use client';

import { useEffect, useState } from 'react';

/**
 * A value that stops changing for `delay` ms before it is reported.
 *
 * The collection report works out what every member owes for the selected
 * closings — on a 5,000-member trust that is millions of comparisons against the
 * closings index, every single time it runs. Typing a name into a search box
 * keystroke by keystroke means ten of those derivations to find one person, and
 * somebody is standing at the counter waiting for it.
 *
 * So the box keeps every keystroke (the letters must appear at once — that is
 * what makes typing feel fast) and only the QUERY waits. Three hundred
 * milliseconds is long enough to finish a word and short enough that the name
 * is on screen before the hand leaves the keyboard.
 */
export function useDebounced(value, delay = 300) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    // Nothing to wait for: the value has already caught up, so running a timer
    // would only delay a later change by a needless `delay` ms.
    if (settled === value) return undefined;

    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);

  return settled;
}
