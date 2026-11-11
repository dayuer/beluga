#!/usr/bin/env node
/**
 * The M5 end-to-end run: build the app, start the real hub (wrangler dev with a throwaway D1/DO
 * state), the same-origin proxy, and a fake daemon. Create a studio, map two projects, invite one
 * customer, then run Playwright at 390×844 and 1440×900.
 *
 * Everything the run starts is stopped at the end. Screenshots and logs go to .beluga/scratch/m5.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repo = path.resolve(appDir, '../..');
const hubDir = path.join(repo, 'packages/studio-hub');
const scratch = path.join(repo, '.beluga/scratch/m5');
const stateDir = path.join(scratch, 'hub-state');
const keyFile = path.join(scratch, 'daemon.pem');
const daemonLog = path.join(scratch, 'daemon.log');
const wranglerLog = path.join(scratch, 'wrangler.log');
const proxyLog = path.join(scratch, 'proxy.log');
const controlPort = 8791;

const operator = 'e2e-operator';
const hubUrl = 'http://127.0.0.1:8787';
const appUrl = 'http://localhost:8790';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log('[e2e]', ...args);

const children = new Set();
function start(name, command, args, opts = {}) {
  const fd = opts.log ? fs.openSync(opts.log, 'a') : 'inherit';
  const child = spawn(command, args, {
    cwd: opts.cwd ?? appDir,
    env: opts.env ?? process.env,
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  children.add(child);
  child.on('exit', () => {
    children.delete(child);
    if (typeof fd === 'number') {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  });
  return child;
}

function stop(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

async function waitFor(url, timeout = 60_000) {
  const from = Date.now();
  while (Date.now() - from < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function api(pathname, method = 'GET', body) {
  const res = await fetch(`${hubUrl}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${operator}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

let daemon;
function startDaemon(code) {
  const args = [
    path.join(hubDir, 'scripts/fake-daemon.mjs'),
    '--hub',
    hubUrl,
    '--key-file',
    keyFile,
    '--project',
    'dp1',
    '--project',
    'dp2',
    '--name',
    'E2E Studio Mac',
    '--interval',
    '1000',
  ];
  if (code) args.push('--code', code);
  daemon = start('daemon', process.execPath, args, { cwd: hubDir, log: daemonLog });
}
function stopDaemon() {
  if (daemon) {
    stop(daemon);
    daemon = undefined;
  }
}

async function setup() {
  fs.mkdirSync(scratch, { recursive: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(keyFile, { force: true });
  for (const logFile of [daemonLog, wranglerLog, proxyLog]) fs.writeFileSync(logFile, '');

  log('building the app (expo export -p web)');
  execFileSync('npm', ['run', 'export'], { cwd: appDir, stdio: 'inherit' });

  log('applying the hub D1 schema');
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'synon-studio', '--local', '--persist-to', stateDir, '--file', 'schema.sql'],
    { cwd: hubDir, stdio: 'inherit' },
  );

  log('starting wrangler dev');
  start('wrangler', 'npx', [
    'wrangler',
    'dev',
    '--port',
    '8787',
    '--persist-to',
    stateDir,
    '--var',
    `OPERATOR_TOKEN:${operator}`,
    '--var',
    'MAIL_MODE:outbox',
    '--var',
    `HUB_ORIGIN:${appUrl}`,
  ], { cwd: hubDir, log: wranglerLog });
  await waitFor(`${hubUrl}/healthz`);

  log('starting the same-origin proxy');
  start('proxy', process.execPath, [path.join(appDir, 'scripts/dev-proxy.mjs'), '--dist'], {
    cwd: appDir,
    env: { ...process.env, PORT: '8790', HUB_PORT: '8787' },
    log: proxyLog,
  });
  await waitFor(`${appUrl}/login`);

  log('creating the studio and the daemon');
  const studio = await api('/v1/admin/studios', 'POST', { name: 'E2E Studio' });
  const sid = studio.studio.id;
  startDaemon(studio.linkCode.code);

  let entries = [];
  for (let i = 0; i < 80; i++) {
    const detail = await api(`/v1/admin/studios/${sid}`);
    const synced = (detail.daemons ?? []).some((d) => d.synced);
    entries = (detail.daemonProjects ?? []).filter((p) => p.projectId === 'dp1' || p.projectId === 'dp2');
    if (synced && new Set(entries.map((e) => e.projectId)).size === 2) break;
    await sleep(250);
  }
  const dp1 = entries.find((e) => e.projectId === 'dp1');
  const dp2 = entries.find((e) => e.projectId === 'dp2');
  if (!dp1 || !dp2) throw new Error('the fake daemon did not report dp1 and dp2; see .beluga/scratch/m5/daemon.log');

  log('creating two projects, mapping them and inviting the customer');
  const p1 = await api(`/v1/admin/studios/${sid}/projects`, 'POST', { name: '饮水打卡' });
  const p2 = await api(`/v1/admin/studios/${sid}/projects`, 'POST', { name: '门店预约' });
  const projectId = p1.project.id;
  const project2Id = p2.project.id;
  await api(`/v1/admin/projects/${projectId}/daemon`, 'PUT', { daemonId: dp1.daemonId, daemonProjectId: 'dp1' });
  await api(`/v1/admin/projects/${project2Id}/daemon`, 'PUT', { daemonId: dp2.daemonId, daemonProjectId: 'dp2' });
  const customer = await api('/v1/admin/customers', 'POST', { email: 'e2e@example.test', name: 'E2E 客户' });
  const customerId = customer.customer.id;
  await api(`/v1/admin/projects/${projectId}/members/${customerId}`, 'PUT');
  await api(`/v1/admin/projects/${project2Id}/members/${customerId}`, 'PUT');

  // A session for the tests after the first (the link is single-use and capped at five an hour),
  // and a poll that proves the daemon's snapshots are in the hub's cache before Playwright starts.
  const login = await api(`/v1/admin/customers/${customerId}/login-link`, 'POST');
  const token = login.link.split('#token=')[1];
  const verified = await fetch(`${hubUrl}/v1/login/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then((r) => r.json());
  if (!verified.session) throw new Error('the setup session was not created');
  const session = verified.session;

  log('waiting for both plans to reach the hub');
  const plans = async (pid) => {
    const res = await fetch(`${hubUrl}/v1/app/projects/${pid}/plans`, { headers: { authorization: `Bearer ${session}` } });
    return res.ok ? res.json() : null;
  };
  let cached = false;
  for (let i = 0; i < 60; i++) {
    const a = await plans(projectId);
    const b = await plans(project2Id);
    if (a?.plans?.length > 0 && b?.plans?.length > 0) {
      cached = true;
      break;
    }
    await sleep(500);
  }
  if (!cached) throw new Error('the plans never reached the hub; see .beluga/scratch/m5/daemon.log');

  return {
    projectId,
    project2Id,
    customerId,
    sessionJson: JSON.stringify({ session, expiresAt: verified.expiresAt, customerId: verified.customerId }),
  };
}

async function main() {
  let control;
  let failed = false;
  try {
    const env = await setup();

    control = http.createServer(async (req, res) => {
      console.log('[e2e] control', req.method, req.url);
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/daemon/stop') {
        stopDaemon();
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && req.url === '/daemon/start') {
        if (daemon && daemon.exitCode === null) return send(200, { ok: true, already: true });
        startDaemon();
        return send(200, { ok: true });
      }
      return send(404, { error: 'unknown' });
    });
    await new Promise((resolve, reject) => {
      control.once('error', reject);
      control.listen(controlPort, '127.0.0.1', resolve);
    });

    log('running Playwright');
    // Not spawnSync: the control server that stops/starts the daemon lives in this process and
    // must keep answering while Playwright runs.
    const status = await new Promise((resolve, reject) => {
      const child = spawn('npx', ['playwright', 'test', '--config', 'e2e/playwright.config.ts'], {
        cwd: appDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          E2E_BASE: appUrl,
          E2E_HUB: hubUrl,
          E2E_OPERATOR: operator,
          E2E_CUSTOMER: env.customerId,
          E2E_PROJECT_ID: env.projectId,
          E2E_PROJECT2_ID: env.project2Id,
          E2E_SESSION: env.sessionJson,
          E2E_CONTROL: `http://127.0.0.1:${controlPort}`,
          E2E_DAEMON_LOG: daemonLog,
          E2E_SCRATCH: scratch,
        },
      });
      child.on('exit', (code) => resolve(code));
      child.on('error', reject);
    });
    if (status !== 0) throw new Error(`Playwright exited ${status ?? 'by signal'}`);
    log(`screenshots in ${scratch}`);
  } catch (error) {
    failed = true;
    console.error('[e2e] failed:', error instanceof Error ? error.message : error);
    console.error('[e2e] logs: .beluga/scratch/m5/{wrangler,proxy,daemon}.log');
  } finally {
    if (control) {
      control.closeAllConnections?.();
      await new Promise((resolve) => control.close(resolve));
    }
    stopDaemon();
    for (const child of [...children]) stop(child);
    await sleep(600);
  }
  if (failed) process.exitCode = 1;
}

await main();
