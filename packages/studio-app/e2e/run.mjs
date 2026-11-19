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
import {
  createApi,
  createProcessManager,
  initHubDb,
  needFree,
  seedStudio,
  sleep,
  startFakeDaemon,
  startWrangler,
  waitFor,
} from './hub-runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repo = path.resolve(appDir, '../..');
const hubDir = path.join(repo, 'packages/studio-hub');
// M6's run keeps its screenshots and logs here; the M5 files stay where they were.
const scratch = path.join(repo, '.beluga/scratch/m6');
const stateDir = path.join(scratch, 'hub-state');
const keyFile = path.join(scratch, 'daemon.pem');
const daemonLog = path.join(scratch, 'daemon.log');
const wranglerLog = path.join(scratch, 'wrangler.log');
const proxyLog = path.join(scratch, 'proxy.log');
const controlPort = 8791;
const daemonControlPort = 8792;

const operator = 'e2e-operator';
const hubUrl = 'http://127.0.0.1:8787';
const appUrl = 'http://localhost:8790';

const log = (...args) => console.log('[e2e]', ...args);
const pm = createProcessManager(appDir);
const api = createApi(hubUrl, operator);

let daemon;
function startDaemon(code) {
  daemon = startFakeDaemon({
    hubDir,
    hubUrl,
    keyFile,
    controlPort: daemonControlPort,
    code,
    logFile: daemonLog,
    start: pm.start,
  });
}
function stopDaemon() {
  if (daemon) {
    pm.stop(daemon);
    daemon = undefined;
  }
}

async function setup() {
  await needFree([8787, 8790, controlPort, daemonControlPort]);
  fs.mkdirSync(scratch, { recursive: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(keyFile, { force: true });
  for (const logFile of [daemonLog, wranglerLog, proxyLog]) fs.writeFileSync(logFile, '');

  log('building the app (expo export -p web)');
  execFileSync('npm', ['run', 'export'], { cwd: appDir, stdio: 'inherit' });

  log('applying the hub D1 schema');
  initHubDb({ hubDir, stateDir });

  log('starting wrangler dev');
  await startWrangler({
    hubDir,
    stateDir,
    operator,
    hubOrigin: appUrl,
    port: 8787,
    logFile: wranglerLog,
    start: pm.start,
    healthUrl: `${hubUrl}/healthz`,
  });

  log('starting the same-origin proxy');
  const proxy = pm.start('proxy', process.execPath, [path.join(appDir, 'scripts/dev-proxy.mjs'), '--dist'], {
    cwd: appDir,
    env: { ...process.env, PORT: '8790', HUB_PORT: '8787' },
    log: proxyLog,
  });
  await waitFor(`${appUrl}/login`, 60_000, proxy, proxyLog);

  log('creating the studio, projects, daemon, and customer');
  const seeded = await seedStudio({
    api,
    hubUrl,
    startDaemon,
    daemonLogLabel: '.beluga/scratch/m6/daemon.log',
  });

  return {
    projectId: seeded.projectId,
    project2Id: seeded.project2Id,
    customerId: seeded.customerId,
    sessionJson: seeded.sessionJson,
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
      // The fake daemon's own control port: push a view fixture, approve the start gate, reset.
      if (req.method === 'POST' && (req.url === '/daemon/view' || req.url === '/daemon/approve' || req.url === '/daemon/reset')) {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const answer = await fetch(`http://127.0.0.1:${daemonControlPort}${req.url.replace('/daemon', '')}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
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
    console.error('[e2e] logs: .beluga/scratch/m6/{wrangler,proxy,daemon}.log');
  } finally {
    if (control) {
      control.closeAllConnections?.();
      await new Promise((resolve) => control.close(resolve));
    }
    stopDaemon();
    pm.stopAll();
    await sleep(600);
  }
  if (failed) process.exitCode = 1;
}

await main();
