import { describe, expect, it } from 'vitest';
import type { PlanEvent } from '../src/core/plans/model.js';
import { feedOf } from '../packages/mac/src/plans/plans-model.js';

/** Fork (plan roles): the plan page's feed for who does each part. Moved out of tests/mac-plans.test.ts (min-conflict). */
describe('the plan’s feed and its roles (fork)', () => {
  it('the feed shows who does each part changing and what’s hard handed to the fix agent (fork, BLG-125)', () => {
    const ev = (text: string, at: number): PlanEvent => ({ id: `e${at}`, at, by: { kind: 'beluga' }, kind: 'note', text });
    const items = feedOf([ev('gave its checks to Claude (Opus) from here on', 1), ev('handed the conflict to Claude (Opus)', 2), ev('runs the test suites only at the end, in the final step', 3), ev('the architect of “x” ended its turn without a design: asked for it again', 4)]);
    expect(items.map((i) => i.text)).toEqual(['runs the test suites only at the end, in the final step', 'handed the conflict to Claude (Opus)', 'gave its checks to Claude (Opus) from here on']);
  });
});
