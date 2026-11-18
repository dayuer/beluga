/// <reference path="../net/mesh/modules.d.ts" />
import { type IncomingMessage, type Server as HttpServer, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { KeyPair, NoiseSocket } from 'hyperdht';
import { type WebSocket, WebSocketServer } from 'ws';
import type { Duplex } from 'node:stream';
import { fromStream } from '../net/transport.js';
import { type MessagePipe, noiseResponder } from './dial.js';

/**
 * The relay's Mac end (docs/companion.md, "Any network"). A small HTTP server on 127.0.0.1 takes
 * WebSockets at `/companion/<key>`; Cloudflare's quick tunnel (cloudflared, as rooms use) puts it
 * on the internet as `wss://<name>.trycloudflare.com/companion`. Inside each socket runs the same
 * Noise handshake as over hyperdht, with this Mac as the responder holding the key the phone
 * dialed (the companion key, or an open pairing's), so Cloudflare carries only ciphertext and
 * both keys stay pinned. What comes out goes to the same handlers, behind the same firewall.
 */

/** What answers at one key: its key pair, who may come in (`true` turns them away), and where an open stream goes. */
export interface RelayRoute {
  readonly keyPair: KeyPair;
  readonly firewall?: (remotePublicKey: Buffer) => boolean;
  readonly accept: (stream: NoiseSocket) => void;
}

/** Close codes on the relay socket: nothing at that key, or turned away by the firewall. */
export const RELAY_CLOSE = { notFound: 4404, refused: 4403 } as const;
/** How long a socket has to finish its Noise handshake. */
const HANDSHAKE_MS = 15_000;
const MAX_MESSAGE = 16 * 1024 * 1024;
/** Sockets at once (a few phones, a pairing): anyone on the internet can reach the tunnel, so it's capped. */
const MAX_SOCKETS = 32;

/** A `ws` socket as the pipe secret-stream runs over. */
export function wsPipe(ws: WebSocket, open: boolean): MessagePipe {
  return {
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data, { binary: true });
    },
    close: () => {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(1000);
    },
    onOpen: (fn) => {
      if (open) queueMicrotask(fn);
      else ws.once('open', fn);
    },
    // A Buffer as it comes (secret-stream's output is a slice of it, and the Mac's frame reader reads Buffers).
    onMessage: (fn) => ws.on('message', (data: Buffer) => fn(data)),
    onClose: (fn) => {
      let done = false;
      const once = (code?: number): void => {
        if (done) return;
        done = true;
        fn(code);
      };
      ws.once('close', (code: number) => once(code));
      // Never opened (an HTTP answer instead of the upgrade: 404, 502, 530…): that status.
      ws.once('unexpected-response', (_req: unknown, res: { statusCode?: number }) => {
        once(res.statusCode);
        ws.terminate();
      });
      ws.once('error', () => once(undefined));
    },
  };
}

/** One HTTP + WebSocket listener of the relay (the local one, or the one on a custom address). */
interface Listener {
  readonly http: HttpServer;
  readonly wss: WebSocketServer;
  readonly port: number;
}

export class RelayServer {
  private readonly routes = new Map<string, RelayRoute>();
  private main?: Listener;
  private extra?: Listener;

  constructor(private readonly log?: (line: string) => void) {}

  get listening(): boolean {
    return this.main !== undefined;
  }

  get localPort(): number {
    return this.main?.port ?? 0;
  }

  add(route: RelayRoute): void {
    this.routes.set(route.keyPair.publicKey.toString('hex'), route);
  }

  remove(publicKey: Buffer): void {
    this.routes.delete(publicKey.toString('hex'));
  }

  async listen(): Promise<number> {
    if (this.main) return this.main.port;
    this.main = await this.open('127.0.0.1', 0);
    return this.main.port;
  }

  /**
   * Also listen on `host:port` (a mesh network's address the user filled in), with the same routes.
   * Never falls back to another port: the address is the user's, so a busy port is an error.
   */
  async listenOn(host: string, port: number): Promise<number> {
    if (this.extra) return this.extra.port;
    try {
      this.extra = await this.open(host, port);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const why = code === 'EADDRINUSE' ? 'that port is already in use' : code === 'EADDRNOTAVAIL' ? 'this Mac has no such address' : err instanceof Error ? err.message : String(err);
      this.log?.(`relay: custom address ${host}:${port} is not listening: ${why}`);
      throw new Error(why);
    }
    this.log?.(`relay: also listening on ${host}:${this.extra.port}`);
    return this.extra.port;
  }

  async closeExtra(): Promise<void> {
    const extra = this.extra;
    this.extra = undefined;
    if (extra) await this.shut(extra);
  }

  async close(): Promise<void> {
    const { main, extra } = this;
    this.main = undefined;
    this.extra = undefined;
    await Promise.all([main, extra].map((l) => (l ? this.shut(l) : Promise.resolve())));
  }

  private async open(host: string, port: number): Promise<Listener> {
    const http = createServer((_req, res) => {
      // Plain HTTP (cloudflared's reachability check, a browser): who this is, and nothing else.
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Beluga companion relay\n');
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
    http.on('upgrade', (req: IncomingMessage, socket, head) => {
      const key = /^\/companion\/([0-9a-f]{64})\/?$/.exec(req.url ?? '')?.[1];
      wss.handleUpgrade(req, socket, head, (ws) => this.serve(ws, key, wss));
    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, host, () => resolve());
    });
    http.on('error', (err) => this.log?.(`relay: ${err.message}`));
    return { http, wss, port: (http.address() as AddressInfo).port };
  }

  private async shut({ http, wss }: Listener): Promise<void> {
    // Let what's queued go out (a removed phone's 4010), then cut whatever is left.
    const open = [...wss.clients];
    if (open.length) await new Promise((r) => setTimeout(r, 300));
    for (const ws of open) ws.close(1001);
    if (open.length) await new Promise((r) => setTimeout(r, 200));
    for (const ws of open) ws.terminate();
    wss.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }

  private serve(ws: WebSocket, key: string | undefined, wss: WebSocketServer): void {
    const route = key ? this.routes.get(key) : undefined;
    if (!route) return ws.close(RELAY_CLOSE.notFound, 'nothing here');
    if (wss.clients.size > MAX_SOCKETS) return ws.close(1013, 'busy');
    const stream = noiseResponder(wsPipe(ws, true), route.keyPair);
    stream.on('error', () => undefined);
    const timer = setTimeout(() => stream.destroy(), HANDSHAKE_MS);
    timer.unref();
    void stream.opened.then((ok) => {
      clearTimeout(timer);
      if (!ok || !stream.remotePublicKey) return stream.destroy();
      const remote = Buffer.from(stream.remotePublicKey);
      if (route.firewall?.(remote)) {
        // Noise XX completes on the phone's side before this end knows its key, so say no inside
        // the link (as the host closes a removed phone: 4010) rather than just dropping it.
        fromStream(stream as unknown as Duplex, { maxBytes: 1024, open: true }).close(4010, 'This phone isn’t paired with this Mac');
        return;
      }
      try {
        route.accept(stream as unknown as NoiseSocket);
      } catch (err) {
        this.log?.(`relay: ${err instanceof Error ? err.message : String(err)}`);
        stream.destroy();
      }
    });
  }
}
