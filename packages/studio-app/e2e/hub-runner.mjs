import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const tail = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').slice(-30).join('\n');
  } catch {
    return '';
  }
};

function isGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e2) {
      return e2.code === 'EPERM';
    }
  }
}

export async function killProcessGroup(childOrPid, timeoutMs = 3000) {
  const pid = typeof childOrPid === 'number' ? childOrPid : childOrPid?.pid;
  if (!pid) return;

  if (!isGroupAlive(pid)) return;

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isGroupAlive(pid)) return;
    await sleep(50);
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }

  const killStart = Date.now();
  while (Date.now() - killStart < 1000) {
    if (!isGroupAlive(pid)) return;
    await sleep(50);
  }
}

export function createProcessManager(defaultCwd) {
  const children = new Set();

  function start(name, command, args, opts = {}) {
    const fd = opts.log ? fs.openSync(opts.log, 'a') : 'inherit';
    const child = spawn(command, args, {
      cwd: opts.cwd ?? defaultCwd,
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

  async function stop(child, timeoutMs = 2500) {
    if (!child) return;
    children.delete(child);
    await killProcessGroup(child, timeoutMs);
  }

  async function stopAll(timeoutMs = 2500) {
    const list = [...children];
    children.clear();
    await Promise.all(list.map((c) => killProcessGroup(c, timeoutMs)));
  }

  return { children, start, stop, stopAll };
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function needFree(ports) {
  const busy = [];
  for (const port of ports) if (!(await portFree(port))) busy.push(port);
  if (busy.length) {
    throw new Error(
      `port ${busy.join(', ')} is already in use (another hub, proxy or e2e run?): see \`lsof -nP -iTCP:${busy[0]} -sTCP:LISTEN\` and stop it first`,
    );
  }
}

export async function waitFor(url, timeout = 60_000, child, childLog) {
  const from = Date.now();
  while (Date.now() - from < timeout) {
    if (child && child.exitCode !== null) {
      throw new Error(`it stopped (exit ${child.exitCode}) before ${url} answered:\n${childLog ? tail(childLog) : ''}`);
    }
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

export function createApi(hubUrl, operator) {
  return async function api(pathname, method = 'GET', body) {
    const res = await fetch(`${hubUrl}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${operator}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
}

export function initHubDb({ hubDir, stateDir }) {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'synon-studio', '--local', '--persist-to', stateDir, '--file', 'schema.sql'],
    { cwd: hubDir, stdio: 'inherit' },
  );
}

export async function startWrangler({
  hubDir,
  stateDir,
  operator,
  hubOrigin,
  port = 8787,
  ip,
  logFile,
  start,
  healthUrl = `http://127.0.0.1:${port}/healthz`,
}) {
  const args = [
    'wrangler',
    'dev',
    '--port',
    String(port),
    '--persist-to',
    stateDir,
    '--var',
    `OPERATOR_TOKEN:${operator}`,
    '--var',
    'MAIL_MODE:outbox',
    '--var',
    `HUB_ORIGIN:${hubOrigin}`,
  ];
  if (ip) args.push('--ip', ip);
  const child = start('wrangler', 'npx', args, { cwd: hubDir, log: logFile });
  await waitFor(healthUrl, 60_000, child, logFile);
  return child;
}

export function startFakeDaemon({
  hubDir,
  hubUrl,
  keyFile,
  projects = ['dp1', 'dp2'],
  name = 'E2E Studio Mac',
  interval = 1000,
  controlPort = 8792,
  code,
  logFile,
  start,
}) {
  const args = [
    path.join(hubDir, 'scripts/fake-daemon.mjs'),
    '--hub',
    hubUrl,
    '--key-file',
    keyFile,
    ...projects.flatMap((p) => ['--project', p]),
    '--name',
    name,
    '--interval',
    String(interval),
    '--control-port',
    String(controlPort),
  ];
  if (code) args.push('--code', code);
  return start('daemon', process.execPath, args, { cwd: hubDir, log: logFile });
}

export async function seedStudio({
  api,
  hubUrl,
  studioName = 'E2E Studio',
  projectNames = ['饮水打卡', '门店预约'],
  customerEmail = 'e2e@example.test',
  customerName = 'E2E 客户',
  startDaemon,
  daemonLogLabel = '.beluga/scratch/m6/daemon.log',
}) {
  const studio = await api('/v1/admin/studios', 'POST', { name: studioName });
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
  if (!dp1 || !dp2) throw new Error(`the fake daemon did not report dp1 and dp2; see ${daemonLogLabel}`);

  const p1 = await api(`/v1/admin/studios/${sid}/projects`, 'POST', { name: projectNames[0] });
  const p2 = await api(`/v1/admin/studios/${sid}/projects`, 'POST', { name: projectNames[1] });
  const projectId = p1.project.id;
  const project2Id = p2.project.id;
  await api(`/v1/admin/projects/${projectId}/daemon`, 'PUT', { daemonId: dp1.daemonId, daemonProjectId: 'dp1' });
  await api(`/v1/admin/projects/${project2Id}/daemon`, 'PUT', { daemonId: dp2.daemonId, daemonProjectId: 'dp2' });

  const customer = await api('/v1/admin/customers', 'POST', { email: customerEmail, name: customerName });
  const customerId = customer.customer.id;
  await api(`/v1/admin/projects/${projectId}/members/${customerId}`, 'PUT');
  await api(`/v1/admin/projects/${project2Id}/members/${customerId}`, 'PUT');

  const login = await api(`/v1/admin/customers/${customerId}/login-link`, 'POST');
  const token = login.link.split('#token=')[1];
  const verified = await fetch(`${hubUrl}/v1/login/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then((r) => r.json());
  if (!verified.session) throw new Error('the setup session was not created');
  const session = verified.session;

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
  if (!cached) throw new Error(`the plans never reached the hub; see ${daemonLogLabel}`);

  return {
    studioId: sid,
    projectId,
    project2Id,
    customerId,
    sessionJson: JSON.stringify({ session, expiresAt: verified.expiresAt, customerId: verified.customerId }),
  };
}
