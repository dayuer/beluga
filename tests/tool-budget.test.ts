import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fitToolBudget, leftOutNote, suiteSize } from '../src/agent/runtime/acp/tool-budget.js';
import { tool, type ToolSuite } from '../src/agent/tool-kit.js';

/** An agent that takes only so many tools (Antigravity's ~42 KB) gets what its run is for first, and is told what was left out. */

const suite = (name: string, tools: number, pad: number): ToolSuite => ({
  name,
  version: '1',
  tools: Array.from({ length: tools }, (_, i) => tool(`t${i}`, 'x'.repeat(pad), { a: z.string() }, async () => ({ content: [] }))),
});

describe('fitting Beluga’s tools to a budget', () => {
  const suites = { beluga_dashboard: suite('beluga_dashboard', 5, 1000), beluga: suite('beluga', 5, 1000), beluga_plan: suite('beluga_plan', 5, 1000), beluga_view: suite('beluga_view', 1, 100) };

  it('offers what the run is for first, then the most useful, as long as they fit', () => {
    const one = suiteSize(suites.beluga);
    const { suites: kept, left } = fitToolBudget(suites, one * 2 + suiteSize(suites.beluga_view), new Set(['beluga_plan']));
    expect(Object.keys(kept)).toEqual(['beluga_plan', 'beluga', 'beluga_view']);
    expect(left).toEqual(['beluga_dashboard']);
  });

  it('never leaves out what the run is for, even past the budget', () => {
    const { suites: kept, left } = fitToolBudget(suites, 10, new Set(['beluga_plan']));
    expect(Object.keys(kept)).toEqual(['beluga_plan']);
    expect(left).toEqual(['beluga', 'beluga_view', 'beluga_dashboard']);
  });

  it('says what it left out, in plain words', () => {
    expect(leftOutNote('Antigravity', ['beluga', 'beluga_dashboard'])).toBe('Antigravity takes only so many tools: Beluga left out its room, dashboard tools for this run');
  });
});
