#!/usr/bin/env node
/**
 * Start the local hub (wrangler dev on 0.0.0.0:8787) and fake daemon, seed sample data from
 * e2e/fixtures/views.ts, and print the LAN URL + native deep-link login commands.
 *
 * Pass --login to mint a fresh one-time token against the running dev:device hub without
 * restarting services. Pass --smoke to boot, print, and shut down cleanly.
 */
import fs from 'node:fs';
import os from 'node:os';
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
} from '../e2e/hub-runner.mjs';
import { views } from '../e2e/fixtures/views.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repo = path.resolve(appDir, '../..');
const hubDir = path.join(repo, 'packages/studio-hub');
const scratch = path.join(repo, '.beluga/scratch/dev-device');
const stateDir = path.join(scratch, 'hub-state');
const sessionMetaFile = path.join(scratch, 'session.json');
const keyFile = path.join(scratch, 'daemon.pem');
const daemonLog = path.join(scratch, 'daemon.log');
const wranglerLog = path.join(scratch, 'wrangler.log');

const port = Number(process.env.HUB_PORT || 8787);
const daemonControlPort = Number(process.env.DAEMON_CONTROL_PORT || 8792);
const operator = 'dev-operator';
const localHubUrl = `http://127.0.0.1:${port}`;
const smoke = process.argv.includes('--smoke');
const loginOnly = process.argv.includes('--login');

const log = (...args) => console.log('[dev:device]', ...args);
const pm = createProcessManager(appDir);
const api = createApi(localHubUrl, operator);

function findLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const entries of Object.values(ifaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) candidates.push(entry.address);
    }
  }
  return candidates.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.')) ?? candidates[0] ?? '127.0.0.1';
}

function extractToken(loginRes) {
  const link = loginRes?.link ?? '';
  const hashIdx = link.indexOf('#token=');
  if (hashIdx !== -1) return link.slice(hashIdx + '#token='.length);
  const queryIdx = link.indexOf('?token=');
  if (queryIdx !== -1) return link.slice(queryIdx + '?token='.length);
  return '';
}

function printLoginCommands(token) {
  const deepLink = `synon://login?token=${token}`;
  console.log(`Deep link: ${deepLink}`);
  console.log(`Android:   adb shell am start -a android.intent.action.VIEW -d "${deepLink}" com.synon.studio`);
  console.log(`iOS (dev): xcrun devicectl device process launch --device <id> --payload-url "${deepLink}" com.synon.studio`);
  console.log(`iOS (sim): xcrun simctl openurl booted "${deepLink}"`);
}

async function mintLoginOnly() {
  let customerId;
  try {
    const meta = JSON.parse(fs.readFileSync(sessionMetaFile, 'utf8'));
    customerId = meta.customerId;
  } catch {
    /* fallback below */
  }
  if (!customerId) {
    throw new Error('no running dev:device session metadata found; start `npm run dev:device` first');
  }
  const freshLogin = await api(`/v1/admin/customers/${customerId}/login-link`, 'POST');
  const token = extractToken(freshLogin);
  if (!token) throw new Error('hub returned login-link without token');
  printLoginCommands(token);
}

async function pushView(project, view) {
  const res = await fetch(`http://127.0.0.1:${daemonControlPort}/view`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project, view }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`failed to push fixture view for ${project}: ${res.status} ${text}`);
  }
}

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('stopping hub and fake daemon...');
  pm.stopAll('SIGTERM');
  await sleep(500);
  pm.stopAll('SIGKILL');
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

async function main() {
  if (loginOnly) {
    await mintLoginOnly();
    return;
  }

  await needFree([port, daemonControlPort]);
  fs.mkdirSync(scratch, { recursive: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(keyFile, { force: true });
  for (const f of [daemonLog, wranglerLog]) fs.writeFileSync(f, '');

  const lanIp = findLanIp();
  const lanHubUrl = `http://${lanIp}:${port}`;

  log('applying the hub D1 schema');
  initHubDb({ hubDir, stateDir });

  log(`starting wrangler dev on 0.0.0.0:${port}`);
  await startWrangler({
    hubDir,
    stateDir,
    operator,
    hubOrigin: lanHubUrl,
    port,
    ip: '0.0.0.0',
    logFile: wranglerLog,
    start: pm.start,
    healthUrl: `${localHubUrl}/healthz`,
  });

  log('seeding studio, projects, fake daemon, and customer');
  const seeded = await seedStudio({
    api,
    hubUrl: localHubUrl,
    studioName: 'Dev Studio',
    customerEmail: 'dev@example.test',
    customerName: '真机测试客户',
    daemonLogLabel: '.beluga/scratch/dev-device/daemon.log',
    startDaemon: (code) =>
      startFakeDaemon({
        hubDir,
        hubUrl: localHubUrl,
        keyFile,
        name: 'Dev Studio Mac',
        controlPort: daemonControlPort,
        code,
        logFile: daemonLog,
        start: pm.start,
      }),
  });

  fs.writeFileSync(sessionMetaFile, JSON.stringify({ customerId: seeded.customerId, hubUrl: localHubUrl }, null, 2));

  log('pushing sample plan fixtures from e2e/fixtures/views.ts');
  await pushView('dp1', views.running);
  await pushView('dp2', views.review);

  const freshLogin = await api(`/v1/admin/customers/${seeded.customerId}/login-link`, 'POST');
  const freshToken = extractToken(freshLogin);

  console.log('');
  console.log('============================================================');
  console.log(`Hub LAN URL (EXPO_PUBLIC_HUB_URL): ${lanHubUrl}`);
  console.log('Customer email: dev@example.test');
  if (freshToken) printLoginCommands(freshToken);
  console.log('');
  console.log('Run on device:');
  console.log(`  EXPO_PUBLIC_HUB_URL=${lanHubUrl} npm run android`);
  console.log(`  EXPO_PUBLIC_HUB_URL=${lanHubUrl} npm run ios -- --device`);
  console.log('');
  console.log('Mint another one-time login link while running:');
  console.log('  npm run dev:device -- --login');
  console.log('');
  console.log('Logs: .beluga/scratch/dev-device/{wrangler,daemon}.log');
  console.log('Press Ctrl-C to stop.');
  console.log('============================================================');
  console.log('');

  if (smoke) {
    await shutdown(0);
    return;
  }

  await new Promise(() => {});
}

main().catch(async (err) => {
  console.error('[dev:device] failed:', err instanceof Error ? err.message : err);
  if (!loginOnly) console.error('[dev:device] logs: .beluga/scratch/dev-device/{wrangler,daemon}.log');
  await shutdown(1);
});
