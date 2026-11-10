#!/usr/bin/env node
/**
 * A fake Studio daemon for local development and the admin-page screenshot (BLG-61).
 *
 * It registers a fresh Ed25519 key with a one-time link code, connects the signed daemon socket,
 * says `hello` with the projects it "has", pushes a full view for each of them, then `synced`.
 * It keeps updating the views, answers deliveries with a done receipt, and reconnects (with a new
 * timestamp) when the socket closes or on SIGUSR2.
 *
 *   node scripts/fake-daemon.mjs --hub http://localhost:8787 --code AB12-CD34 \
 *     --name "Studio Mac" --project dp1 --project dp2 [--interval 4000]
 *
 * Every important step is one JSON line on stdout: {"kind":"registered"|"open"|"sent"|"recv"|"closed",...}.
 */

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import WebSocket from 'ws';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};
const flags = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]] : []));

const hub = (flag('hub', 'http://localhost:8787')).replace(/\/$/, '');
const code = flag('code');
const name = flag('name', 'Fake Studio Mac');
const projects = flags('project');
const interval = Number(flag('interval', '4000'));

if (!code || projects.length === 0) {
  console.error('usage: node scripts/fake-daemon.mjs --hub <origin> --code <XXXX-XXXX> --project <id> [--project <id>] [--name <name>] [--interval ms]');
  process.exit(2);
}

const log = (kind, extra = {}) => console.log(JSON.stringify({ kind, at: Date.now(), ...extra }));

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const der = publicKey.export({ type: 'spki', format: 'der' });
const key = der.toString('base64');
const daemonId = createHash('sha256').update(der).digest('base64url').slice(0, 32);
const signText = (text) => sign(null, Buffer.from(`synon-studio-v1:${text}`), privateKey).toString('base64');

const view = (planRef, rev) => ({
  planRef,
  draftRev: 1,
  title: `客户 App · ${planRef}`,
  goal: '做一个客户预约页面',
  stage: 'running',
  waitingOn: 'ai',
  headline: `在做：第 ${rev} 次更新`,
  progress: { done: 1, total: 3 },
  milestones: [
    {
      ref: 'm0',
      title: '登录',
      criteria: ['可以登录', '客户能看懂'],
      status: 'working',
      tasks: [{ ref: 'm0-t0', title: '登录页', acceptance: ['能登录'], status: 'doing' }],
    },
  ],
  decisions: [],
  turns: [{ id: 't1', who: 'ai', text: '开始做登录页了', at: Date.now() }],
  typing: false,
  moreTurns: false,
  activity: [{ at: Date.now(), text: '开始了一项工作' }],
});

let ws;
let synced = false;
let stopping = false;
let rev = 0;
const plans = projects.map((project, i) => ({ project, planRef: `plan${i + 1}` }));

function send(frame) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(frame));
  log('sent', { t: frame.t, ...(frame.project ? { project: frame.project } : {}), ...(frame.frame?.view?.planRef ? { planRef: frame.frame.view.planRef } : {}) });
}

function snapshot(entry) {
  rev += 1;
  send({ t: 'for', project: entry.project, frame: { t: 'plan', rev, view: view(entry.planRef, rev) } });
}

function pushAll() {
  for (const entry of plans) snapshot(entry);
  send({ t: 'synced' });
  synced = true;
}

async function register() {
  const at = Date.now();
  const res = await fetch(`${hub}/v1/link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, key, name, at, sig: signText(`link:${code}:${at}`) }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`link failed: ${res.status} ${JSON.stringify(body)}`);
  log('registered', { studioId: body.studioId, daemonId: body.daemonId });
}

function connect() {
  const at = Date.now();
  synced = false;
  ws = new WebSocket(`${hub.replace(/^http/, 'ws')}/v1/daemon/ws`, {
    headers: { 'x-studio-daemon': daemonId, 'x-studio-at': String(at), 'x-studio-sig': signText(`connect:${daemonId}:${at}`) },
  });
  ws.on('open', () => {
    log('open', { daemonId });
    send({ t: 'hello', proto: { major: 1, minor: 0 }, daemon: daemonId, projects: projects.map((id) => ({ id, name: id })) });
  });
  ws.on('message', (data) => {
    let frame;
    try {
      frame = JSON.parse(String(data));
    } catch {
      log('recv', { bad: true });
      return;
    }
    log('recv', { t: frame.t, ...(frame.seq !== undefined ? { seq: frame.seq } : {}), ...(frame.project ? { project: frame.project } : {}) });
    if (frame.t === 'welcome') pushAll();
    else if (frame.t === 'deliver') {
      // The hub delivered a customer action; say it ran. M3 would use the daemon's own OpLog here.
      setTimeout(() => send({ t: 'receipt', opId: frame.action.opId, state: 'done', ...(frame.action.planRef ? { planRef: frame.action.planRef } : {}) }), 80);
    } else if (frame.t === 'resync') {
      const entry = plans.find((p) => p.project === frame.project);
      if (entry) snapshot(entry);
    } else if (frame.t === 'outdated') {
      log('outdated');
      ws.close();
    }
  });
  ws.on('close', (code, reason) => {
    synced = false;
    log('closed', { code, reason: String(reason) });
    if (!stopping) setTimeout(connect, 800);
  });
  ws.on('error', (err) => log('error', { message: String(err?.message ?? err) }));
}

process.on('SIGUSR2', () => {
  log('reconnect-requested');
  ws?.close(4000, 'reconnect');
});
process.on('SIGINT', () => {
  stopping = true;
  ws?.close(1000, 'bye');
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopping = true;
  ws?.close(1000, 'bye');
  process.exit(0);
});

await register();
connect();
setInterval(() => {
  if (synced) for (const entry of plans) snapshot(entry);
}, interval);
