import type { KeyboardEvent } from 'react';
import { typeahead } from '../components/select-model.js';
import { useTypeahead } from '../components/select-parts.js';

/**
 * Typing a name in a list jumps to it, as in Finder and every Mac list: letters typed together
 * find the first name starting with them; the same letter again goes on to the next one.
 * Returns a key handler for the list: given the names in order and where the cursor is, it
 * says which row to go to (-1: none, the key isn't one, or nothing starts with it).
 */
export function useListTypeahead(): (e: KeyboardEvent, names: readonly string[], from: number) => number {
  const type = useTypeahead();
  return (e, names, from) => {
    // A character with no modifier (Space keeps its own meaning: Quick Look, a press).
    if (e.key.length !== 1 || e.key === ' ' || e.metaKey || e.ctrlKey || e.altKey) return -1;
    const at = typeahead(
      names.map((name) => ({ value: name, label: name })),
      type(e.key),
      from,
    );
    if (at >= 0) e.preventDefault();
    return at;
  };
}
