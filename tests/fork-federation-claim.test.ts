import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Issue, IssueStatus } from '../src/core/board/model.js';
import type { Field, SharedTask } from '../src/core/team/crdt.js';
import { CONFIRM_JITTER_MS, CONFIRM_MIN_MS, type ClaimCtx, confirmDelay, pickClaimable, pickPending, stillMine } from '../src/fork/federation/claim.js';
import { eligible } from '../src/fork/federation/eligible.js';
import type { TrustLevel } from '../src/shared/settings-schema.js';

/** The pool (BLG-229): which pool tasks this computer may claim, and which it claimed and hasn't confirmed. */

const ME = 'me00000000000001';
const BOB = 'bob0000000000002';
const ANN = 'ann0000000000003';
const EVE = 'eve0000000000004';

const field = (v: unknown, a: string, l = 5): Field => ({ v, a, l });
const person = (id: string) => ({ kind: 'person' as const, id, name: id.slice(0, 3) });

function task(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id,
    key: `BLG-${id}`,
    number: 1,
    projectId: 'p',
    title: 'Do it',
    status: 'todo',
    priority: 'medium',
    labels: ['pool'],
    assignee: undefined,
    blockedBy: [],
    related: [],
    rank: 1,
    brief: {},
    revisions: [],
    worktrees: [],
    proof: [],
    activity: [],
    createdAt: 1,
    updatedAt: 1,
    createdBy: person(BOB),
    origin: 'manual',
    ...over,
  } as Issue;
}

/** A pool task's shared copy: BOB put the label on; `assignee` when someone claimed it. */
function shared(id: string, fields: Record<string, Field> = {}): SharedTask {
  return { id, fields: { labels: field(['pool'], BOB), ...fields }, acts: [] };
}

/** Pending: claimed by me on the board. */
const mine = (id: string, over: Partial<Issue> = {}) => task(id, { assignee: person(ME), ...over });
const claimedByMe = (id: string, fields: Record<string, Field> = {}) => shared(id, { assignee: field(person(ME), ME), ...fields });

function ctx(tasks: Record<string, SharedTask | undefined>, over: Partial<ClaimCtx> = {}, levels: Record<string, TrustLevel> = { [BOB]: 'full', [ANN]: 'trusted' }, statuses: Record<string, IssueStatus> = {}): ClaimCtx {
  return {
    self: ME,
    sharedOf: (id) => tasks[id],
    trustOf: (p) => (p === ME ? 'full' : (levels[p] ?? 'ask')),
    from: 'full',
    running: 0,
    atOnce: 2,
    statusOf: (id) => statuses[id],
    accept: 'pool',
    poolLabel: 'pool',
    ...over,
  };
}

const ids = (xs: readonly Issue[]) => xs.map((i) => i.id);

describe('pickClaimable', () => {
  it('a pool task nobody has, Ready, is picked', () => {
    expect(ids(pickClaimable([task('a')], ctx({ a: shared('a') })))).toEqual(['a']);
  });

  it.each<[string, Issue, SharedTask | undefined, Record<string, IssueStatus>?]>([
    ['no label', task('a', { labels: ['feature'] }), shared('a')],
    ['someone has it', task('a', { assignee: person(BOB) }), shared('a', { assignee: field(person(BOB), BOB) })],
    ['not todo', task('a', { status: 'backlog' }), shared('a')],
    ['private', task('a', { private: true }), shared('a')],
    ['in a plan', task('a', { plan: { id: 'pl', milestone: 'm', task: 'x' } as unknown as Issue['plan'] }), shared('a')],
    ['a blocker', task('a', { blockedBy: ['b'] }), shared('a'), { b: 'todo' }],
    ['a worktree', task('a', { worktrees: ['ws1'] as unknown as Issue['worktrees'] }), shared('a')],
    ['a teammate working', task('a'), shared('a', { [`working.${BOB}`]: field(true, BOB) })],
    ['labelled by someone not trusted enough', task('a'), { ...shared('a'), fields: { labels: field(['pool'], ANN) } }],
    ['labelled by someone I only ask', task('a'), { ...shared('a'), fields: { labels: field(['pool'], EVE) } }],
    ['not a team task', task('a'), undefined],
  ])('each missing rule leaves it out: %s', (_why, t, s, statuses) => {
    expect(pickClaimable([t], ctx({ a: s }, {}, undefined, statuses))).toEqual([]);
  });

  it('a done blocker does not hold it back', () => {
    expect(ids(pickClaimable([task('a', { blockedBy: ['b'] })], ctx({ a: shared('a') }, {}, undefined, { b: 'done' })))).toEqual(['a']);
  });

  it('one I labelled myself is picked', () => {
    expect(ids(pickClaimable([task('a')], ctx({ a: { ...shared('a'), fields: { labels: field(['pool'], ME) } } })))).toEqual(['a']);
  });

  it('a custom pool label is matched exactly', () => {
    const c = ctx({ a: shared('a'), b: shared('b') }, { poolLabel: 'free' });
    expect(ids(pickClaimable([task('a', { labels: ['free'] }), task('b')], c))).toEqual(['a']);
  });

  it('my own working.<me> flag does not count as a teammate working', () => {
    expect(ids(pickClaimable([task('a')], ctx({ a: shared('a', { [`working.${ME}`]: field(true, ME) }) })))).toEqual(['a']);
  });
});

describe('pickPending', () => {
  it('mine, claimed by me, no worktree, is pending', () => {
    expect(ids(pickPending([mine('a')], ctx({ a: claimedByMe('a') })))).toEqual(['a']);
  });

  it.each<[string, Issue, SharedTask]>([
    ['assignee.a is a teammate', mine('a'), shared('a', { assignee: field(person(ME), BOB) })],
    ['no pool label (a task I gave myself)', mine('a', { labels: [] }), { id: 'a', fields: { assignee: field(person(ME), ME) }, acts: [] }],
    ['a worktree', mine('a', { worktrees: ['ws1'] as unknown as Issue['worktrees'] }), claimedByMe('a')],
    ['not todo', mine('a', { status: 'in_progress' }), claimedByMe('a')],
    ['a teammate working', mine('a'), claimedByMe('a', { [`working.${BOB}`]: field(true, BOB) })],
    ['someone else has it', task('a', { assignee: person(BOB) }), claimedByMe('a')],
    ['nobody has it', task('a'), claimedByMe('a')],
  ])('each broken rule leaves it out: %s', (_why, t, s) => {
    expect(pickPending([t], ctx({ a: s }))).toEqual([]);
  });

  it('pending ones are not limited by places: they already hold them', () => {
    expect(ids(pickPending([mine('a'), mine('b')], ctx({ a: claimedByMe('a'), b: claimedByMe('b') }, { atOnce: 1, running: 1 })))).toEqual(['a', 'b']);
  });
});

describe('the pool, together', () => {
  it.each(['off', 'assigned'] as const)('not pool (%s): both empty', (accept) => {
    const c = ctx({ a: shared('a'), b: claimedByMe('b') }, { accept });
    expect(pickClaimable([task('a'), mine('b')], c)).toEqual([]);
    expect(pickPending([task('a'), mine('b')], c)).toEqual([]);
  });

  it("assigned: a pool task I claimed myself still isn't ok for eligible (self-assigned)", () => {
    expect(eligible(mine('a'), ctx({ a: claimedByMe('a') }, { accept: 'assigned' }))).toEqual({ ok: false, why: 'self-assigned' });
  });

  it('pending holds places: atOnce 2, 1 running, 1 pending → none; room 1 → one', () => {
    const tasks = { p: claimedByMe('p'), a: shared('a'), b: shared('b') };
    const all = [mine('p'), task('a'), task('b')];
    expect(pickClaimable(all, ctx(tasks, { atOnce: 2, running: 1 }))).toEqual([]);
    expect(ids(pickClaimable(all, ctx(tasks, { atOnce: 3, running: 1 })))).toEqual(['a']);
    expect(ids(pickClaimable([task('a'), task('b')], ctx(tasks, { atOnce: 1, running: 0 })))).toEqual(['a']);
    expect(pickClaimable(all, ctx(tasks, { atOnce: 1, running: 3 }))).toEqual([]);
  });

  it('order: priority, then rank', () => {
    const all = [task('low', { priority: 'low', rank: 1 }), task('m2', { rank: 2 }), task('urgent', { priority: 'urgent', rank: 9 }), task('m1', { rank: 1 })];
    const tasks = Object.fromEntries(all.map((t) => [t.id, shared(t.id)]));
    expect(ids(pickClaimable(all, ctx(tasks, { atOnce: 6 })))).toEqual(['urgent', 'm1', 'm2', 'low']);
    expect(ids(pickClaimable(all, ctx(tasks, { atOnce: 2 })))).toEqual(['urgent', 'm1']);
    const pend = all.map((t) => ({ ...t, assignee: person(ME) }));
    const claimed = Object.fromEntries(all.map((t) => [t.id, claimedByMe(t.id)]));
    expect(ids(pickPending(pend, ctx(claimed)))).toEqual(['urgent', 'm1', 'm2', 'low']);
  });

  it('claim.ts has no timers, clocks or randomness', () => {
    const src = readFileSync(new URL('../src/fork/federation/claim.ts', import.meta.url), 'utf8');
    for (const s of ['setTimeout', 'Date.now', 'Math.random']) expect(src).not.toContain(s);
  });
});

describe('confirming a claim', () => {
  it('confirmDelay spans [3000, 7000)', () => {
    expect(CONFIRM_MIN_MS).toBe(3000);
    expect(CONFIRM_MIN_MS + CONFIRM_JITTER_MS).toBe(7000);
    expect(confirmDelay(() => 0)).toBe(3000);
    const top = confirmDelay(() => 0.9999);
    expect(top).toBeGreaterThanOrEqual(6999);
    expect(top).toBeLessThan(7000);
    expect(confirmDelay(() => 0.5)).toBe(5000);
    // A source out of range is held inside it.
    expect(confirmDelay(() => -1)).toBe(3000);
    expect(confirmDelay(() => 1)).toBeLessThan(7000);
    expect(confirmDelay(() => 2)).toBeLessThan(7000);
  });

  it('stillMine: mine / someone else / cleared', () => {
    expect(stillMine(mine('a'), ME)).toBe(true);
    expect(stillMine(task('a', { assignee: person(BOB) }), ME)).toBe(false);
    expect(stillMine(task('a'), ME)).toBe(false);
    expect(stillMine(undefined, ME)).toBe(false);
  });
});
