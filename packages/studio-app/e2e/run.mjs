#!/usr/bin/env node
/**
 * iOS simulator end-to-end runner using Maestro:
 * 1) Start the real hub (wrangler dev), a controllable TCP proxy (to simulate client offline),
 *    and the fake daemon, then seed a studio/projects/customer.
 * 2) Build and install the iOS app onto a booted iOS simulator with EXPO_PUBLIC_HUB_URL pointing to the proxy.
 * 3) Start the control server (for Maestro runScript actions) and run `maestro test`, saving screenshots to `e2e/out/`.
 * 4) Always stop every started child process and close servers on success or failure.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createApi,
  createProcessManager,
  initHubDb,
  killProcessGroup,
  needFree,
  seedStudio,
  sleep,
  startFakeDaemon,
  startWrangler,
} from './hub-runner.mjs';
import { views } from './fixtures/views.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repo = path.resolve(appDir, '../..');
const hubDir = path.join(repo, 'packages/studio-hub');
const outDir = path.join(here, 'out');
const scratch = path.join(repo, '.beluga/scratch/e2e');
const stateDir = path.join(scratch, 'hub-state');
const keyFile = path.join(scratch, 'daemon.pem');
const daemonLog = path.join(scratch, 'daemon.log');
const wranglerLog = path.join(scratch, 'wrangler.log');

// Defaults are shared with the Maestro control script; override them to run next to
// someone else's local hub/daemon without stopping it.
const portFrom = (name, fallback) => Number(process.env[name] ?? fallback);
const hubPort = portFrom('E2E_HUB_PORT', 8787);
const proxyPort = portFrom('E2E_PROXY_PORT', 8788);
const controlPort = portFrom('E2E_CONTROL_PORT', 8791);
const daemonControlPort = portFrom('E2E_DAEMON_PORT', 8792);

const operator = 'e2e-operator';
const hubUrl = `http://127.0.0.1:${hubPort}`;
const appHubUrl = `http://127.0.0.1:${proxyPort}`;

const log = (...args) => console.log('[e2e]', ...args);
const pm = createProcessManager(appDir);
const api = createApi(hubUrl, operator);

const cleanupStack = [];
function pushCleanup(description, fn) {
  cleanupStack.push({ description, fn });
}

let cleanupPromise = null;
function runAllCleanups() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    log('running cleanups in reverse order...');
    while (cleanupStack.length > 0) {
      const item = cleanupStack.pop();
      try {
        log(`cleaning up: ${item.description}`);
        await item.fn();
      } catch (err) {
        log(`cleanup failed for ${item.description}:`, err?.message || err);
      }
    }
    try {
      await pm.stopAll();
    } catch {}
    log('all cleanups finished');
  })();
  return cleanupPromise;
}

let daemon;
function startDaemon(code) {
  daemon = startFakeDaemon({
    hubDir,
    hubUrl,
    keyFile,
    controlPort: daemonControlPort,
    code,
    operatorToken: operator,
    logFile: daemonLog,
    start: pm.start,
  });
}
async function stopDaemon() {
  if (daemon) {
    const d = daemon;
    daemon = undefined;
    await pm.stop(d);
  }
}

function createHubProxy(targetPort) {
  let offline = false;
  const sockets = new Set();
  const server = net.createServer((client) => {
    if (offline) {
      client.destroy();
      return;
    }
    const upstream = net.connect(targetPort, '127.0.0.1');
    sockets.add(client);
    sockets.add(upstream);
    const drop = () => {
      sockets.delete(client);
      sockets.delete(upstream);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', drop);
    upstream.on('error', drop);
    client.on('close', () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      client.destroy();
    });
    client.pipe(upstream);
    upstream.pipe(client);
  });
  return {
    listen: (port) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      }),
    setOffline: (next) => {
      offline = next;
      if (offline) {
        for (const s of [...sockets]) s.destroy();
        sockets.clear();
      }
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of [...sockets]) s.destroy();
        sockets.clear();
        server.close(() => resolve());
      }),
  };
}

function deliveredCount(kind) {
  if (!fs.existsSync(daemonLog)) return 0;
  return fs
    .readFileSync(daemonLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry.kind === 'deliver' && entry.actionKind === kind).length;
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  const candidates = [
    '/opt/homebrew/opt/openjdk@17',
    '/opt/homebrew/opt/openjdk@21',
    '/opt/homebrew/opt/openjdk',
    '/usr/local/opt/openjdk@17',
    '/usr/local/opt/openjdk',
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function selectSimulatorUdid() {
  const targetUdid = process.env.E2E_IOS_UDID;
  const raw = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(raw);
  const devices = Object.entries(parsed.devices ?? {})
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([, list]) => list ?? []);

  if (targetUdid) {
    const target = devices.find((d) => d.udid === targetUdid);
    if (!target) throw new Error(`simulator ${targetUdid} not found or not available`);
    if (target.state === 'Booted') return { udid: targetUdid, bootedByUs: false };
    log(`booting iOS simulator ${target.name} (${target.udid})`);
    execFileSync('xcrun', ['simctl', 'boot', target.udid], { stdio: 'inherit' });
    return { udid: target.udid, bootedByUs: true };
  }

  const booted =
    devices.find((d) => d.state === 'Booted' && d.name.includes('iPhone')) ??
    devices.find((d) => d.state === 'Booted');
  if (booted) return { udid: booted.udid, bootedByUs: false };

  const fallback =
    devices.find((d) => d.isAvailable && d.name.includes('iPhone')) ??
    devices.find((d) => d.isAvailable);
  if (!fallback) throw new Error('no available iOS simulator found');
  log(`booting iOS simulator ${fallback.name} (${fallback.udid})`);
  execFileSync('xcrun', ['simctl', 'boot', fallback.udid], { stdio: 'inherit' });
  return { udid: fallback.udid, bootedByUs: true };
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? appDir,
      env: opts.env ?? process.env,
      stdio: 'inherit',
      detached: true,
    });

    let settled = false;
    const cleanupTask = {
      description: `command: ${cmd} ${args[0] ?? ''}`,
      fn: async () => {
        if (settled) return;
        settled = true;
        await killProcessGroup(child);
      },
    };
    cleanupStack.push(cleanupTask);

    child.on('exit', (code, signal) => {
      const idx = cleanupStack.indexOf(cleanupTask);
      if (idx !== -1) cleanupStack.splice(idx, 1);
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code ?? signal}`));
    });
    child.on('error', (err) => {
      const idx = cleanupStack.indexOf(cleanupTask);
      if (idx !== -1) cleanupStack.splice(idx, 1);
      settled = true;
      reject(err);
    });
  });
}

async function setup() {
  await needFree([hubPort, proxyPort, controlPort, daemonControlPort]);
  fs.mkdirSync(scratch, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(keyFile, { force: true });
  for (const logFile of [daemonLog, wranglerLog]) fs.writeFileSync(logFile, '');

  log('applying the hub D1 schema');
  initHubDb({ hubDir, stateDir });

  log('starting wrangler dev');
  const wranglerChild = await startWrangler({
    hubDir,
    stateDir,
    operator,
    hubOrigin: appHubUrl,
    port: hubPort,
    logFile: wranglerLog,
    start: pm.start,
    healthUrl: `${hubUrl}/healthz`,
  });
  pushCleanup('wrangler dev', () => pm.stop(wranglerChild));

  log('starting controllable hub proxy');
  const proxy = createHubProxy(hubPort);
  await proxy.listen(proxyPort);
  pushCleanup('hub proxy', () => proxy.close());

  log('creating the studio, projects, daemon, and customer');
  const seeded = await seedStudio({
    api,
    hubUrl,
    startDaemon,
    daemonLogLabel: '.beluga/scratch/e2e/daemon.log',
  });
  pushCleanup('fake daemon', () => stopDaemon());

  const sim = selectSimulatorUdid();
  const udid = sim.udid;
  if (sim.bootedByUs) {
    pushCleanup(`simulator shutdown (${udid})`, async () => {
      log(`shutting down simulator ${udid}`);
      try {
        execFileSync('xcrun', ['simctl', 'shutdown', udid], { stdio: 'ignore' });
      } catch {}
    });
  }

  if (process.env.TEST_ERROR_BEFORE_BUILD === '1') {
    throw new Error('intentional error before build for self-test');
  }

  const buildDir = path.join(scratch, 'ios-build');
  if (process.env.E2E_SKIP_BUILD !== '1') {
    fs.mkdirSync(buildDir, { recursive: true });
    log(`building iOS app (Release) into ${buildDir}`);
    await runCommand(
      'npx',
      ['expo', 'run:ios', '--no-bundler', '--configuration', 'Release', '--device', 'generic', '--output', buildDir],
      {
        env: {
          ...process.env,
          LANG: process.env.LANG || 'en_US.UTF-8',
          LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
          EXPO_PUBLIC_HUB_URL: appHubUrl,
        },
      },
    );
  }
  const appName = fs.readdirSync(buildDir).find((name) => name.endsWith('.app'));
  if (!appName) throw new Error(`no .app bundle found in ${buildDir}`);
  const appPath = path.join(buildDir, appName);

  return {
    udid,
    appPath,
    proxy,
    projectId: seeded.projectId,
    project2Id: seeded.project2Id,
    customerId: seeded.customerId,
    sessionJson: seeded.sessionJson,
  };
}

function reinstallApp(udid, appPath) {
  // Wipe iOS Keychain (expo-secure-store) and app container so every flow starts logged out.
  try {
    execFileSync('xcrun', ['simctl', 'uninstall', udid, 'com.synon.studio'], { stdio: 'ignore' });
  } catch {}
  try {
    execFileSync('xcrun', ['simctl', 'keychain', udid, 'reset'], { stdio: 'ignore' });
  } catch {}
  log(`installing ${path.basename(appPath)} onto simulator ${udid}`);
  execFileSync('xcrun', ['simctl', 'install', udid, appPath], { stdio: 'inherit' });
}

function expandFlowPaths(targets) {
  if (!targets.length) {
    return ['e2e/maestro/flow.yaml', 'e2e/maestro/plan.yaml'];
  }
  const flows = [];
  for (const target of targets) {
    const abs = path.resolve(appDir, target);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      const files = fs
        .readdirSync(abs)
        .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
        .sort()
        .map((name) => path.join(target, name));
      flows.push(...files);
    } else {
      flows.push(target);
    }
  }
  return flows;
}

async function main() {
  let exitCode = 0;
  let signaled = false;

  const onSignal = async (sig) => {
    if (signaled) return;
    signaled = true;
    exitCode = 1;
    log(`received ${sig}, stopping all processes and cleaning up...`);
    await runAllCleanups();
    process.exit(exitCode);
  };
  process.once('SIGINT', () => void onSignal('SIGINT'));
  process.once('SIGTERM', () => void onSignal('SIGTERM'));

  try {
    const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
    const flowPaths = expandFlowPaths(targets);

    const env = await setup();
    const proxy = env.proxy;

    const control = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${controlPort}`);
      console.log('[e2e] control', req.method, url.pathname);
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const readJson = async () => {
        let body = '';
        for await (const chunk of req) body += chunk;
        return body ? JSON.parse(body) : {};
      };

      if (req.method === 'GET' && url.pathname === '/env') {
        return send(200, {
          hubUrl: appHubUrl,
          projectId: env.projectId,
          project2Id: env.project2Id,
          customerId: env.customerId,
        });
      }
      if (req.method === 'GET' && url.pathname === '/login-link') {
        try {
          const login = await api(`/v1/admin/customers/${env.customerId}/login-link`, 'POST');
          const token = login.link.split('#token=')[1] ?? login.link.split('?token=')[1] ?? '';
          if (!token) return send(500, { error: 'login-link missing token' });
          return send(200, { link: `synon://login?token=${token}` });
        } catch (error) {
          return send(500, { error: String(error instanceof Error ? error.message : error) });
        }
      }
      if (req.method === 'POST' && url.pathname === '/hub/offline') {
        proxy.setOffline(true);
        return send(200, { ok: true, offline: true });
      }
      if (req.method === 'POST' && url.pathname === '/hub/online') {
        proxy.setOffline(false);
        return send(200, { ok: true, offline: false });
      }
      // 设备登记邀请：假的 daemon 发一次性码（k 留在 daemon），中台只存路由（SS-89）。
      if (req.method === 'POST' && url.pathname === '/invite') {
        try {
          const answer = await fetch(`http://127.0.0.1:${daemonControlPort}/invite`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          return send(answer.status, await answer.json().catch(() => ({})));
        } catch (error) {
          return send(502, { error: String(error instanceof Error ? error.message : error) });
        }
      }
      if (req.method === 'GET' && url.pathname === '/delivered') {
        const kind = url.searchParams.get('kind') ?? 'plan.create';
        return send(200, { kind, count: deliveredCount(kind) });
      }
      if (req.method === 'POST' && url.pathname === '/assert-delivered') {
        const payload = await readJson();
        const kind = payload.kind ?? 'plan.create';
        const expected =
          typeof payload.expected === 'number'
            ? payload.expected
            : Number(payload.baseline ?? 0) + Number(payload.delta ?? 0);
        const waitMs = Number(payload.delta ?? 0) > 0 || (typeof payload.expected === 'number' && payload.expected > 0) ? 5_000 : 0;
        const deadline = Date.now() + waitMs;
        let actual = deliveredCount(kind);
        while (actual < expected && Date.now() < deadline) {
          await sleep(100);
          actual = deliveredCount(kind);
        }
        if (actual !== expected) {
          return send(400, { error: `expected ${kind} count ${expected}, got ${actual}`, kind, expected, actual });
        }
        return send(200, { ok: true, kind, actual });
      }
      if (req.method === 'POST' && url.pathname === '/daemon/stop') {
        await stopDaemon();
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/daemon/start') {
        if (daemon && daemon.exitCode === null) return send(200, { ok: true, already: true });
        startDaemon();
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && (url.pathname === '/daemon/view' || url.pathname === '/daemon/approve' || url.pathname === '/daemon/reset' || url.pathname === '/daemon/revoke-device')) {
        const payload = await readJson();
        let forwardBody = payload;
        if (url.pathname === '/daemon/view' && typeof payload.name === 'string') {
          const baseView = views[payload.name];
          if (!baseView) return send(400, { error: `unknown view fixture: ${payload.name}` });
          forwardBody = { view: payload.patch ? { ...baseView, ...payload.patch } : baseView };
        }
        try {
          const answer = await fetch(`http://127.0.0.1:${daemonControlPort}${url.pathname.replace('/daemon', '')}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(forwardBody),
          });
          return send(answer.status, await answer.json().catch(() => ({})));
        } catch (error) {
          return send(502, { error: String(error instanceof Error ? error.message : error) });
        }
      }
      return send(404, { error: 'unknown' });
    });
    await new Promise((resolve, reject) => {
      control.once('error', reject);
      control.listen(controlPort, '127.0.0.1', resolve);
    });
    pushCleanup('control server', async () => {
      control.closeAllConnections?.();
      await new Promise((resolve) => control.close(resolve));
    });

    const javaHome = resolveJavaHome();
    const maestroEnv = {
      ...process.env,
      ...(javaHome ? { JAVA_HOME: javaHome } : {}),
      MAESTRO_E2E_CONTROL: `http://127.0.0.1:${controlPort}`,
      MAESTRO_E2E_PROJECT_ID: env.projectId,
      MAESTRO_E2E_PROJECT2_ID: env.project2Id,
    };

    const maestroArgs = [
      '--udid',
      env.udid,
      '--test-output-dir',
      outDir,
      '-e',
      `E2E_CONTROL=http://127.0.0.1:${controlPort}`,
      '-e',
      `E2E_PROJECT_ID=${env.projectId}`,
      '-e',
      `E2E_PROJECT2_ID=${env.project2Id}`,
    ];

    for (let i = 0; i < flowPaths.length; i += 1) {
      const flowFile = flowPaths[i];
      proxy.setOffline(false);
      if (i > 0) {
        await fetch(`http://127.0.0.1:${controlPort}/daemon/start`, { method: 'POST' });
        await fetch(`http://127.0.0.1:${controlPort}/daemon/reset`, { method: 'POST' });
      }
      reinstallApp(env.udid, env.appPath);
      log(`running Maestro test (${flowFile})`);
      await runCommand('maestro', ['test', ...maestroArgs, flowFile], { env: maestroEnv });
    }
    log(`screenshots and reports in ${outDir}`);
  } catch (error) {
    exitCode = 1;
    console.error('[e2e] failed:', error instanceof Error ? error.message : error);
    console.error('[e2e] logs: .beluga/scratch/e2e/{wrangler,daemon}.log');
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await runAllCleanups();
    process.exit(exitCode);
  }
}

await main();
