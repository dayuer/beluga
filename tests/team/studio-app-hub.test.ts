import { describe, expect, it } from 'vitest';
import type { StudioAction } from '../../src/studio/protocol.js';
import { createHub } from '../../packages/studio-app/lib/hub';
import { PlansRes, parse } from '../../packages/studio-app/lib/hub-schema';

/** BLG-83: the app's hub client returns typed errors for bad answers instead of throwing. */

const reply = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

const hubWith = (doFetch: typeof fetch, onSignedOut?: () => void) =>
  createHub({ base: 'https://hub.test', session: () => 'session-token', fetch: doFetch, onSignedOut });

describe('the studio app hub client', () => {
  it('turns a non-JSON 200 into a schema error, not a crash', async () => {
    const r = await hubWith(async () => reply('<html>oops</html>')).projects();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ kind: 'schema', where: '/v1/app/projects' });
    expect(r.error.kind === 'schema' && r.error.detail).toContain('not JSON');
  });

  it('names the missing field in a wrong-shape answer', async () => {
    const r = await hubWith(async () => reply(JSON.stringify({ projects: [{ id: 'p1' }] }))).projects();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ kind: 'schema', where: '/v1/app/projects' });
    expect(r.error.kind === 'schema' && r.error.detail).toContain('studioId');
  });

  it('accepts a valid list and drops fields it does not know', async () => {
    const body = { projects: [{ id: 'p1', studioId: 's1', studioName: 'Acme', name: 'App', extra: 'drop' }] };
    const r = await hubWith(async () => reply(JSON.stringify(body))).projects();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.projects).toEqual([{ id: 'p1', studioId: 's1', studioName: 'Acme', name: 'App' }]);
  });

  it('reports 401 as signed-out and clears the session once', async () => {
    let cleared = 0;
    const r = await hubWith(async () => reply('{"error":"not-signed-in"}', 401), () => void (cleared += 1)).projects();
    expect(r).toMatchObject({ ok: false, error: { kind: 'signed-out' } });
    expect(cleared).toBe(1);
  });

  it('never throws when the network itself fails', async () => {
    const r = await hubWith(async () => {
      throw new Error('network');
    }).projects();
    expect(r).toMatchObject({ ok: false, error: { kind: 'offline' } });
  });

  it('unwraps the receipt envelope of a plan.create answer', async () => {
    const action: StudioAction = {
      t: 'action',
      opId: '11111111-1111-4111-8111-111111111111',
      kind: 'plan.create',
      payload: { goal: '做一个喝水提醒', platforms: ['ios'] },
    };
    const answer = { receipt: { t: 'receipt', opId: action.opId, state: 'queued' } };
    const r = await hubWith(async () => reply(JSON.stringify(answer))).send('p1', action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ t: 'receipt', opId: action.opId, state: 'queued' });
  });

  it('requires the studio status in a plan list', () => {
    expect(parse(PlansRes, { plans: [], studio: { online: false, lastSyncAt: null } }).ok).toBe(true);
    expect(parse(PlansRes, { plans: [], studio: { online: 'yes', lastSyncAt: null } }).ok).toBe(false);
    expect(parse(PlansRes, { plans: [] }).ok).toBe(false);
  });

  it('reads one plan view from its own path', async () => {
    const view = {
      planRef: 'plan1',
      draftRev: 1,
      title: '饮水',
      goal: '',
      stage: 'running',
      waitingOn: 'ai',
      headline: '在做',
      progress: { done: 0, total: 0 },
      milestones: [],
      decisions: [],
      turns: [],
      typing: false,
      moreTurns: false,
      activity: [],
    };
    let seen = '';
    const r = await hubWith(async (url) => {
      seen = String(url);
      return reply(JSON.stringify({ view, updatedAt: 123 }));
    }).plan('p1', 'plan1');
    expect(seen).toBe('https://hub.test/v1/app/projects/p1/plans/plan1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.view.title).toBe('饮水');
    expect(r.value.updatedAt).toBe(123);
  });

  it('pages the conversation before a turn id', async () => {
    let seen = '';
    const r = await hubWith(async (url) => {
      seen = String(url);
      return reply(JSON.stringify({ turns: [{ id: 't1', who: 'ai', text: '你好', at: 1 }], more: false }));
    }).turns('p1', 'plan1', 't9');
    expect(seen).toBe('https://hub.test/v1/app/projects/p1/plans/plan1/turns?before=t9');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.turns).toHaveLength(1);
    expect(r.value.more).toBe(false);
  });
});
