import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSettings } from '../src/core/settings.js';
import { DEFAULT_PREFS, prefsFrom, type Prefs } from '../src/core/store.js';
import { FEDERATION_DEFAULTS, clampAtOnce, federationOf } from '../src/fork/federation/settings.js';
import { PrefsPatch } from '../src/ipc/api.js';
import { LOCAL_SETTINGS, SYNCED_SETTINGS, SettingsFrame, SettingsSync, type SyncPeer } from '../src/machines/sync.js';
import { Settings } from '../src/shared/settings-schema.js';

/** Federation settings (BLG-221): one shape, defaults field by field, this computer's own. */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'beluga-fed-'));
  dirs.push(d);
  return d;
};

describe('federationOf', () => {
  it('federationOf gives the defaults when unset', () => {
    expect(federationOf(undefined)).toEqual({ accept: 'off', from: 'full', atOnce: 2, poolLabel: 'pool' });
    expect(federationOf({})).toEqual(FEDERATION_DEFAULTS);
    expect(federationOf(Settings.parse({}).federation)).toEqual(FEDERATION_DEFAULTS);
  });

  it('federationOf falls back field by field', () => {
    expect(federationOf({ accept: 'x', from: 'trusted', atOnce: 9 })).toEqual({ accept: 'off', from: 'trusted', atOnce: 2, poolLabel: 'pool' });
    expect(federationOf({ accept: 'assigned', atOnce: 4, poolLabel: 'Bad Label' })).toEqual({ accept: 'assigned', from: 'full', atOnce: 4, poolLabel: 'pool' });
    expect(federationOf({ accept: 'pool', poolLabel: 'claim-me' }).poolLabel).toBe('claim-me');
    expect(federationOf('nonsense')).toEqual(FEDERATION_DEFAULTS);
  });

  it('clampAtOnce keeps 1–6', () => {
    expect(clampAtOnce(0)).toBe(1);
    expect(clampAtOnce(9)).toBe(6);
    expect(clampAtOnce(2.4)).toBe(2);
    expect(clampAtOnce(Number.NaN)).toBe(2);
    expect(clampAtOnce(Infinity)).toBe(6);
  });
});

describe('the settings file', () => {
  it('old autoRoute settings parse the same', () => {
    const old = { autoRoute: { on: true, hard: ['claude:opus'], build: ['claude:haiku'] }, theme: 'mono' };
    const parsed = Settings.parse(old);
    expect(parsed.autoRoute).toEqual(old.autoRoute);
    expect(parsed.federation).toBeUndefined();
    expect(Settings.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    const file = path.join(tmp(), 'settings.json');
    writeFileSync(file, JSON.stringify(old));
    expect(loadSettings(file).autoRoute).toEqual(old.autoRoute);
  });

  it('a bad federation keeps the rest', () => {
    const file = path.join(tmp(), 'settings.json');
    writeFileSync(file, JSON.stringify({ theme: 'mono', autoRoute: { on: false }, federation: { accept: 'always', atOnce: 40 } }));
    const s = loadSettings(file);
    expect(s.theme).toBe('mono');
    expect(s.autoRoute).toEqual({ on: false });
    expect(s.federation).toBeUndefined();
    expect(federationOf(s.federation)).toEqual(FEDERATION_DEFAULTS);
    writeFileSync(file, JSON.stringify({ federation: { accept: 'assigned', from: 'trusted', atOnce: 3 } }));
    expect(federationOf(loadSettings(file).federation)).toEqual({ accept: 'assigned', from: 'trusted', atOnce: 3, poolLabel: 'pool' });
  });

  it('PrefsPatch and prefsFrom carry federation', () => {
    expect(PrefsPatch.safeParse({ federation: { accept: 'assigned', atOnce: 3 } }).success).toBe(true);
    expect(PrefsPatch.safeParse({ federation: null }).success).toBe(true);
    expect(PrefsPatch.safeParse({ federation: { accept: 'always' } }).success).toBe(false);
    expect(PrefsPatch.safeParse({ autoRoute: { on: false } }).success).toBe(true);
    expect(prefsFrom({ federation: { accept: 'assigned' } }).federation).toEqual({ accept: 'assigned' });
    expect(prefsFrom({}).federation).toBeUndefined();
  });
});

describe('federation stays on this computer', () => {
  it("federation is this computer's own", () => {
    expect(LOCAL_SETTINGS).toContain('federation');
    expect(SYNCED_SETTINGS as readonly string[]).not.toContain('federation');
    expect(SYNCED_SETTINGS).toContain('autoRoute');
  });

  let clock = 1_700_000_000_000;
  function device(id: string, name: string, role: SyncPeer['role'], start: Partial<Prefs> = {}) {
    const dir = tmp();
    let prefs: Prefs = { ...DEFAULT_PREFS, ...start };
    const listeners = new Set<() => void>();
    const sync = new SettingsSync({
      file: path.join(dir, 'settings-sync.json'),
      prefs: () => prefs,
      watch: (l) => (listeners.add(l), () => void listeners.delete(l)),
      apply: (patch) => {
        const next: Record<string, unknown> = { ...prefs };
        for (const [k, v] of Object.entries(patch)) next[k] = v === null ? (DEFAULT_PREFS as unknown as Record<string, unknown>)[k] : v;
        prefs = next as unknown as Prefs;
        for (const l of [...listeners]) l();
      },
      secrets: { read: () => ({}), write: () => {}, watch: () => () => {} },
      now: () => (clock += 10),
      log: () => {},
    });
    sync.start({ self: () => ({ id, name }), push: () => {} });
    return {
      id,
      name,
      role,
      sync,
      get prefs() {
        return prefs;
      },
      set(patch: Partial<Prefs>): void {
        prefs = { ...prefs, ...patch };
        for (const l of [...listeners]) l();
      },
    };
  }
  type Device = ReturnType<typeof device>;
  const peerOf = (d: Device): SyncPeer => ({ id: d.id, name: d.name, role: d.role });
  function exchange(from: Device, to: Device): void {
    const ask: SettingsFrame = JSON.parse(JSON.stringify(from.sync.frame({ id: to.id }, from.role === 'app')));
    to.sync.merge(peerOf(from), ask, to.role === 'app');
    const answer: SettingsFrame = JSON.parse(JSON.stringify(to.sync.frame({ id: from.id }, to.role === 'app')));
    from.sync.merge(peerOf(to), answer, from.role === 'app');
  }

  it('federation never travels', () => {
    const mac = device('aaaa000000000001', 'MacBook', 'app');
    const box = device('bbbb000000000002', 'build-box', 'computer');
    mac.set({ federation: { accept: 'assigned', atOnce: 4 }, autoRoute: { on: false } });
    exchange(mac, box);
    expect(box.prefs.federation).toBeUndefined();
    expect(box.prefs.autoRoute).toEqual({ on: false });
    expect(Object.keys(mac.sync.frame({ id: box.id }, true).entries)).not.toContain('federation');
  });
});
