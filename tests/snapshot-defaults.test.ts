import { describe, expect, it } from 'vitest';
import { allNeeds } from '../src/companion/needs-you.js';
import { type DomainState, initialState } from '../src/core/store.js';
import { withDefaults } from '../src/ipc/socket-client.js';

/**
 * A paired computer on another version (upstream's 3.6.0 has no Synon Studio) sends a snapshot
 * without the parts it doesn't have. This screen's bell reads them on every computer it watches
 * (machines/remote-attention.ts), and `studio.gates` missing took the whole window down.
 */
const without = (state: DomainState, ...keys: string[]): DomainState => {
  const copy = { ...state } as Record<string, unknown>;
  for (const k of keys) delete copy[k];
  return copy as unknown as DomainState;
};

describe('a snapshot from a daemon of another version', () => {
  it('gets the parts it left out, empty, and keeps everything it sent', () => {
    const theirs = { ...without(initialState('mini'), 'studio', 'plans'), selfId: 'p-mini' } as DomainState;
    expect(() => allNeeds(theirs)).toThrow();
    const filled = withDefaults(theirs);
    expect(filled.studio).toEqual({ shared: [], gates: [] });
    expect(filled.plans).toEqual(initialState('x').plans);
    expect(filled).toMatchObject({ room: 'mini', selfId: 'p-mini' });
    expect(allNeeds(filled)).toEqual([]);
  });

  it('a complete one is passed through as it is', () => {
    const full = initialState('mac');
    expect(withDefaults(full)).toBe(full);
  });
});
