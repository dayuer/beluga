import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Issue, IssueStatus } from '../src/core/board/model.js';
import type { Field, SharedTask } from '../src/core/team/crdt.js';
import { type EligibleCtx, assignerOf, eligible } from '../src/fork/federation/eligible.js';
import type { TrustLevel } from '../src/shared/settings-schema.js';

/** Auto accept's rules (BLG-222): each one alone stops a task, the giver read off the board. */

const ME = 'me00000000000001';
const BOB = 'bob0000000000002';
const ANN = 'ann0000000000003';

const field = (v: unknown, a: string, l = 5): Field => ({ v, a, l });

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: 't1',
    key: 'BLG-1',
    number: 1,
    projectId: 'p',
    title: 'Do it',
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: { kind: 'person', id: ME, name: 'Me' },
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
    createdBy: { kind: 'person', id: BOB, name: 'Bob' },
    origin: 'manual',
    ...over,
  } as Issue;
}

function shared(fields: Record<string, Field> = {}): SharedTask {
  return { id: 't1', fields: { assignee: field({ kind: 'person', id: ME, name: 'Me' }, BOB), ...fields }, acts: [] };
}

function ctx(over: Partial<EligibleCtx> = {}, task: SharedTask | null = shared(), levels: Record<string, TrustLevel> = { [BOB]: 'full', [ANN]: 'trusted' }, statuses: Record<string, IssueStatus> = {}): EligibleCtx {
  return {
    self: ME,
    sharedOf: (id) => (id === 't1' && task ? task : undefined),
    // As core/trust.ts: you always fully trust yourself.
    trustOf: (p) => (p === ME ? 'full' : (levels[p] ?? 'ask')),
    from: 'full',
    running: 0,
    atOnce: 2,
    statusOf: (id) => statuses[id],
    ...over,
  };
}

describe('eligible', () => {
  it('a task a fully trusted teammate gave me, ready and free, starts', () => {
    expect(eligible(issue(), ctx())).toEqual({ ok: true });
  });

  it('1 assignee: given to someone else, or nobody', () => {
    expect(eligible(issue({ assignee: { kind: 'person', id: BOB, name: 'Bob' } }), ctx())).toEqual({ ok: false, why: 'assignee' });
    expect(eligible(issue({ assignee: undefined }), ctx())).toEqual({ ok: false, why: 'assignee' });
  });

  it('2 status: only Ready', () => {
    for (const status of ['backlog', 'in_progress', 'in_review', 'done', 'canceled'] as const) expect(eligible(issue({ status }), ctx())).toEqual({ ok: false, why: 'status' });
  });

  it('3 scope: private, archived or part of a plan', () => {
    expect(eligible(issue({ private: true }), ctx())).toEqual({ ok: false, why: 'scope' });
    expect(eligible(issue({ archivedAt: 5 }), ctx())).toEqual({ ok: false, why: 'scope' });
    expect(eligible(issue({ plan: { id: 'pl', milestone: 'm', task: 'x' } as unknown as Issue['plan'] }), ctx())).toEqual({ ok: false, why: 'scope' });
  });

  it('4 not-team: no shared copy, or no assignee field on it', () => {
    expect(eligible(issue(), ctx({}, null))).toEqual({ ok: false, why: 'not-team' });
    expect(eligible(issue(), ctx({}, { id: 't1', fields: {}, acts: [] }))).toEqual({ ok: false, why: 'not-team' });
  });

  it('5 self-assigned: I gave it to myself, even though I fully trust myself', () => {
    const c = ctx({}, shared({ assignee: field({ kind: 'person', id: ME, name: 'Me' }, ME) }));
    expect(c.trustOf(ME)).toBe('full');
    expect(eligible(issue(), c)).toEqual({ ok: false, why: 'self-assigned' });
  });

  it('6 blocked: a blocker not done or in review, or not found', () => {
    expect(eligible(issue({ blockedBy: ['b1'] }), ctx({}, shared(), undefined, { b1: 'in_progress' }))).toEqual({ ok: false, why: 'blocked' });
    expect(eligible(issue({ blockedBy: ['gone'] }), ctx())).toEqual({ ok: false, why: 'blocked' });
    expect(eligible(issue({ blockedBy: ['b1', 'b2'] }), ctx({}, shared(), undefined, { b1: 'done', b2: 'in_review' }))).toEqual({ ok: true });
  });

  it('7 worktree: already has one', () => {
    expect(eligible(issue({ worktrees: ['ws1'] }), ctx())).toEqual({ ok: false, why: 'worktree' });
  });

  it('8 working: someone else is on it (my own working flag does not count)', () => {
    expect(eligible(issue(), ctx({}, shared({ [`working.${ANN}`]: field(true, ANN) })))).toEqual({ ok: false, why: 'working' });
    expect(eligible(issue(), ctx({}, shared({ [`working.${ANN}`]: field(false, ANN) })))).toEqual({ ok: true });
    expect(eligible(issue(), ctx({}, shared({ [`working.${ME}`]: field(true, ME) })))).toEqual({ ok: true });
  });

  it('9 trust: from full needs full; from trusted takes trusted and full', () => {
    const byAnn = shared({ assignee: field({ kind: 'person', id: ME, name: 'Me' }, ANN) });
    expect(eligible(issue(), ctx({ from: 'full' }, byAnn))).toEqual({ ok: false, why: 'trust' });
    expect(eligible(issue(), ctx({ from: 'trusted' }, byAnn))).toEqual({ ok: true });
    expect(eligible(issue(), ctx({ from: 'trusted' }))).toEqual({ ok: true });
    const byStranger = shared({ assignee: field({ kind: 'person', id: ME, name: 'Me' }, 'zzz') });
    expect(eligible(issue(), ctx({ from: 'trusted' }, byStranger))).toEqual({ ok: false, why: 'trust' });
  });

  it('10 capacity: no more than atOnce at once', () => {
    expect(eligible(issue(), ctx({ running: 2, atOnce: 2 }))).toEqual({ ok: false, why: 'capacity' });
    expect(eligible(issue(), ctx({ running: 1, atOnce: 2 }))).toEqual({ ok: true });
  });

  it('the giver is the board field, no event needed', () => {
    expect(assignerOf(shared())).toBe(BOB);
    expect(assignerOf(undefined)).toBeUndefined();
  });

  it('reads no settings and never imports work.ts', () => {
    const src = readFileSync('src/fork/federation/eligible.ts', 'utf8');
    const imports = src.split('\n').filter((l) => l.startsWith('import'));
    expect(imports.join('\n')).not.toMatch(/board\/work|core\/settings|federation\/settings|settings-fields/);
  });
});
