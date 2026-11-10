import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type DHT from 'hyperdht';
import { describe, expect, it } from 'vitest';
import { DeviceBook, deviceId } from '../src/companion/devices.js';
import { CLIENT_INVITE_MAX_TTL_MS, CLIENT_INVITE_TTL_MS, DevicePairing } from '../src/companion/pair.js';
import type { DeviceCert } from '../src/companion/protocol.js';
import { generateIdentity } from '../src/net/crypto.js';

/** Client invites (BLG-14): a link that names a project, expires, and pairs a customer's phone, not a device of you. */

const fakeNode = (): DHT =>
  ({
    createServer: () => ({ listen: async () => undefined, close: async () => undefined }),
  }) as unknown as DHT;

const book = () => new DeviceBook(path.join(mkdtempSync(path.join(os.tmpdir(), 'beluga-client-')), 'devices.json'));
const pairing = () => {
  const devices = book();
  const p = new DevicePairing({ node: async () => fakeNode(), identity: generateIdentity(), devices, address: () => 'ab', macName: () => 'Mac', onChange: () => undefined });
  return { p, devices };
};
const cert = (n: string): DeviceCert => ({ v: 1, owner: 'o', ownerKey: 'k', device: n.repeat(64).slice(0, 64), link: n.repeat(64).slice(0, 64), box: n.repeat(64).slice(0, 64), name: `Phone ${n}`, platform: 'android', issuedAt: Date.now(), sig: 's' }) as DeviceCert;

describe('client invites', () => {
  it('names the project and lasts a day by default', async () => {
    const { p } = pairing();
    const info = await p.start({ project: 'shop' });
    expect(info.project).toBe('shop');
    expect(info.expiresAt - Date.now()).toBeGreaterThan(CLIENT_INVITE_TTL_MS - 5000);
    expect(info.expiresAt - Date.now()).toBeLessThanOrEqual(CLIENT_INVITE_TTL_MS);
    await p.cancel();
  });

  it('never lasts longer than a week, and can be shorter', async () => {
    const { p } = pairing();
    expect((await p.start({ project: 'shop', ttlMs: 365 * 24 * 3600_000 })).expiresAt - Date.now()).toBeLessThanOrEqual(CLIENT_INVITE_MAX_TTL_MS);
    expect((await p.start({ project: 'shop', ttlMs: 60_000 })).expiresAt - Date.now()).toBeLessThanOrEqual(60_000);
    await p.cancel();
  });

  it('the owner’s own pairing has no project and keeps its 10 minutes', async () => {
    const { p } = pairing();
    const info = await p.start();
    expect(info.project).toBeUndefined();
    expect(info.expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    await p.cancel();
  });

  it('expires: the pairing closes itself', async () => {
    const { p } = pairing();
    await p.start({ project: 'shop', ttlMs: 60_000 });
    // (ttl floor is the API's; the class honours what it is given)
    await p.start({ project: 'shop', ttlMs: 20 });
    await new Promise((r) => setTimeout(r, 80));
    expect(p.isOpen).toBe(false);
  });
});

describe('client devices in the book', () => {
  it('are kept with their project, shown on the Mac, persisted and revocable', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'beluga-client-')), 'devices.json');
    const b = new DeviceBook(file);
    const c = cert('a');
    const own = cert('b');
    b.add(c, 'app', { project: 'shop' });
    b.add(own);
    const views = b.views(new Set());
    expect(views.find((v) => v.id === deviceId(c))?.client).toEqual({ project: 'shop' });
    expect(views.find((v) => v.id === deviceId(own))?.client).toBeUndefined();
    expect(new DeviceBook(file).get(deviceId(c))?.client).toEqual({ project: 'shop' });
    expect(b.remove(deviceId(c))).toBeDefined();
    expect(b.byLink(c.link)).toBeUndefined();
    expect(b.get(deviceId(own))).toBeDefined();
  });
});
