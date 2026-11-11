import { type ChildProcess, spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import createTestnet, { type Testnet } from 'hyperdht/testnet.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { DeviceBook } from '../../src/companion/devices.js';
import { CompanionHost } from '../../src/companion/host.js';
import { Store, initialState } from '../../src/core/store.js';
import { DaemonServer } from '../../src/daemon/server.js';
import { IPC_VERSION, encodeFrame, parseDaemonFrame } from '../../src/ipc/protocol.js';
import { SocketClient } from '../../src/ipc/socket-client.js';
import { Machines } from '../../src/machines/machines.js';
import { attachMachines } from '../../src/machines/registry.js';
import { generateIdentity } from '../../src/net/crypto.js';
import { waitFor } from '../helpers.js';

/**
 * A real computer in the tests (BLG-783): a headless Beluga started as its own process from the
 * `beluga` command (`beluga daemon --keep-alive`), on a local DHT, paired with the real
 * `beluga pair --computer --json`, and driven from an app over /machine/<id>: the welcome snapshot,
 * a call, a terminal, an admin call refused, a dropped link that comes back and catches up, and a
 * forget that cuts it off. scripts/linux-test.sh runs it on Linux in Docker; it runs on a Mac and on Windows too.
 */

/**
 * What the test needs of this machine, checked before it starts (BLG-150): UDP on loopback (the
 * local DHT), a TCP port on 127.0.0.1 (the app's door), and a child process. A sandbox that blocks
 * them (an agent's) would leave the pairing waiting until it timed out; it says so and skips instead.
 * Nothing here is Beluga's own code: a regression in it still fails the test.
 */
async function missing(): Promise<string | undefined> {
  const udp = await new Promise<string | undefined>((resolve) => {
    const sock = dgram.createSocket('udp4');
    const done = (why?: string) => {
      clearTimeout(timer);
      sock.close();
      resolve(why);
    };
    const timer = setTimeout(() => done('UDP on 127.0.0.1 never arrived (the local DHT needs it)'), 3000);
    sock.once('error', (e) => done(`UDP on 127.0.0.1 is refused here (${e.message})`));
    sock.once('message', () => done());
    sock.bind(0, '127.0.0.1', () => sock.send('ping', sock.address().port, '127.0.0.1'));
  });
  if (udp) return udp;
  const tcp = await new Promise<string | undefined>((resolve) => {
    const server = net.createServer((c) => c.end());
    server.once('error', (e) => resolve(`a TCP port on 127.0.0.1 is refused here (${e.message})`));
    server.listen(0, '127.0.0.1', () => {
      const c = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
      c.once('connect', () => (c.destroy(), server.close(), resolve(undefined)));
      c.once('error', (e) => (server.close(), resolve(`connecting to 127.0.0.1 is refused here (${e.message})`)));
    });
  });
  if (tcp) return tcp;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
    child.once('error', (e) => resolve(`a child process can't start here (${e.message})`));
    child.once('exit', () => resolve(undefined));
  });
}
const MISSING = await missing();
if (MISSING) console.warn(`tests/machines/linux-computer.test.ts skipped: ${MISSING}`);

const ROOT = path.resolve(import.meta.dirname, '../..');
const TOKEN = 'a'.repeat(32);

let testnet: Testnet;
let bootstrap = '';
const cleanup: Array<() => Promise<void> | void> = [];
beforeAll(async () => {
  if (MISSING) return;
  testnet = await createTestnet(3);
  bootstrap = (testnet.bootstrap as Array<{ host: string; port: number }>).map((b) => `${b.host}:${b.port}`).join(',');
}, 30_000);
afterAll(async () => {
  await testnet?.destroy();
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** A wait that says which step it was, and what the computer said, when it runs out (never a longer wait). */
async function waitStep<T>(what: string, fn: () => T | undefined | false | null, ms: number, said: () => string): Promise<T> {
  try {
    return await waitFor(fn, ms);
  } catch (err) {
    throw new Error(`${what}: ${(err as Error).message} after ${ms} ms. What it said:\n${said().slice(-4000)}`);
  }
}

/** The `beluga` command from source, against the computer's home and the local DHT. */
function beluga(home: string, args: readonly string[]): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'src/cli.ts'), ...args], {
    cwd: ROOT,
    env: { ...process.env, BELUGA_HOME: home, BELUGA_DHT_BOOTSTRAP: bootstrap, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A headless Beluga, as a server runs it: its own process, its own home. */
async function headless(name: string): Promise<{ home: string; proc: ChildProcess; log: () => string }> {
  const home = mkdtempSync(path.join(os.tmpdir(), 'beluga-headless-'));
  // No relay tunnel (it would fetch cloudflared): reached directly, on the testnet.
  writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ tunnel: 'p2p', computerName: name }));
  writeFileSync(path.join(home, 'projects.json'), JSON.stringify({ roots: [] }));
  const proc = beluga(home, ['daemon', '--keep-alive', '--no-agent', '--tunnel', 'none', '--name', 'kay']);
  let log = '';
  proc.stdout!.on('data', (d: Buffer) => void (log += d.toString()));
  proc.stderr!.on('data', (d: Buffer) => void (log += d.toString()));
  cleanup.push(async () => {
    proc.kill('SIGTERM');
    await new Promise((r) => (proc.exitCode !== null ? r(undefined) : proc.once('exit', r)));
    rmSync(home, { recursive: true, force: true });
  });
  await waitStep('the headless Beluga starting', () => existsSync(path.join(home, 'daemon.json')) || proc.exitCode !== null, 60_000, () => log);
  if (proc.exitCode !== null) throw new Error(`The headless Beluga stopped:\n${log}`);
  return { home, proc, log: () => log };
}

/** `beluga pair --computer --json` there: each line it prints, as it prints them. */
function pairThere(home: string): { text: () => string; lines: () => Array<Record<string, unknown>>; exited: Promise<number | null> } {
  const proc = beluga(home, ['pair', '--computer', '--json']);
  let out = '';
  proc.stdout!.on('data', (d: Buffer) => void (out += d.toString()));
  let err = '';
  proc.stderr!.on('data', (d: Buffer) => void (err += d.toString()));
  const exited = new Promise<number | null>((r) => proc.once('exit', (code) => r(code)));
  cleanup.push(() => void proc.kill('SIGTERM'));
  return { text: () => `${out}${err}`, lines: () => out.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>), exited };
}

/** The app: this test's daemon (its door, its machines, its companion host), in this process. */
async function app() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-app-'));
  const identity = generateIdentity();
  const store = new Store(initialState('app room'));
  store.dispatch({ type: 'identity', selfId: identity.peerId, isHost: true });
  const devices = new DeviceBook(path.join(dir, 'devices.json'));
  const session = { store, intents: { subscribe: () => () => undefined }, attend: () => undefined, detach: () => undefined };
  const server = new DaemonServer({ session: session as never, token: TOKEN, version: '0.9.0' });
  let host!: CompanionHost;
  const machines = new Machines({
    dir,
    identity,
    devices,
    node: () => host.dhtNode(),
    address: () => host.address(),
    relayUrl: () => host.relayUrl(),
    name: () => 'MacBook',
    version: '0.9.0',
    platform: 'macos',
    removePhone: (id) => void host.removeDevice(id),
    onChange: () => host.machinesChanged(),
    adopt: (socket, hello) => server.adoptMachine(socket, hello),
    backoffMs: [300, 600],
    pollMs: 60_000,
    staggerMs: 0,
  });
  attachMachines(session, machines);
  server.routeMachines((id, ws, hello) => machines.door.open(id, ws, hello));
  host = new CompanionHost({ identity, store, devices, call: async () => ({ ok: true, value: undefined }), macName: () => 'MacBook', version: '0.9.0', thumbsDir: path.join(dir, 'thumbs'), uploadsDir: path.join(dir, 'uploads'), dht: { bootstrap: testnet.bootstrap, host: '127.0.0.1' }, coalesceMs: 50, machines });
  const port = await server.listen();
  cleanup.push(async () => {
    await machines.stop();
    await server.close();
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await host.start();
  machines.start();
  return { machines, port };
}

describe.skipIf(Boolean(MISSING))(MISSING ? `a real headless Beluga, paired and driven — skipped: ${MISSING}` : 'a real headless Beluga, paired and driven', () => {
  it('pairs with the real CLI, then a screen drives it: snapshot, call, terminal, refusal, a dropped link, a forget', async () => {
    const box = await headless('linux-box');
    const mac = await app();

    // `beluga pair --computer --json` there; the app joins it with the link it printed.
    const pairing = pairThere(box.home);
    const opened = await waitStep('`beluga pair --computer` printing its link', () => pairing.lines().find((l) => typeof l.link === 'string'), 60_000, () => `${pairing.text()}\n— its daemon:\n${box.log()}`);
    expect(opened.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const offer = await mac.machines.joinStart(opened.link as string);
    expect(offer).toMatchObject({ name: 'linux-box' });
    // The computer printed the same four pictures the app shows.
    const waiting = await waitStep('`beluga pair --computer` showing the pictures', () => pairing.lines().find((l) => typeof l.fingerprint === 'string'), 20_000, () => `${pairing.text()}\n— its daemon:\n${box.log()}`);
    expect(waiting.fingerprint).toBe(offer.fingerprint);
    const added = await mac.machines.joinApprove();
    expect(await pairing.exited).toBe(0);
    expect(pairing.lines().at(-1)).toMatchObject({ end: 'joined', app: 'MacBook' });

    // A screen on /machine/<id>: the computer's own state.
    const screen = await SocketClient.connect({ url: `ws://127.0.0.1:${mac.port}/machine/${added.id}`, token: TOKEN, kind: 'test', version: '0.9.0', connect: (url) => new WebSocket(url) as never, timeoutMs: 30_000 });
    cleanup.push(() => screen.close());
    const devices = (await screen.call('machines.devices')) as Array<{ name: string; role: string; self: boolean }>;
    expect(devices.find((d) => d.self)).toMatchObject({ name: 'linux-box', role: 'computer' });
    expect(devices.some((d) => d.role === 'app' && d.name === 'MacBook')).toBe(true);

    // A terminal there, typed into from here.
    await screen.call('terminals.global', 'shell:1', os.tmpdir(), { cols: 80, rows: 24 });
    const term = screen.attachTerminal('shell:1');
    let out = '';
    term.onData((d) => (out += d));
    // Typed as a person does, with Enter (\r); on Windows the shell there is PowerShell.
    term.write(process.platform === 'win32' ? 'echo "from-the-$(40+2)-box"\r' : 'echo from-the-$((40+2))-box\r');
    await waitStep('the terminal there echoing', () => out.includes('from-the-42-box'), 20_000, () => `${out}\n— its daemon:\n${box.log()}`);

    // Admin is refused there, in plain words.
    await expect(screen.call('web.link')).rejects.toThrow(/not from a screen driving it/);
    // So is stopping it (BLG-834): nothing remote could start it again. It keeps running.
    await expect(screen.call('daemon.stop')).rejects.toThrow(/not from a screen driving it/);
    await new Promise((r) => setTimeout(r, 500));
    expect(box.proc.exitCode).toBeNull();
    expect(((await screen.call('machines.devices')) as unknown[]).length).toBeGreaterThan(0);

    // The link drops (no close frame): the screen stays, comes back, and catches up.
    mac.machines.closeLinks(mac.machines.book.get(added.id)!.cert.device);
    // Calls while it's away are answered with why; once it's back, they go through again.
    const until = Date.now() + 30_000;
    let back = false;
    while (!back && Date.now() < until) {
      back = await screen.call('session.setPrefs', { mouse: false }).then(
        () => true,
        () => false,
      );
      if (!back) await new Promise((r) => setTimeout(r, 300));
    }
    expect(back).toBe(true);
    // The change made there reaches this screen's state, as every action after a reconnect does.
    await waitStep('the change made there reaching this screen', () => screen.store.getDomain().prefs.mouse === false, 20_000, box.log);

    // An app on another protocol is told so by the real computer, in plain words, and which side to update.
    const raw = await mac.machines.openLink(mac.machines.book.get(added.id)!);
    const said: string[] = [];
    const code = new Promise<number>((r) => raw.once('close', r));
    raw.on('message', (t) => said.push(t));
    raw.send(encodeFrame({ t: 'hello', token: 'x'.repeat(20), ipc: IPC_VERSION + 1, kind: 'mac', version: '9.9.9', caps: [] }));
    expect(await code).toBe(4004);
    expect(parseDaemonFrame(said[0]!)).toMatchObject({ t: 'bye', update: 'computer', reason: expect.stringMatching(/^linux-box runs an older Beluga .*Update It runs `beluga update` there/) });

    // Forgotten on the app: cut off at once.
    const closed = new Promise<string>((r) => screen.onClose(r));
    mac.machines.forget(added.id);
    expect(await closed).toBeTruthy();
  }, 240_000);
});
