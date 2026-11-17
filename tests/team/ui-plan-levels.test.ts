import { describe, expect, it } from 'vitest';
import { milestoneLevels } from '../../packages/ui-plan/levels.js';

describe('milestoneLevels (shared by the companion and the customer app)', () => {
  it('draws a chain when a Mac sends no dependsOn', () => {
    expect(milestoneLevels([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual([0, 1, 2]);
  });

  it('puts milestones that wait on nothing in the first column', () => {
    const items = [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: [] },
      { id: 'c', dependsOn: [] },
    ];
    expect(milestoneLevels(items)).toEqual([0, 0, 0]);
  });

  it('follows explicit dependencies and puts parallel branches in one column', () => {
    const items = [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: [] },
      { id: 'c', dependsOn: ['a'] },
      { id: 'd', dependsOn: ['a', 'b'] },
      { id: 'e', dependsOn: ['d'] },
    ];
    expect(milestoneLevels(items)).toEqual([0, 0, 1, 1, 2]);
  });

  it('ignores an unknown dependency', () => {
    expect(milestoneLevels([{ id: 'a', dependsOn: ['missing'] }, { id: 'b', dependsOn: ['a'] }])).toEqual([0, 1]);
  });

  it('does not hang on a cycle', () => {
    const levels = milestoneLevels([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ]);
    expect(levels).toHaveLength(2);
    expect(levels.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
  });
});
