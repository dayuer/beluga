import type DHT from 'hyperdht';
import type { KeyPair } from 'hyperdht';
import { openTunnel, waitUntilReachable } from '../net/tunnel.js';
import type { RelayRecord } from './protocol.js';
import { parseCustomAddress } from '../shared/custom-address.js';
import { RelayServer } from './relay.js';

/**
 * How phones find this Mac when a direct connection can't be made (docs/companion.md, "Any
 * network"): the relay server (relay.ts) behind a Cloudflare quick tunnel, and the Mac's signed
 * record on the DHT naming the tunnel's current URL (it changes whenever cloudflared restarts).
 * Runs only while the companion host does (a phone paired, or a pairing open).
 */

/** Makes the relay public: cloudflared's quick tunnel, none, or (tests) a function. */
export type RelayTunnel = 'cloudflared' | 'off' | ((localPort: number) => Promise<{ url: string; close(): void }>);

/** How often the DHT record is put again (records fade from the DHT after a while). */
const REPUBLISH_MS = 10 * 60_000;
/** A custom address that failed tries again this often (its mesh network may not be up yet). */
const CUSTOM_RETRY_MS = 30_000;
/** A tunnel that died is opened again after this long (one whose name Cloudflare dropped: at once, it's known dead). */
const RETRY_MS = 30_000;
const RETRY_DEAD_MS = 2_000;

/** How the relay is, for Settings › Phone: ready (its URL answers), starting (or restarting), off (not used here). */
export type RelayState = 'ready' | 'starting' | 'off';

/** The custom address (a mesh network's, Settings › Phone › Advanced): listening, failed (`error` says why), or off. */
export interface CustomRelayState {
  readonly state: 'listening' | 'failed' | 'off';
  readonly address?: string;
  readonly error?: string;
}

export interface ReachOptions {
  readonly tunnel: RelayTunnel;
  /** The relay's URL changed (it's in pairing links and welcomes). */
  readonly onChange: () => void;
  readonly log?: (line: string) => void;
  /** The phones this key's record names (its link keys' first 16 hex), or undefined: none named (a pairing's key). */
  readonly phones?: (publicKey: Buffer) => readonly string[] | undefined;
}

export class Reach {
  readonly server: RelayServer;
  private url?: string;
  private tunnel?: { close(): void };
  private running = false;
  private retry?: NodeJS.Timeout;
  private republish?: NodeJS.Timeout;
  private publishing?: { node: DHT; keyPairs: () => readonly KeyPair[] };
  private seq = 0;
  /** The custom address wanted now (`host:port`), and how it is. */
  private wantedCustom?: string;
  private custom: CustomRelayState = { state: 'off' };
  /** One change of the custom listener at a time (closing one waits for its phones to go). */
  private customChain: Promise<void> = Promise.resolve();
  /** A failed address tries again (a mesh network can come up after Beluga does). */
  private customRetry?: NodeJS.Timeout;

  constructor(private readonly opts: ReachOptions) {
    this.server = new RelayServer(opts.log);
  }

  /** The relay's base URL (`wss://….trycloudflare.com/companion`), once its tunnel answers. */
  relayUrl(): string | undefined {
    return this.url;
  }

  /** The relay's URL on the custom address (`ws://host:port/companion`), while it listens. */
  customUrl(): string | undefined {
    const a = parseCustomAddress(this.custom.state === 'listening' ? this.custom.address : undefined);
    return a ? `ws://${a.host.includes(':') ? `[${a.host}]` : a.host}:${a.port}/companion` : undefined;
  }

  customState(): CustomRelayState {
    return this.custom;
  }

  /**
   * Listen on this address too (or stop: undefined). It's the user's address, so a busy port or an
   * address this Mac doesn't have is an error in `customState`, never another port.
   */
  async setCustom(address: string | undefined): Promise<void> {
    const wanted = address?.trim() || undefined;
    // The same address again still tries again when it failed (Save after fixing the network).
    if (wanted === this.wantedCustom && this.custom.state !== 'failed') return;
    this.wantedCustom = wanted;
    await this.applyCustom();
  }

  private applyCustom(): Promise<void> {
    this.customChain = this.customChain.then(() => this.applyCustomNow());
    return this.customChain;
  }

  private async applyCustomNow(): Promise<void> {
    clearTimeout(this.customRetry);
    const wanted = this.running ? this.wantedCustom : undefined;
    await this.server.closeExtra();
    if (!wanted) {
      this.setCustomState({ state: 'off' });
      return;
    }
    const a = parseCustomAddress(wanted);
    try {
      if (!a) throw new Error('not host:port');
      await this.server.listenOn(a.host, a.port);
    } catch (err) {
      this.setCustomState({ state: 'failed', address: wanted, error: err instanceof Error ? err.message : String(err) });
      if (a) {
        this.customRetry = setTimeout(() => void this.applyCustom(), CUSTOM_RETRY_MS);
        this.customRetry.unref();
      }
      return;
    }
    // Stopped, or another address wanted, while it opened: that one runs next; this one closes.
    if (!this.running || this.wantedCustom !== wanted) {
      await this.server.closeExtra();
      return;
    }
    this.setCustomState({ state: 'listening', address: wanted });
  }

  private setCustomState(next: CustomRelayState): void {
    const same = next.state === this.custom.state && next.address === this.custom.address && next.error === this.custom.error;
    this.custom = next;
    if (same) return;
    this.opts.onChange();
    void this.publish();
  }

  state(): RelayState {
    if (this.opts.tunnel === 'off') return 'off';
    if (!this.running) return 'off';
    return this.url ? 'ready' : 'starting';
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.opts.onChange();
    await this.server.listen();
    await this.applyCustom();
    void this.openTunnel();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.retry);
    clearInterval(this.republish);
    this.publishing = undefined;
    this.tunnel?.close();
    this.tunnel = undefined;
    clearTimeout(this.customRetry);
    const had = this.url;
    const hadCustom = this.custom.state !== 'off';
    this.url = undefined;
    await this.customChain;
    await this.server.close();
    this.custom = { state: 'off' };
    if (had || hadCustom) this.opts.onChange();
  }

  /** Keep the record of where this Mac's relay is on the DHT, under each of these key pairs. */
  publishOn(node: DHT, keyPairs: () => readonly KeyPair[]): void {
    this.publishing = { node, keyPairs };
    clearInterval(this.republish);
    this.republish = setInterval(() => void this.publish(), REPUBLISH_MS);
    this.republish.unref();
    void this.publish();
  }

  /** Put the record now (the relay changed, a pairing opened). */
  async publish(): Promise<void> {
    const p = this.publishing;
    if (!p || !this.running) return;
    const custom = this.customUrl();
    const record: RelayRecord = { v: 1, at: Date.now(), ...(this.url ? { relay: this.url } : {}), ...(custom ? { custom } : {}) };
    // Each put must outnumber the last one stored: seconds since the epoch, and never the same twice
    // (a put in the same second as the last would be refused, and the older record would stay).
    const seq = Math.max(Math.floor(Date.now() / 1000), this.seq + 1);
    this.seq = seq;
    const valueFor = (kp: KeyPair): Buffer => {
      const phones = this.opts.phones?.(kp.publicKey);
      return Buffer.from(JSON.stringify(phones ? { ...record, phones: phones.slice(0, 8) } : record));
    };
    await Promise.all(p.keyPairs().map((kp) => p.node.mutablePut(kp, valueFor(kp), { seq }).catch((err: unknown) => this.opts.log?.(`companion: relay record not stored: ${String(err)}`))));
  }

  private async openTunnel(): Promise<void> {
    const kind = this.opts.tunnel;
    if (kind === 'off' || !this.running) return;
    try {
      let url: string;
      if (typeof kind === 'function') {
        const t = await kind(this.server.localPort);
        this.tunnel = t;
        url = t.url;
      } else {
        const t = await openTunnel('cloudflared', this.server.localPort, {
          onDied: (reason) => {
            this.opts.log?.(`companion: relay tunnel stopped: ${reason}`);
            this.lost(/stopped answering/.test(reason) ? RETRY_DEAD_MS : RETRY_MS);
          },
        });
        if (!t) return;
        this.tunnel = t;
        // A fresh quick-tunnel name takes a moment to resolve: hand it out once it answers.
        if (!(await waitUntilReachable(t.publicUrl, 90_000))) throw new Error('the tunnel never answered');
        url = `${t.publicUrl.replace(/^http/, 'ws')}/companion`;
      }
      if (!this.running) return this.tunnel?.close();
      this.url = url;
      this.opts.onChange();
      void this.publish();
    } catch (err) {
      this.opts.log?.(`companion: no relay: ${err instanceof Error ? err.message : String(err)}`);
      this.lost();
    }
  }

  private lost(after = RETRY_MS): void {
    this.tunnel?.close();
    this.tunnel = undefined;
    if (this.url) {
      this.url = undefined;
      this.opts.onChange();
      void this.publish();
    }
    if (!this.running) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.openTunnel(), after);
    this.retry.unref();
  }
}
