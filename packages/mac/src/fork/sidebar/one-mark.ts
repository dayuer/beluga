/**
 * The sidebar row's trailing marks: one of them shows, the rest wait for hover or the row's detail
 * (fork; docs/calm/finish.md §2, M8 BLG-251). Upstream draws each mark on its own (a needs edge, a
 * count, a live dot, a money pill, a team badge, a clock), so a busy project row showed four at
 * once. This file is only the rule: which kind a mark is, which kind wins, and which marks to hide.
 * It is plain data and plain functions, so the test hands it objects; the DOM hook comes with
 * BLG-243, which draws the hiding through sidebar-look.css.
 *
 * Order, strongest first: status (the row is changing: show its "Archiving…" text), needs you,
 * problem (conflict or failing checks), count, working (the live dot), money, team, quiet (a clock
 * or a git dot). Problems rank under needs you as the brief says; "working" ranks above money so a
 * running row says it is running rather than how much it earned.
 */

export type MarkKind = 'status' | 'needs' | 'problem' | 'count' | 'working' | 'money' | 'team' | 'quiet';

/** Strongest first. A kind's rank is its index here. */
export const MARK_ORDER: readonly MarkKind[] = ['status', 'needs', 'problem', 'count', 'working', 'money', 'team', 'quiet'];

/**
 * Upstream anchors, by kind. Each is a selector on the mark's own element. Checked against upstream
 * source by tests/fork-sidebar-anchors.test.ts, so a sync that renames one fails there.
 */
export const MARKS: ReadonlyArray<{ kind: MarkKind; selector: string }> = [
  { kind: 'status', selector: '[data-archiving]' },
  { kind: 'status', selector: "[class*='_making_']" },
  { kind: 'needs', selector: "[data-signal='needs']:not([class*='_markProblem_'])" },
  { kind: 'problem', selector: "[class*='_markProblem_']" },
  { kind: 'count', selector: "[data-signal='unread']" },
  { kind: 'count', selector: "[data-tally] [class*='_badge_']" },
  { kind: 'count', selector: "[class*='_count_']" },
  { kind: 'working', selector: "[data-signal='working']" },
  { kind: 'working', selector: '[data-busy]' },
  { kind: 'money', selector: '[data-earnings-pill]' },
  { kind: 'team', selector: "button[aria-label^='Team on']" },
  { kind: 'quiet', selector: "[data-signal='later']" },
  { kind: 'quiet', selector: '[data-scheduled]' },
  { kind: 'quiet', selector: '[data-driven-by]' },
  { kind: 'quiet', selector: "[class*='_mark_']:not([data-signal])" },
];

/** The attribute settleMarks sets on a mark it hides. sidebar-look.css hides it (BLG-243). */
export const HIDDEN_ATTR = 'data-fork-mark-hidden';

/** What settleMarks needs of a mark: a DOM element has all of it (the test hands it plain objects). */
export interface MarkLike {
  matches(selector: string): boolean;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** The rank of a kind (lower is stronger). */
export const rankOf = (kind: MarkKind): number => MARK_ORDER.indexOf(kind);

/** Which of the marks in a row wins: the index of the strongest kind (the first on a tie), -1 when there are none. */
export function pickMark(kinds: readonly MarkKind[]): number {
  let best = -1;
  kinds.forEach((kind, i) => {
    if (best < 0 || rankOf(kind) < rankOf(kinds[best]!)) best = i;
  });
  return best;
}

/** The kind of one mark element, by the first anchor it matches (MARKS is in rank order); undefined when none does: such a mark is left alone. */
export function kindOf(mark: MarkLike): MarkKind | undefined {
  return [...MARKS].sort((a, b) => rankOf(a.kind) - rankOf(b.kind)).find((m) => mark.matches(m.selector))?.kind;
}

/**
 * Settles one row's marks: the recognised ones compete, the strongest stays, the others get
 * HIDDEN_ATTR. The hiding of the last pass is taken back first, so a row never keeps a mark hidden
 * after the stronger one went away. Marks nothing recognises are not touched.
 */
export function settleMarks(marks: readonly MarkLike[]): void {
  for (const mark of marks) mark.removeAttribute(HIDDEN_ATTR);
  const known = marks.map((mark) => ({ mark, kind: kindOf(mark) })).filter((x): x is { mark: MarkLike; kind: MarkKind } => x.kind !== undefined);
  const keep = pickMark(known.map((x) => x.kind));
  known.forEach((x, i) => {
    if (i !== keep) x.mark.setAttribute(HIDDEN_ATTR, '');
  });
}
