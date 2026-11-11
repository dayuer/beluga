#!/usr/bin/env node
/**
 * Development-only same-origin proxy (M5 design §0.1).
 *
 *   /v1/* (HTTP and WebSocket) → wrangler dev, :8787
 *   everything else            → Expo dev server :8081, or ./dist with --dist
 *
 * Same origin is what makes the magic link work: the hub has no CORS and its link is
 * `<HUB_ORIGIN>/login#token=…`. In P2 the Worker must host the app (or route the same origin);
 * this proxy is not a production answer.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const useDist = process.argv.includes('--dist');
const port = Number(process.env.PORT ?? 8790);
const hub = { host: process.env.HUB_HOST ?? '127.0.0.1', port: Number(process.env.HUB_PORT ?? 8787) };
// Expo's dev server answers `localhost`, not `127.0.0.1` (Host-based routing).
const expo = { host: process.env.EXPO_HOST ?? 'localhost', port: Number(process.env.EXPO_PORT ?? 8081) };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const isV1 = (url = '') => url === '/v1' || url.startsWith('/v1/');

function proxy(req, res, target) {
  const headers = { ...req.headers, host: `${target.host}:${target.port}` };
  const up = http.request({ host: target.host, port: target.port, method: req.method, path: req.url, headers }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`proxy: ${target.host}:${target.port} is not running`);
  });
  req.pipe(up);
}

function serveDist(req, res) {
  let rel = '/';
  try {
    rel = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad path');
    return;
  }
  rel = rel.replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(dist, rel);
  if (file !== dist && !file.startsWith(dist + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  const send = (target) => {
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(target).pipe(res);
  };
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(file);
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('dist/index.html is missing: run npm run export first');
    return;
  }
  return send(index);
}

const server = http.createServer((req, res) => {
  if (isV1(req.url)) return proxy(req, res, hub);
  if (useDist) return serveDist(req, res);
  return proxy(req, res, expo);
});

// WebSocket: the hub's customer socket is on /v1/app/projects/:pid/ws. The handshake is passed
// through byte for byte, including Sec-WebSocket-Protocol (`synon.v1, bearer.<session>`).
server.on('upgrade', (req, socket, head) => {
  if (!isV1(req.url)) {
    socket.destroy();
    return;
  }
  const up = net.connect(hub.port, hub.host, () => {
    const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
    // A daemon dying (or the hub closing the socket) must close the app's socket too: a half-open
    // WebSocket would leave the customer's "reconnecting" banner off.
    up.on('close', () => socket.destroy());
    socket.on('close', () => up.destroy());
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.on('error', (error) => {
  console.error(`[studio-app] proxy failed: ${error.message}`);
  process.exit(1);
});

server.listen(port, () => {
  const rest = useDist ? `dist/ (${dist})` : `expo ${expo.host}:${expo.port}`;
  console.log(`[studio-app] http://localhost:${port}  /v1 → ${hub.host}:${hub.port}  rest → ${rest}`);
});
