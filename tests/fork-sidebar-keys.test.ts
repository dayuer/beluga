import { describe, expect, it } from 'vitest';
import { stepFor } from '../packages/mac/src/fork/sidebar/keys.js';

describe('the sidebar’s arrow keys', () => {
  it('step along the rows and stop at the ends', () => {
    expect(stepFor('ArrowDown', 2, 5)).toBe(3);
    expect(stepFor('ArrowUp', 2, 5)).toBe(1);
    expect(stepFor('ArrowDown', 4, 5)).toBe(4);
    expect(stepFor('ArrowUp', 0, 5)).toBe(0);
  });

  it('go to the first or last row with Home and End, and from nowhere start at an end', () => {
    expect(stepFor('Home', 3, 5)).toBe(0);
    expect(stepFor('End', 1, 5)).toBe(4);
    expect(stepFor('ArrowDown', -1, 5)).toBe(0);
    expect(stepFor('ArrowUp', -1, 5)).toBe(4);
  });

  it('do nothing with no rows', () => {
    expect(stepFor('ArrowDown', -1, 0)).toBe(-1);
  });
});
