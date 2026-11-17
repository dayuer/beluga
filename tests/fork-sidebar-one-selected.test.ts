import { describe, expect, it } from 'vitest';
import { type Clicked, type RowLike, ownerOf, settleRows } from '../packages/mac/src/fork/sidebar/one-selected.js';

/** The sidebar keeps one selected row (packages/mac/src/fork/sidebar/one-selected.ts). */
describe('one selected row in the sidebar', () => {
  it('has none when no row is selected', () => {
    expect(ownerOf([])).toBe(-1);
  });

  it('keeps the row you clicked, wherever it is', () => {
    // Work (indent 0), the plan under it (1), the same plan in Unread (0): you clicked it in Unread.
    expect(ownerOf([{ indent: 8, clicked: false }, { indent: 22, clicked: false }, { indent: 8, clicked: true }])).toBe(2);
  });

  it('without a click, keeps the most specific row: Work yields to the plan under it', () => {
    expect(ownerOf([{ indent: 8, clicked: false }, { indent: 22, clicked: false }, { indent: 22, clicked: false }])).toBe(1);
  });

  it('keeps the first of equals', () => {
    expect(ownerOf([{ indent: 8, clicked: false }, { indent: 8, clicked: false }])).toBe(0);
  });
});

/** A stand-in for a sidebar row: its class, its indent and its attributes. */
class FakeRow implements RowLike {
  readonly attrs = new Map<string, string>();
  constructor(
    public className: string,
    indent = 0,
    attrs: Record<string, string> = {},
  ) {
    this.style = { paddingLeft: `${8 + indent * 14}px` };
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  readonly style: { paddingLeft: string };
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
}

const SEL = '_row_a1 _selected_b2';
const PLAIN = '_row_a1';
const marks = (rows: FakeRow[]) => rows.map((r) => (r.hasAttribute('data-fork-dup') ? 'dup' : r.getAttribute('aria-current') === 'page' ? 'current' : '-'));

describe('a pass over the rows', () => {
  it('lights one and marks the rest, then takes the marks back when the selection moves', () => {
    const work = new FakeRow(SEL);
    const plan = new FakeRow(SEL, 1);
    const unread = new FakeRow(SEL);
    const other = new FakeRow(PLAIN);
    const rows = [work, plan, unread, other];
    settleRows(rows, null);
    expect(marks(rows)).toEqual(['dup', 'current', 'dup', '-']);

    // You open something else: the three are plain again, nothing left behind.
    work.className = plan.className = unread.className = PLAIN;
    other.className = SEL;
    settleRows(rows, null);
    expect(marks(rows)).toEqual(['-', '-', '-', 'current']);
    expect(rows.filter((r) => r.hasAttribute('data-fork-current'))).toEqual([other]);
  });

  it('leaves a Shift-click selection of chats alone', () => {
    const a = new FakeRow(SEL, 1, { 'data-chat-selected': 'true', 'aria-pressed': 'true' });
    const b = new FakeRow(SEL, 1, { 'data-chat-selected': 'true', 'aria-pressed': 'true' });
    const c = new FakeRow(SEL, 1, { 'aria-pressed': 'true' });
    settleRows([a, b, c], null);
    expect(marks([a, b, c])).toEqual(['-', '-', '-']);
  });

  it('takes a row’s own aria-current away when another row is the current one', () => {
    // Sentinel sets aria-current itself; a sentinel under it is the more specific one.
    const sentinel = new FakeRow(SEL, 0, { 'aria-current': 'page' });
    const one = new FakeRow(SEL, 1);
    settleRows([sentinel, one], null);
    expect(sentinel.getAttribute('aria-current')).toBeNull();
    expect([sentinel, one].filter((r) => r.getAttribute('aria-current') === 'page')).toEqual([one]);
  });

  it('prefers the clicked row until it has been selected and no longer is', () => {
    const projectCopy = new FakeRow(PLAIN, 1);
    const unreadCopy = new FakeRow(PLAIN);
    const rows = [projectCopy, unreadCopy];
    // The click lands before the app has selected anything: it waits.
    let clicked: Clicked<FakeRow> | null = settleRows(rows, { row: unreadCopy, seen: false });
    expect(clicked).toEqual({ row: unreadCopy, seen: false });
    projectCopy.className = unreadCopy.className = SEL;
    clicked = settleRows(rows, clicked);
    expect(marks(rows)).toEqual(['dup', 'current']);
    expect(clicked).toEqual({ row: unreadCopy, seen: true });

    // Somewhere else, then back by ⌘K: the click is forgotten, the more specific copy wins.
    projectCopy.className = unreadCopy.className = PLAIN;
    clicked = settleRows(rows, clicked);
    expect(clicked).toBeNull();
    projectCopy.className = unreadCopy.className = SEL;
    settleRows(rows, clicked);
    expect(marks(rows)).toEqual(['current', 'dup']);
  });
});
