import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/core/plans/model.js';
import { Store, initialState } from '../src/core/store.js';
import { generateIdentity, identityPem } from '../src/net/crypto.js';
import { newRefKey, saveStudioConfig, type StudioConfig } from '../src/studio/keys.js';
import { StudioService } from '../src/studio/service.js';
import type { LinkTimers, WsFactory } from '../src/studio/link.js';
import type { Project } from '../src/workspaces/types.js';

/**
 * BLG-71: the service's own promises — status never carries the key, sharing is written where it
 * says, and unlinking closes the link and forgets the file. The hub is a socket that throws (it is
 * down), so the link is offline the whole time: everything below is the local side.
 */

const PROJECT = (id: string, name: string): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces: [] }) as Project;

const PLAN: Plan = {
  id: 'pl1',
  projectId: 'p1',
  home: 'ws:home',
  status: 'draft',
  draftRev: 0,
  autonomy: 'gated',
  maxParallel: 2,
  paused: false,
  testsAt: 'end',
  runs: {},
  activity: [],
  createdAt: 0,
  updatedAt: 0,
};

function setup(): { store: Store; file: string; service: StudioService; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'beluga-studio-service-'));
  const file = path.join(dir, 'studio.json');
  const identity = generateIdentity();
  const cfg: StudioConfig = {
    v: 1,
    hub: 'http://localhost:8787',
    studioId: 'st1',
    daemonId: identity.peerId,
    name: 'Test Mac',
    linkedAt: 1_000,
    key: identityPem(identity),
    refKey: newRefKey(),
    projects: {},
  };
  saveStudioConfig(cfg, file);
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [PROJECT('p1', 'bob-api'), PROJECT('p2', 'landing')] });
  store.dispatch({ type: 'plans_init', state: { enabled: true, plans: [PLAN], style: '' } });

  let now = 5_000;
  const jobs: number[] = [];
  const timers: LinkTimers = {
    setTimeout: () => {
      const id = jobs.length + 1;
      jobs.push(id);
      return id;
    },
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
  };
  const ws: WsFactory = () => {
    throw new Error('hub is down');
  };
  const service = new StudioService({ store, file, ws, timers, now: () => now });
  return { store, file, service, dir };
}

describe('StudioService', () => {
  it('shows the link without the key, and counts the shared project’s plans', () => {
    const t = setup();
    t.service.start();
    const status = t.service.status();
    expect(status).toMatchObject({ linked: true, state: 'offline', hub: 'http://localhost:8787', studioId: 'st1' });
    const text = JSON.stringify(status);
    expect(text).not.toContain('PRIVATE KEY');
    expect(status).not.toHaveProperty('key');
    expect(status).not.toHaveProperty('refKey');
    expect(status.projects).toEqual([
      { projectId: 'p1', shared: false, plans: 0 },
      { projectId: 'p2', shared: false, plans: 0 },
    ]);
    t.service.stop();
    rmSync(t.dir, { recursive: true, force: true });
  });

  it('writes sharing to the file, and unlinking closes the link and forgets it', () => {
    const t = setup();
    t.service.start();
    expect(t.service.setProject('p1', true).projects[0]).toEqual({ projectId: 'p1', shared: true, plans: 1 });
    // A second change is written too: the file is the record, not memory.
    t.service.setProject('p2', true);
    expect(statSync(t.file).size).toBeGreaterThan(0);
    const status = t.service.unlink();
    expect(status).toMatchObject({ linked: false, state: 'unlinked' });
    expect(() => statSync(t.file)).toThrow();
    expect(t.service.status().linked).toBe(false);
    expect(() => t.service.setProject('p1', true)).toThrow(/not connected/);
    rmSync(t.dir, { recursive: true, force: true });
  });

  it('refuses a project that is not here, and a second link on a linked Mac', async () => {
    const t = setup();
    t.service.start();
    expect(() => t.service.setProject('nope', true)).toThrow(/No such project/);
    const again = await t.service.link('ABCD-EFGH');
    expect(again).toEqual({ ok: false, error: 'already-linked' });
    t.service.stop();
    rmSync(t.dir, { recursive: true, force: true });
  });

  it('removes a corrupt key file too when unlinked', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'beluga-studio-corrupt-'));
    const file = path.join(dir, 'studio.json');
    writeFileSync(file, '{"v":1,"hub":');
    const service = new StudioService({ store: new Store(initialState('room')), file });
    service.start();
    expect(service.status().linked).toBe(false);
    const status = service.unlink();
    expect(status).toMatchObject({ linked: false, state: 'unlinked' });
    expect(() => statSync(file)).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it('is an empty service in a demo', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'beluga-studio-demo-'));
    const file = path.join(dir, 'studio.json');
    const service = new StudioService({ store: new Store(initialState('room')), file, demo: true });
    service.start();
    expect(service.status()).toEqual({ linked: false, state: 'unlinked', projects: [] });
    expect(await service.link('ABCD-EFGH')).toEqual({ ok: false, error: 'demo-mode' });
    service.stop();
    rmSync(dir, { recursive: true, force: true });
  });
});
