import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import DHT from 'hyperdht';
import createTestnet, { type Testnet } from 'hyperdht/testnet.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CompanionClient, pairDevice } from '../src/companion/client.js';
import { deviceKeys, newSeed } from '../src/companion/device-crypto.js';
import { DeviceBook } from '../src/companion/devices.js';
import { CompanionHost } from '../src/companion/host.js';
import { parseCustomAddress } from '../src/companion/reach.js';
import { wsPipe } from '../src/companion/relay.js';
import { Store, initialState } from '../src/core/store.js';
import { generateIdentity } from '../src/net/crypto.js';
import { waitFor } from './helpers.js';

/**
 * The custom address (a mesh network's, docs/companion.md "Any network"): the relay also listens
 * on `host:port`, runs the same Noise handshake, turns an unpaired phone away with 4010, and stops
 * listening when the setting is cleared. 127.0.0.1 stands in for the Mac's address in the mesh.
 */

let testnet: Testnet;
const cleanup: Array<() => Promise<void> | void> = [];

beforeAll(async () => {
  testnet = await createTestnet(3);
}, 30_000);
afterAll(async () => {
  await testnet.destroy();
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** A port nobody listens on now (listen(0), then let it go). */
async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function mac() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-custom-'));
  const identity = generateIdentity();
  const store = new Store(initialState('test room'));
  store.dispatch({ type: 'identity', selfId: identity.peerId, isHost: true });
  store.dispatch({ type: 'welcome', self: { peerId: identity.peerId, name: 'kayra', shares: [], agent: true } });
  const host = new CompanionHost({
    identity,
    store,
    devices: new DeviceBook(path.join(dir, 'devices.json')),
    call: async () => ({ ok: true, value: 'ok' }),
    macName: () => 'Kayra’s Mac',
    version: '0.13.1',
    thumbsDir: path.join(dir, 'thumbs'),
    uploadsDir: path.join(dir, 'uploads'),
    dht: { bootstrap: testnet.bootstrap, host: '127.0.0.1', refuseDirect: true },
    customAddress: () => store.getState().prefs.customAddress,
    coalesceMs: 50,
  });
  cleanup.push(async () => {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const setAddress = (a: string | null) => store.dispatch({ type: 'prefs', prefs: { customAddress: a } });
  return { host, store, setAddress };
}

function phone() {
  const node = new DHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' });
  cleanup.push(() => node.destroy({ force: true }));
  const keys = deviceKeys(newSeed());
  const sockets: WebSocket[] = [];
  const openRelay = (url: string) => {
    const ws = new WebSocket(url);
    sockets.push(ws);
    return wsPipe(ws, false);
  };
  cleanup.push(() => sockets.forEach((s) => s.terminate()));
  return { node, keys, openRelay, device: { keys, name: 'Pixel 9', platform: 'android' as const, app: '1.1.0' } };
}

const canConnect = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });

describe('parseCustomAddress', () => {
  it('takes host:port only', () => {
    expect(parseCustomAddress('10.147.17.5:7788')).toEqual({ host: '10.147.17.5', port: 7788 });
    expect(parseCustomAddress(' [fd00::1]:80 ')).toEqual({ host: 'fd00::1', port: 80 });
    for (const bad of ['', '10.0.0.1', '10.0.0.1:0', '10.0.0.1:70000', 'http://10.0.0.1:80', 'a b:1']) expect(parseCustomAddress(bad)).toBeUndefined();
  });
});

describe('the relay on a custom address', () => {
  it('pairs and links with the same Noise, turns an unpaired phone away, and closes when cleared', async () => {
    const { host, store, setAddress } = await mac();
    await host.start();
    const info = await host.pairStart();
    const port = await freePort();
    setAddress(`127.0.0.1:${port}`);
    const url = await waitFor(() => host.customUrl(), 10_000);
    expect(url).toBe(`ws://127.0.0.1:${port}/companion`);
    expect(store.getState().companion.custom).toMatchObject({ state: 'listening', address: `127.0.0.1:${port}` });

    // A phone pairs through it (the direct way is refused): the handshake is the relay's.
    const p = phone();
    const link = `${info.link.split('?')[0]}?r=${encodeURIComponent(url)}`;
    const paired = pairDevice(p.node, link, p.device, { timeoutMs: 20_000, openRelay: p.openRelay, staggerMs: 200 });
    await waitFor(() => store.getState().companion.pairing?.waiting, 15_000);
    host.pairApprove();
    expect((await paired).path).toBe('relay');

    // One that was never paired gets 4010 inside the link.
    const stranger = phone();
    const client = new CompanionClient({ node: stranger.node, address: host.address(), link: stranger.keys.link, app: '1.1.0', platform: 'android', topics: ['home'], hints: { openRelay: stranger.openRelay, relays: [url], staggerMs: 0 } });
    cleanup.push(() => client.close());
    const closes: number[] = [];
    client.on('close', (code) => closes.push(code));
    await client.connect().catch(() => undefined);
    await waitFor(() => closes.length > 0, 10_000);
    expect(closes[0]).toBe(4010);

    // Clearing the setting closes the listener.
    expect(await canConnect(port)).toBe(true);
    setAddress(null);
    await waitFor(() => !host.customUrl(), 5_000);
    expect(await canConnect(port)).toBe(false);
    expect(store.getState().companion.custom).toBeUndefined();
  }, 60_000);

  it('says so when the port is taken, and never listens on another one', async () => {
    const { host, store, setAddress } = await mac();
    await host.start();
    await host.pairStart();
    const busy = net.createServer();
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', () => r()));
    cleanup.push(() => void busy.close());
    const port = (busy.address() as net.AddressInfo).port;
    setAddress(`127.0.0.1:${port}`);
    await waitFor(() => store.getState().companion.custom?.state === 'failed', 10_000);
    expect(store.getState().companion.custom).toMatchObject({ state: 'failed', address: `127.0.0.1:${port}`, error: expect.stringMatching(/in use/) });
    expect(host.customUrl()).toBeUndefined();
  }, 30_000);
});
