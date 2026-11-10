import { describe, expect, it } from 'vitest';
import { OPID_KEEP_MS, opKey } from '../../src/studio/actions.js';
import { type EnqueueContext, type QueueDeps, ack, enqueue, expire, prune, take } from '../../src/net/studio/queue.js';
import { DAY_MS, QUEUE_TTL_MS, memoryHub, memoryStudio, type HubStore, type StudioStore } from '../../src/net/studio/store.js';

/** BLG-58: actions wait in order, run once per opId, and are forgotten on schedule. */

const START = 1_768_000_000_000;
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const view = {
  planRef: 'plan1',
  draftRev: 3,
  title: '客户 App',
  goal: '做一个客户能用的 App',
  stage: 'running',
  waitingOn: 'customer',
  headline: '在做：登录',
  progress: { done: 0, total: 2 },
  milestones: [{ ref: 'm0', title: '登录', criteria: ['可以登录'], status: 'review', tasks: [] }],
  decisions: [{ decisionId: 'd-m0-t0', question: '用哪种登录？', options: [{ id: 'o0', label: '邮箱' }, { id: 'o1', label: '手机' }], multi: false, open: true }],
  turns: [],
  typing: false,
  moreTurns: false,
  activity: [],
};

interface World {
  readonly hub: HubStore;
  readonly studio: StudioStore;
  readonly deps: QueueDeps;
  readonly ctx: EnqueueContext;
  advance(ms: number): void;
}

async function setup(): Promise<World> {
  const hub = memoryHub();
  const studio = memoryStudio();
  const clock = { now: START };
  const st = await hub.createStudio({ name: 'Acme', now: clock.now });
  await hub.createCustomer({ id: 'c1', email: 'c1@example.test', name: '客户一', now: clock.now });
  await hub.createProject({ id: 'p1', studioId: st.id, name: '客户 App', now: clock.now });
  await hub.addMember('p1', 'c1', clock.now);
  await hub.createDaemon({ id: 'd1', studioId: st.id, publicKey: 'queue-test-key', name: 'Mac', now: clock.now });
  await hub.replaceDaemonProjects('d1', [{ id: 'dp1', name: 'api' }], clock.now);
  await hub.bindProject({ projectId: 'p1', daemonId: 'd1', daemonProjectId: 'dp1', now: clock.now });
  await studio.putView({ projectId: 'p1', planRef: 'plan1', rev: 1, viewJson: JSON.stringify(view), updatedAt: clock.now });
  await studio.putConn({ daemonId: 'd1', lastAt: clock.now - 1, connectedAt: clock.now, lastSeenAt: clock.now, hello: true, synced: true });
  const deps: QueueDeps = {
    hub,
    studio,
    get now() {
      return clock.now;
    },
  };
  return { hub, studio, deps, ctx: { studio: st.id, projectId: 'p1', customerId: 'c1' }, advance: (ms) => void (clock.now += ms) };
}

const chat = (n: number, text = '你好'): unknown => ({ t: 'action', opId: uuid(n), kind: 'chat.send', planRef: 'plan1', payload: { text } });
const pass = (n: number, draftRev = 3, milestoneRef = 'm0'): unknown => ({ t: 'action', opId: uuid(n), kind: 'milestone.pass', planRef: 'plan1', payload: { milestoneRef, draftRev } });
const apply = (n: number, draftRev = 3): unknown => ({ t: 'action', opId: uuid(n), kind: 'draft.apply', planRef: 'plan1', payload: { draftRev } });
const start = (n: number, draftRev = 3): unknown => ({ t: 'action', opId: uuid(n), kind: 'plan.requestStart', planRef: 'plan1', payload: { draftRev } });
const answer = (n: number, picks: string[]): unknown => ({ t: 'action', opId: uuid(n), kind: 'decision.answer', planRef: 'plan1', payload: { decisionId: 'd-m0-t0', picks } });
const create = (n: number): unknown => ({ t: 'action', opId: uuid(n), kind: 'plan.create', payload: { goal: '做一个预约页面', platforms: ['web'] } });
const verify = (n: number): unknown => ({ t: 'action', opId: uuid(n), kind: 'plan.verify', planRef: 'plan1', payload: {} });

const receiptOf = (r: Awaited<ReturnType<typeof enqueue>>): { state: string; code?: string } => {
  expect(r.ok).toBe(true);
  return r.ok ? { state: r.receipt.state, ...(r.receipt.state === 'refused' ? { code: r.receipt.code } : {}) } : { state: 'no' };
};

describe('an opId runs once', () => {
  it('keeps one queue entry and one receipt, for at least 14 days', async () => {
    const w = await setup();
    expect(receiptOf(await enqueue(chat(1), w.ctx, w.deps))).toEqual({ state: 'queued' });
    expect(receiptOf(await enqueue(chat(1), w.ctx, w.deps))).toEqual({ state: 'queued' });

    const taken = await take('d1', w.deps);
    expect(taken.deliver).toHaveLength(1);
    expect(taken.deliver[0]!.daemonProjectId).toBe('dp1');
    expect(await ack('d1', { t: 'receipt', opId: uuid(1), state: 'done' }, w.deps)).toMatchObject({ ok: true, projectId: 'p1', receipt: { state: 'done' } });

    // Days 8 and 13: the replay still answers with the first result, and nothing runs again.
    w.advance(8 * DAY_MS);
    expect(receiptOf(await enqueue(chat(1), w.ctx, w.deps))).toEqual({ state: 'done' });
    expect((await take('d1', w.deps)).deliver).toHaveLength(0);
    w.advance(13 * DAY_MS);
    expect(receiptOf(await enqueue(chat(1), w.ctx, w.deps))).toEqual({ state: 'done' });

    // Just after 14 days the receipt is pruned; the same opId is a new action then.
    const t = w.deps.now;
    await prune(t + OPID_KEEP_MS + 1, w.deps);
    expect(receiptOf(await enqueue(chat(1), w.ctx, w.deps))).toEqual({ state: 'queued' });
  });

  it('counts a refusal once too, and answers the same way on a retry', async () => {
    const w = await setup();
    const frame = { t: 'action', opId: uuid(2), kind: 'plans.approve', planRef: 'plan1', payload: {} };
    expect(receiptOf(await enqueue(frame, w.ctx, w.deps))).toEqual({ state: 'refused', code: 'not-allowed' });
    expect(receiptOf(await enqueue(frame, w.ctx, w.deps))).toEqual({ state: 'refused', code: 'not-allowed' });
    expect((await take('d1', w.deps)).deliver).toHaveLength(0);
  });
});

describe('the whitelist decides before anything is queued', () => {
  it('refuses an internal method name and bad arguments with their codes', async () => {
    const w = await setup();
    expect(receiptOf(await enqueue({ t: 'action', opId: uuid(3), kind: 'host.answerApproval', planRef: 'plan1', payload: {} }, w.ctx, w.deps))).toEqual({ state: 'refused', code: 'not-allowed' });
    expect(receiptOf(await enqueue({ t: 'action', opId: uuid(4), kind: 'chat.send', planRef: 'plan1', payload: { text: '' } }, w.ctx, w.deps))).toEqual({ state: 'refused', code: 'bad-args' });
    expect(receiptOf(await enqueue({ t: 'action', opId: uuid(5), kind: 'plan.verify', planRef: 'plan1', payload: { thenApprove: true } }, w.ctx, w.deps))).toEqual({ state: 'refused', code: 'bad-args' });
    expect((await take('d1', w.deps)).deliver).toHaveLength(0);
  });
});

describe('project membership and stale drafts', () => {
  it('refuses another customer, a removed customer, and stale acceptance/approval', async () => {
    const w = await setup();
    await w.hub.createCustomer({ id: 'c2', email: 'c2@example.test', name: '客户二', now: w.deps.now });
    expect(await enqueue(chat(10), { ...w.ctx, customerId: 'c2' }, w.deps)).toEqual({ ok: false, status: 403, error: 'not-yours' });

    await w.hub.removeMember('p1', 'c1');
    expect(await enqueue(chat(11), w.ctx, w.deps)).toEqual({ ok: false, status: 403, error: 'not-yours' });
    await w.hub.addMember('p1', 'c1', w.deps.now);
    await w.hub.removeCustomer('c1', w.deps.now);
    expect(await enqueue(chat(12), w.ctx, w.deps)).toEqual({ ok: false, status: 403, error: 'not-yours' });
  });

  it('does not answer an old opId receipt to a customer removed from the project', async () => {
    const w = await setup();
    expect(receiptOf(await enqueue(chat(13), w.ctx, w.deps))).toEqual({ state: 'queued' });
    await w.hub.removeMember('p1', 'c1');
    // Without the membership check first, the replay would return the old `queued` receipt.
    expect(await enqueue(chat(13), w.ctx, w.deps)).toEqual({ ok: false, status: 403, error: 'not-yours' });
  });

  it('refuses stale draftRev with `stale`, and lets the fresh one through', async () => {
    const w = await setup();
    expect(receiptOf(await enqueue(pass(20, 2), w.ctx, w.deps))).toEqual({ state: 'refused', code: 'stale' });
    expect(receiptOf(await enqueue(pass(21, 3), w.ctx, w.deps))).toEqual({ state: 'queued' });
    expect(receiptOf(await enqueue(apply(22, 2), w.ctx, w.deps))).toEqual({ state: 'refused', code: 'stale' });
    expect(receiptOf(await enqueue(apply(23, 3), w.ctx, w.deps))).toEqual({ state: 'queued' });
    // The plan is already running: asking to start is not allowed; the cache says so.
    expect(receiptOf(await enqueue(start(24, 3), w.ctx, w.deps))).toEqual({ state: 'refused', code: 'not-allowed' });
    // A decision can only pick an option it offers.
    expect(receiptOf(await enqueue(answer(25, ['o9']), w.ctx, w.deps))).toEqual({ state: 'refused', code: 'bad-args' });
    expect(receiptOf(await enqueue(answer(26, ['o0']), w.ctx, w.deps))).toEqual({ state: 'queued' });
  });
});

describe('the queue itself', () => {
  it('expires what waited more than seven days and tells the customer', async () => {
    const w = await setup();
    expect(receiptOf(await enqueue(chat(30), w.ctx, w.deps))).toEqual({ state: 'queued' });
    w.advance(QUEUE_TTL_MS);
    expect((await take('d1', w.deps)).expired).toHaveLength(0);
    w.advance(1);
    const taken = await take('d1', w.deps);
    expect(taken.deliver).toHaveLength(0);
    expect(taken.expired).toHaveLength(1);
    expect(taken.expired[0]).toMatchObject({ projectId: 'p1', receipt: { opId: uuid(30), state: 'expired' } });
    expect(receiptOf(await enqueue(chat(30), w.ctx, w.deps))).toEqual({ state: 'expired' });
  });

  it('takes in arrival order, only when the daemon is synced', async () => {
    const w = await setup();
    for (const n of [40, 41, 42]) expect(receiptOf(await enqueue(chat(n), w.ctx, w.deps))).toEqual({ state: 'queued' });
    const taken = await take('d1', w.deps);
    expect(taken.deliver.map((d) => d.action.opId)).toEqual([uuid(40), uuid(41), uuid(42)]);
    expect(taken.deliver.map((d) => d.seq)).toEqual([1, 2, 3]);
    expect((await take('d1', w.deps)).deliver).toHaveLength(0);

    // A daemon that hasn't pushed its views yet gets nothing.
    const w2 = await setup();
    await w2.studio.putConn({ daemonId: 'd1', lastAt: w2.deps.now, connectedAt: w2.deps.now, lastSeenAt: w2.deps.now, hello: true, synced: false });
    await enqueue(chat(43), w2.ctx, w2.deps);
    expect((await take('d1', w2.deps)).deliver).toHaveLength(0);
  });

  it('settles on the daemon receipt and answers a second one with bad-receipt', async () => {
    const w = await setup();
    await enqueue(chat(50), w.ctx, w.deps);
    await take('d1', w.deps);
    const done = await ack('d1', { t: 'receipt', opId: uuid(50), state: 'done' }, w.deps);
    expect(done).toMatchObject({ ok: true, projectId: 'p1', receipt: { state: 'done' } });
    expect(await ack('d1', { t: 'receipt', opId: uuid(50), state: 'done' }, w.deps)).toEqual({ ok: false, error: 'bad-receipt' });

    await enqueue(chat(51), w.ctx, w.deps);
    await take('d1', w.deps);
    expect(await ack('d1', { t: 'receipt', opId: uuid(51), state: 'refused', code: 'stale' }, w.deps)).toMatchObject({ ok: true, receipt: { state: 'refused', code: 'stale' } });
    // The daemon never sends `queued`; the hub makes that one.
    await enqueue(chat(52), w.ctx, w.deps);
    await take('d1', w.deps);
    expect(await ack('d1', { t: 'receipt', opId: uuid(52), state: 'queued' }, w.deps)).toEqual({ ok: false, error: 'bad-receipt' });
  });

  it('expires on its own and keeps a queue row for a plan that is not mapped yet', async () => {
    const w = await setup();
    await w.hub.createProject({ id: 'p2', studioId: w.ctx.studio, name: '未映射', now: w.deps.now });
    await w.hub.addMember('p2', 'c1', w.deps.now);
    expect(receiptOf(await enqueue(create(60), { ...w.ctx, projectId: 'p2' }, w.deps))).toEqual({ state: 'refused', code: 'not-yours' });
    // p1 is mapped: a new plan can be created there.
    expect(receiptOf(await enqueue(create(61), w.ctx, w.deps))).toEqual({ state: 'queued' });
    const taken = await take('d1', w.deps);
    expect(taken.deliver.map((d) => d.action.kind)).toContain('plan.create');
  });

  it('limits a customer per plan: 20 a minute, 300 a day, 50 000 characters a day', async () => {
    const w = await setup();
    for (let i = 0; i < 20; i++) expect(receiptOf(await enqueue(chat(100 + i, 'hi'), w.ctx, w.deps))).toEqual({ state: 'queued' });
    expect(receiptOf(await enqueue(chat(130, 'over'), w.ctx, w.deps))).toEqual({ state: 'refused', code: 'rate-limited' });

    const chars = await setup();
    for (let i = 0; i < 12; i++) expect(receiptOf(await enqueue(chat(200 + i, 'x'.repeat(4000)), chars.ctx, chars.deps))).toEqual({ state: 'queued' });
    expect(receiptOf(await enqueue(chat(220, 'x'.repeat(4000)), chars.ctx, chars.deps))).toEqual({ state: 'refused', code: 'rate-limited' });
  });

  it('limits every action, not only the ones with text', async () => {
    const w = await setup();
    for (let i = 0; i < 20; i++) expect(receiptOf(await enqueue(verify(300 + i), w.ctx, w.deps))).toEqual({ state: 'queued' });
    expect(receiptOf(await enqueue(verify(330), w.ctx, w.deps))).toEqual({ state: 'refused', code: 'rate-limited' });
  });

  it('counts malformed frames and unknown plans against the same budget', async () => {
    const w = await setup();
    for (let i = 0; i < 20; i++) {
      const bad = { t: 'action', opId: uuid(500 + i), kind: 'chat.send', planRef: 'plan1', payload: { text: '' } };
      expect(receiptOf(await enqueue(bad, w.ctx, w.deps))).toEqual({ state: 'refused', code: 'bad-args' });
    }
    const over = { t: 'action', opId: uuid(530), kind: 'chat.send', planRef: 'plan1', payload: { text: '' } };
    expect(receiptOf(await enqueue(over, w.ctx, w.deps))).toEqual({ state: 'refused', code: 'rate-limited' });

    const other = await setup();
    for (let i = 0; i < 20; i++) {
      const ghost = { t: 'action', opId: uuid(540 + i), kind: 'chat.send', planRef: `junk${i}`, payload: { text: 'hi' } };
      expect(receiptOf(await enqueue(ghost, other.ctx, other.deps))).toEqual({ state: 'refused', code: 'unknown-plan' });
    }
    const ghostOver = { t: 'action', opId: uuid(570), kind: 'chat.send', planRef: 'junk-new', payload: { text: 'hi' } };
    expect(receiptOf(await enqueue(ghostOver, other.ctx, other.deps))).toEqual({ state: 'refused', code: 'rate-limited' });
  });

  it('scopes an opId and the rate budget by project too', async () => {
    const w = await setup();
    await w.hub.createProject({ id: 'p2', studioId: w.ctx.studio, name: '项目二', now: w.deps.now });
    await w.hub.addMember('p2', 'c1', w.deps.now);
    await w.hub.bindProject({ projectId: 'p2', daemonId: 'd1', daemonProjectId: 'dp2', now: w.deps.now });
    await w.studio.putView({ projectId: 'p2', planRef: 'plan1', rev: 1, viewJson: JSON.stringify(view), updatedAt: w.deps.now });

    expect(receiptOf(await enqueue(chat(600), w.ctx, w.deps))).toEqual({ state: 'queued' });
    // The same opId in the other project is another action: both projects have a planRef "plan1".
    expect(receiptOf(await enqueue(chat(600), { ...w.ctx, projectId: 'p2' }, w.deps))).toEqual({ state: 'queued' });
    const taken = await take('d1', w.deps);
    expect(taken.deliver.map((d) => d.action.opId)).toEqual([uuid(600), uuid(600)]);
    expect(taken.deliver.map((d) => d.daemonProjectId)).toEqual(['dp1', 'dp2']);
  });

  it('expires an old queued entry before answering a replay', async () => {
    const w = await setup();
    expect(receiptOf(await enqueue(chat(700), w.ctx, w.deps))).toEqual({ state: 'queued' });
    w.advance(QUEUE_TTL_MS + 1);
    expect(receiptOf(await enqueue(chat(700), w.ctx, w.deps))).toEqual({ state: 'expired' });
  });

  it('has a receipt keyed by studio and plan, so the same opId in another plan is another action', async () => {
    const w = await setup();
    expect(receiptOf(await enqueue(chat(70), w.ctx, w.deps))).toEqual({ state: 'queued' });
    const otherPlan = { ...view, planRef: 'plan2' };
    await w.studio.putView({ projectId: 'p1', planRef: 'plan2', rev: 1, viewJson: JSON.stringify(otherPlan), updatedAt: w.deps.now });
    expect(receiptOf(await enqueue({ ...chat(70) as object, planRef: 'plan2' }, w.ctx, w.deps))).toEqual({ state: 'queued' });
    const key = opKey({ studio: w.ctx.studio, plan: 'plan1', project: 'p1' }, uuid(70));
    expect(await w.studio.op(key)).toMatchObject({ state: 'queued' });
  });

  it('reports expired items through the exported expire too', async () => {
    const w = await setup();
    await enqueue(chat(80), w.ctx, w.deps);
    w.advance(QUEUE_TTL_MS + 1);
    const expired = await expire(w.deps.now, w.deps);
    expect(expired).toHaveLength(1);
    expect(expired[0]!.receipt).toMatchObject({ opId: uuid(80), state: 'expired' });
  });
});
