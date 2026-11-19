#!/usr/bin/env node
/**
 * iOS simulator end-to-end runner using Maestro:
 * 1) Start the real hub (wrangler dev) and fake daemon, seed a studio/projects/customer.
 * 2) Build and install the iOS app onto a booted iOS simulator with EXPO_PUBLIC_HUB_URL pointing to the local hub.
 * 3) Run `maestro test e2e/maestro`, writing screenshots and reports to `e2e/out/`.
 * 4) Always stop every started child process on success or failure.
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
} from './hub-runner.mjs';

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
const controlPort = 8791;
const daemonControlPort = 8792;

const operator = 'e2e-operator';
const hubUrl = 'http://127.0.0.1:8787';

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
  if (process.env.E2E_IOS_UDID) return process.env.E2E_IOS_UDID;
  const raw = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(raw);
  const devices = Object.entries(parsed.devices ?? {})
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([, list]) => list ?? []);
  const booted = devices.find((d) => d.state === 'Booted' && d.name.includes('iPhone'))
    ?? devices.find((d) => d.state === 'Booted');
  if (booted) return booted.udid;

  const fallback = devices.find((d) => d.isAvailable && d.name.includes('iPhone')) ?? devices.find((d) => d.isAvailable);
  if (!fallback) throw new Error('no available iOS simulator found');
  log(`booting iOS simulator ${fallback.name} (${fallback.udid})`);
  execFileSync('xcrun', ['simctl', 'boot', fallback.udid], { stdio: 'inherit' });
  return fallback.udid;
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? appDir,
      env: opts.env ?? process.env,
      stdio: 'inherit',
    });
    pm.children.add(child);
    child.on('exit', (code, signal) => {
      pm.children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code ?? signal}`));
    });
    child.on('error', (err) => {
      pm.children.delete(child);
      reject(err);
    });
  });
}

async function setup() {
  await needFree([8787, controlPort, daemonControlPort]);
  fs.mkdirSync(scratch, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(keyFile, { force: true });
  for (const logFile of [daemonLog, wranglerLog]) fs.writeFileSync(logFile, '');

  log('applying the hub D1 schema');
  initHubDb({ hubDir, stateDir });

  log('starting wrangler dev');
  await startWrangler({
    hubDir,
    stateDir,
    operator,
    hubOrigin: hubUrl,
    port: 8787,
    logFile: wranglerLog,
    start: pm.start,
    healthUrl: `${hubUrl}/healthz`,
  });

  log('creating the studio, projects, daemon, and customer');
  const seeded = await seedStudio({
    api,
    hubUrl,
    startDaemon,
    daemonLogLabel: '.beluga/scratch/e2e/daemon.log',
  });

  const udid = selectSimulatorUdid();
  const buildDir = path.join(scratch, 'ios-build');
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
        EXPO_PUBLIC_HUB_URL: hubUrl,
      },
    },
  );
  const appName = fs.readdirSync(buildDir).find((name) => name.endsWith('.app'));
  if (!appName) throw new Error(`no .app bundle found in ${buildDir}`);
  const appPath = path.join(buildDir, appName);
  log(`installing ${appName} onto simulator ${udid}`);
  execFileSync('xcrun', ['simctl', 'install', udid, appPath], { stdio: 'inherit' });

  return {
    udid,
    projectId: seeded.projectId,
    project2Id: seeded.project2Id,
    customerId: seeded.customerId,
    sessionJson: seeded.sessionJson,
  };
}

let cleaningUp = false;
async function cleanup(control) {
  if (cleaningUp) return;
  cleaningUp = true;
  if (control) {
    control.closeAllConnections?.();
    await new Promise((resolve) => control.close(resolve));
  }
  stopDaemon();
  pm.stopAll('SIGTERM');
  await sleep(600);
  pm.stopAll('SIGKILL');
}

async function main() {
  let control;
  let failed = false;

  const onSignal = () => {
    void cleanup(control).finally(() => process.exit(1));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

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

    const javaHome = resolveJavaHome();
    const maestroEnv = {
      ...process.env,
      ...(javaHome ? { JAVA_HOME: javaHome } : {}),
      E2E_HUB: hubUrl,
      E2E_OPERATOR: operator,
      E2E_CUSTOMER: env.customerId,
      E2E_PROJECT_ID: env.projectId,
      E2E_PROJECT2_ID: env.project2Id,
      E2E_CONTROL: `http://127.0.0.1:${controlPort}`,
      E2E_OUT: outDir,
    };

    log('running Maestro tests');
    await runCommand(
      'maestro',
      ['test', '--udid', env.udid, '--test-output-dir', outDir, 'e2e/maestro'],
      { env: maestroEnv },
    );
    log(`screenshots and reports in ${outDir}`);
  } catch (error) {
    failed = true;
    console.error('[e2e] failed:', error instanceof Error ? error.message : error);
    console.error('[e2e] logs: .beluga/scratch/e2e/{wrangler,daemon}.log');
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await cleanup(control);
  }
  if (failed) process.exitCode = 1;
}

await main();
