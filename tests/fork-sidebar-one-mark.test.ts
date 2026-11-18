import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HIDDEN_ATTR, MARK_ORDER, type MarkKind, MARKS, type MarkLike, kindOf, pickMark, settleMarks } from '../packages/mac/src/fork/sidebar/one-mark.js';

/** A mark with the anchors it matches and the attributes settleMarks sets. */
function mark(...selectors: string[]): MarkLike & { attrs: Set<string> } {
  const attrs = new Set<string>();
  return {
    attrs,
    matches: (sel) => selectors.includes(sel),
    hasAttribute: (name) => attrs.has(name),
    setAttribute: (name) => attrs.add(name),
    removeAttribute: (name) => attrs.delete(name),
  };
}

const NEEDS = "[data-signal='needs']:not([class*='_markProblem_'])";
const PROBLEM = "[class*='_markProblem_']";
const COUNT = "[data-signal='unread']";
const WORKING = "[data-signal='working']";
const MONEY = '[data-earnings-pill]';
const QUIET = "[data-signal='later']";

describe('pickMark', () => {
  it('returns the strongest kind, the first one on a tie, and -1 for none', () => {
    expect(pickMark([])).toBe(-1);
    expect(pickMark(['money', 'count', 'needs'])).toBe(2);
    expect(pickMark(['count', 'count'])).toBe(0);
    expect(pickMark(['quiet', 'team'])).toBe(1);
  });

  it('ranks status first and quiet last, in the order the brief names', () => {
    expect(MARK_ORDER).toEqual(['status', 'needs', 'problem', 'count', 'working', 'money', 'team', 'quiet'] satisfies MarkKind[]);
    expect(pickMark(MARK_ORDER.slice().reverse())).toBe(MARK_ORDER.length - 1);
  });
});

describe('kindOf', () => {
  it('maps a mark to its kind by its anchor, and leaves an unknown one alone', () => {
    expect(kindOf(mark(NEEDS))).toBe('needs');
    expect(kindOf(mark(PROBLEM))).toBe('problem');
    expect(kindOf(mark(MONEY))).toBe('money');
    expect(kindOf(mark('[data-something-else]'))).toBeUndefined();
  });

  it('takes the stronger kind when a mark matches two anchors', () => {
    expect(kindOf(mark(COUNT, WORKING))).toBe('count');
  });
});

describe('settleMarks', () => {
  it('leaves only the strongest of bob-api’s four marks: the amber needs-you edge', () => {
    const needs = mark(NEEDS);
    const count = mark(COUNT);
    const working = mark(WORKING);
    const money = mark(MONEY);
    settleMarks([count, working, money, needs]);
    expect([needs, count, working, money].map((m) => m.attrs.has(HIDDEN_ATTR))).toEqual([false, true, true, true]);
  });

  it('shows the count once the needs-you mark is gone', () => {
    const count = mark(COUNT);
    const working = mark(WORKING);
    const money = mark(MONEY);
    settleMarks([count, working, money]);
    expect(count.attrs.has(HIDDEN_ATTR)).toBe(false);
    expect(working.attrs.has(HIDDEN_ATTR)).toBe(true);
    expect(money.attrs.has(HIDDEN_ATTR)).toBe(true);
  });

  it('takes back last pass’s hiding: a stronger mark that left brings the others back', () => {
    const needs = mark(NEEDS);
    const count = mark(COUNT);
    settleMarks([needs, count]);
    expect(count.attrs.has(HIDDEN_ATTR)).toBe(true);
    settleMarks([count]);
    expect(count.attrs.has(HIDDEN_ATTR)).toBe(false);
    expect(needs.attrs.has(HIDDEN_ATTR)).toBe(false);
  });

  it('does not touch a mark nothing recognises, and keeps a quiet mark when it is the only one', () => {
    const unknown = mark('[data-other]');
    const quiet = mark(QUIET);
    settleMarks([unknown, quiet]);
    expect(unknown.attrs.size).toBe(0);
    expect(quiet.attrs.has(HIDDEN_ATTR)).toBe(false);
  });

  it('marks a problem above a count, and a count above money', () => {
    const problem = mark(PROBLEM);
    const count = mark(COUNT);
    const money = mark(MONEY);
    settleMarks([money, count, problem]);
    expect([problem, count, money].map((m) => m.attrs.has(HIDDEN_ATTR))).toEqual([false, true, true]);
  });
});

describe('MARKS', () => {
  it('lists every kind at least once, and nothing outside MARK_ORDER', () => {
    expect(new Set(MARKS.map((m) => m.kind))).toEqual(new Set(MARK_ORDER));
  });

  it('is in rank order (kindOf takes the first anchor that matches)', () => {
    const ranks = MARKS.map((m) => MARK_ORDER.indexOf(m.kind));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('the hiding and the hover that brings marks back (sidebar-look.css)', () => {
  const look = readFileSync(path.join('packages', 'mac', 'src', 'fork', 'sidebar', 'sidebar-look.css'), 'utf8');
  it('hides the settled-out marks only with calm on, and shows them again on hover or keyboard focus, except on a row whose tools open there', () => {
    // Hidden while the row is neither hovered nor focused (the row itself or something in it), never brought back with `revert`.
    expect(look).toContain(":root[data-calm] [data-fork-sidebar] [role='button']:not(:hover, :focus-visible, :has(:focus-visible)) [data-fork-mark-hidden],");
    expect(look).toContain(":root[data-calm] [data-fork-sidebar] [role='button']:has([class*='_hoverTools_'] > button, [class*='_hoverTools_'] > [data-state]) [data-fork-mark-hidden] {\n  display: none;");
    expect(look).not.toMatch(/data-fork-mark-hidden[^{]*\{\s*display: revert/);
  });
});
