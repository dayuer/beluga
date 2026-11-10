import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Plan } from '../src/core/plans/model.js';
import { Store, initialState } from '../src/core/store.js';
import type { DaemonUp } from '../src/net/studio/handler.js';
import { opKey } from '../src/studio/actions.js';
import { StudioInbox, type ChatPlug, type GatePlug, type InboxExec, type InboxPlugs } from '../src/studio/inbox.js';
import { refOf, type StudioConfig } from '../src/studio/keys.js';
import type { Deliver } from '../src/studio/link.js';
import type { StudioAction, StudioReceipt } from '../src/studio/protocol.js';
import type { Project } from '../src/workspaces/types.js';

/**
 * BLG-73: the inbox (docs/studio-gates.md §2). The real store, the real whitelist, a fake plan
 * executor and a file on disk. The wire order (hello → full snapshot → synced → deliver) is
 * tests/studio-link.test.ts's; here an action is handed over only the way the link hands it over
 * after `synced`, and what this file proves is what happens from there: arrival order, at most
 * once (also after a restart), the codes, and the receipts.
 */

const REF_KEY = Buffer.alloc(32, 7).toString('base64url');
const DAY = 24 * 60 * 60 * 1000;
const PROJECT_REF = refOf(REF_KEY, 'project', 'p1');
const PLAN_REF = refOf(REF_KEY, 'plan', 'pl1');

const project = (id: string, name: string): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces: [] }) as Project;

const DRAFT = {
  title: 'Shop',
  goal: 'Sell coffee online.',
  milestones: [
    {
      id: 'm1',
      title: 'Sign in',
      criteria: ['works'],
      tasks: [{ id: 't1', title: 'Sign-in form', acceptance: ['works'], blockedBy: [], issueId: 'i1', estimate: 3 }],
    },
  ],
};

const planOf = (over: Partial<Plan> = {}): Plan => ({
  id: 'pl1',
  projectId: 'p1',
  home: 'ws:home',
  status: 'active',
  draft: DRAFT,
  draftRev: 3,
  autonomy: 'gated',
  maxParallel: 3,
  paused: false,
  testsAt: 'end',
  runs: {},
  activity: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

function config(shared = ['p1']): StudioConfig {
  return {
    v: 1,
    hub: 'http://localhost:8787',
    studioId: 'st1',
    daemonId: 'dn1',
    name: 'Mac',
    linkedAt: 0,
    key: 'unused',
    refKey: REF_KEY,
    projects: Object.fromEntries(shared.map((id) => [id, { since: 0 }])),
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beluga-studio-inbox-'));
  dirs.push(dir);
  return dir;
}

interface FakeExec extends InboxExec {
  readonly calls: string[];
  nextPlan: number;
}

function fakeExec(): FakeExec {
  const calls: string[] = [];
  const exec: FakeExec = {
    calls,
    nextPlan: 1,
    createPlan: async (projectId: string, goal: string) => {
      calls.push(`create:${projectId}:${goal.includes('<<客户的话') ? 'wrapped' : 'bare'}`);
      return { planId: `p-new-${exec.nextPlan++}` };
    },
    verify: async (id: string) => void calls.push(`verify:${id}`),
    pass: (id: string, m: string) => void calls.push(`pass:${id}:${m}`),
    sendBack: (id: string, m: string, note: string) => void calls.push(`sendBack:${id}:${m}:${note.includes('<<客户的话') ? 'wrapped' : 'bare'}`),
    discard: (id: string) => void calls.push(`discard:${id}`),
    answer: (qid: string, a: { kind: 'answers'; answers: Record<string, string> }) => void calls.push(`answer:${qid}:${JSON.stringify(a.answers)}`),
  };
  return exec;
}

interface FakeGates extends GatePlug {
  readonly requests: Array<{ planId: string; kind: string; draftRev: number; opId: string; by?: string }>;
}

function fakeGates(): FakeGates {
  const requests: FakeGates['requests'] = [];
  return {
    requests,
    request(plan, kind, draftRev, opId, by) {
      requests.push({ planId: plan.id, kind, draftRev, opId, ...(by ? { by } : {}) });
      return undefined;
    },
    needs: () => [],
  };
}

interface FakeChat extends ChatPlug {
  readonly accepted: Array<{ planId: string; opId: string; text: string }>;
}

function fakeChat(): FakeChat {
  const accepted: FakeChat['accepted'] = [];
  return {
    accepted,
    accept(plan, opId, text) {
      accepted.push({ planId: plan.id, opId, text });
      return undefined;
    },
  };
}

interface World {
  readonly store: Store;
  inbox: StudioInbox;
  readonly exec: FakeExec;
  readonly gates: FakeGates;
  readonly chat: FakeChat;
  readonly sent: StudioReceipt[];
  readonly file: string;
  online: boolean;
  readonly deliver: (action: unknown, projectRef?: string) => void;
}

function world(d: { file?: string; now?: () => number; plans?: Plan[]; shared?: string[]; plugs?: Partial<InboxPlugs> } = {}): World {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project('p1', 'shop'), project('p2', 'other')] });
  store.dispatch({ type: 'plans_init', state: { enabled: true, plans: d.plans ?? [planOf()], style: '' } });
  const exec = fakeExec();
  const gates = (d.plugs?.gates as FakeGates | undefined) ?? fakeGates();
  const chat = (d.plugs?.chat as FakeChat | undefined) ?? fakeChat();
  const file = d.file ?? join(tempDir(), 'studio-inbox.json');
  let seq = 0;
  const state: World = {
    store,
    exec,
    gates,
    chat,
    sent: [],
    file,
    online: true,
    inbox: undefined as unknown as StudioInbox,
    deliver(action, projectRef = PROJECT_REF) {
      state.inbox.deliver({ t: 'deliver', seq: seq++, project: projectRef, action: action as StudioAction } as Deliver);
    },
  };
  state.inbox = new StudioInbox({
    store,
    config: () => config(d.shared),
    exec,
    plugs: {
      gates,
      chat,
      decisions:
        d.plugs?.decisions ??
        (() => ({
          'd-m0-t0': {
            audience: 'customer' as const,
            open: true,
            qid: 'decide:pl1:t1',
            question: 'Which store?',
            options: { o0: 'Our own', o1: 'Stripe' },
            multi: false,
          },
        })),
    },
    send: (frame: DaemonUp) => {
      if (!state.online) return false;
      state.sent.push(frame as StudioReceipt);
      return true;
    },
    file,
    now: d.now ?? (() => 1_000),
  });
  return state;
}

const until = async (check: () => boolean, ms = 2_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** How many opId receipts the inbox has on disk: the action is done once it is written. */
const opsOnDisk = (file: string): number => {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { ops?: unknown[] };
    return saved.ops?.length ?? 0;
  } catch {
    return 0;
  }
};

const id = (): string => crypto.randomUUID();
const action = (kind: string, payload: Record<string, unknown>, planRef?: string): Record<string, unknown> => ({
  t: 'action',
  opId: id(),
  kind,
  ...(planRef ? { planRef } : {}),
  payload,
});

describe('the studio inbox (BLG-73)', () => {
  it('runs queued actions one at a time, in arrival order, and answers each with a receipt', async () => {
    const w = world();
    const first = action('plan.verify', {}, PLAN_REF);
    const second = action('plan.verify', {}, PLAN_REF);
    const third = action('plan.verify', {}, PLAN_REF);
    w.deliver(first);
    w.deliver(second);
    w.deliver(third);
    await until(() => w.sent.length === 3);
    expect(w.exec.calls).toEqual(['verify:pl1', 'verify:pl1', 'verify:pl1']);
    expect(w.sent.map((r) => [r.opId, r.state])).toEqual([
      [first.opId, 'done'],
      [second.opId, 'done'],
      [third.opId, 'done'],
    ]);
  });

  it('runs an opId once, even when the hub sends it twice', async () => {
    const w = world();
    const a = action('plan.verify', {}, PLAN_REF);
    w.deliver(a);
    w.deliver(a);
    await until(() => w.sent.length === 2);
    expect(w.exec.calls).toEqual(['verify:pl1']);
    expect(w.sent[0]).toEqual(w.sent[1]);
  });

  it('keeps its records across a restart: a replay answers from the file and runs nothing', async () => {
    const file = join(tempDir(), 'studio-inbox.json');
    const a = action('plan.verify', {}, PLAN_REF);
    const first = world({ file });
    first.deliver(a);
    await until(() => first.sent.length === 1);
    expect(first.exec.calls).toEqual(['verify:pl1']);

    const second = world({ file });
    second.deliver(a);
    await until(() => second.sent.length === 1);
    expect(second.exec.calls).toEqual([]);
    expect(second.sent[0]).toEqual(first.sent[0]);
  });

  it('answers already-done for an execution a restart interrupted, and runs nothing', async () => {
    const file = join(tempDir(), 'studio-inbox.json');
    const a = action('plan.verify', {}, PLAN_REF);
    const key = opKey({ studio: 'st1', project: PROJECT_REF, plan: PLAN_REF }, a.opId as string);
    writeFileSync(file, JSON.stringify({ v: 1, ops: [], pending: [[key, { at: 1_000 }]], gates: [], chat: [] }));
    const w = world({ file });
    w.deliver(a);
    await until(() => w.sent.length === 1);
    expect(w.exec.calls).toEqual([]);
    expect(w.sent[0]).toMatchObject({ opId: a.opId, state: 'refused', code: 'already-done' });
  });

  it('replays on day 13 but has pruned the receipt by day 15', async () => {
    const file = join(tempDir(), 'studio-inbox.json');
    const a = action('plan.verify', {}, PLAN_REF);
    const first = world({ file, now: () => 1_000 });
    first.deliver(a);
    await until(() => first.sent.length === 1);

    const day13 = world({ file, now: () => 1_000 + 13 * DAY });
    day13.deliver(a);
    await until(() => day13.sent.length === 1);
    expect(day13.exec.calls).toEqual([]);

    const day15 = world({ file, now: () => 1_000 + 15 * DAY });
    day15.deliver(a);
    await until(() => day15.sent.length === 1);
    expect(day15.exec.calls).toEqual(['verify:pl1']);
  });

  it('records a receipt it could not send, and replays it when the link is back (never running it twice)', async () => {
    const w = world();
    w.online = false;
    const a = action('plan.verify', {}, PLAN_REF);
    w.deliver(a);
    // The action is done (its receipt is on disk) even though the link couldn't take the receipt.
    await until(() => opsOnDisk(w.file) === 1);
    expect(w.exec.calls).toEqual(['verify:pl1']);
    expect(w.sent).toEqual([]);

    w.online = true;
    w.deliver(a);
    await until(() => w.sent.length === 1);
    expect(w.exec.calls).toEqual(['verify:pl1']);
    expect(w.sent[0]).toMatchObject({ opId: a.opId, state: 'done' });
  });

  it('refuses with a code: a kind outside the whitelist, a stale draftRev, an unknown plan, a plan outside the project', async () => {
    const w = world();
    const outside = { ...action('plans.approve', {}, PLAN_REF), kind: 'plans.approve' };
    const stale = action('plan.requestStart', { draftRev: 2 }, PLAN_REF);
    const unknown = action('chat.send', { text: 'hello' }, refOf(REF_KEY, 'plan', 'gone'));
    const otherProject = action('chat.send', { text: 'hello' }, PLAN_REF);
    w.deliver(outside);
    w.deliver(stale);
    w.deliver(unknown);
    w.deliver(otherProject, refOf(REF_KEY, 'project', 'p2'));
    await until(() => w.sent.length === 4);
    expect(w.sent.map((r) => r.code)).toEqual(['not-allowed', 'stale', 'unknown-plan', 'not-yours']);
    expect(w.exec.calls).toEqual([]);
    expect(w.chat.accepted).toEqual([]);
  });

  it('refuses a plan.create that carries the operator’s own settings', async () => {
    const w = world();
    const a = action('plan.create', { goal: 'A shop', platforms: ['web'], autonomy: 'autopilot' });
    w.deliver(a);
    await until(() => w.sent.length === 1);
    expect(w.sent[0]).toMatchObject({ state: 'refused', code: 'bad-args' });
    expect(w.exec.calls).toEqual([]);
  });

  it('creates a plan with the wrapped customer goal and the new plan’s ref in the receipt', async () => {
    const w = world();
    const a = action('plan.create', { goal: 'A coffee shop', platforms: ['ios', 'web'] });
    w.deliver(a);
    await until(() => w.sent.length === 1);
    expect(w.exec.calls).toEqual(['create:p1:wrapped']);
    expect(w.sent[0]).toMatchObject({ opId: a.opId, state: 'done', planRef: refOf(REF_KEY, 'plan', 'p-new-1') });
  });

  it('queues a chat message as the customer’s raw words, and a decision as questions.answer', async () => {
    const w = world();
    const chat = action('chat.send', { text: 'Please use a blue header' }, PLAN_REF);
    const answer = action('decision.answer', { decisionId: 'd-m0-t0', picks: ['o1'] }, PLAN_REF);
    w.deliver(chat);
    w.deliver(answer);
    await until(() => w.sent.length === 2);
    expect(w.chat.accepted).toEqual([{ planId: 'pl1', opId: chat.opId, text: 'Please use a blue header' }]);
    expect(w.exec.calls).toEqual([`answer:decide:pl1:t1:${JSON.stringify({ 'Which store?': 'Stripe' })}`]);
    expect(w.sent.map((r) => r.state)).toEqual(['done', 'done']);
  });

  it('turns a start request into a Gate (never a plans.* call) and answers done', async () => {
    const w = world();
    const a = action('plan.requestStart', { draftRev: 3 }, PLAN_REF);
    w.deliver(a);
    await until(() => w.sent.length === 1);
    expect(w.gates.requests).toEqual([{ planId: 'pl1', kind: 'start', draftRev: 3, opId: a.opId }]);
    expect(w.exec.calls).toEqual([]);
    expect(w.sent[0]).toMatchObject({ opId: a.opId, state: 'done', planRef: PLAN_REF });
  });

  it('does not submit to a plan that is not shared with the studio', async () => {
    const w = world({ shared: [] });
    const a = action('plan.verify', {}, PLAN_REF);
    w.deliver(a);
    await until(() => w.sent.length === 1);
    expect(w.sent[0]).toMatchObject({ state: 'refused', code: 'not-yours' });
    expect(w.exec.calls).toEqual([]);
  });

  it('reads its own file back (a corrupt file is simply no records)', () => {
    const dir = tempDir();
    const file = join(dir, 'studio-inbox.json');
    writeFileSync(file, 'not json');
    const w = world({ file });
    expect(w.inbox.gateNeeds()).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('not json');
  });
});
