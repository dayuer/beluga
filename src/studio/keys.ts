import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { belugaHome } from '../core/home.js';
import { signText } from '../net/mesh/keys.js';
import { STUDIO_LABEL } from '../net/studio/store.js';
import { generateIdentity, identityFromPem, identityPem, type Identity } from '../net/crypto.js';

/**
 * This daemon's Synon Studio identity and its one local file (docs/studio-daemon.md §2).
 *
 * A link makes a fresh Ed25519 key (never the Beluga identity: unlinking throws it away and a new
 * link starts over), kept in ~/.beluga/studio.json with a refKey. Every plan and project goes to
 * the hub under `refOf(refKey, …)`, so a local project id (`local:/Users/…`) or a plan's slug never
 * leaves this Mac; the refKey is what makes those names stable across restarts, so it must be kept
 * with the key. The key itself is PEM PKCS8 and never appears in a status, a log or an error.
 *
 * Reads and writes are whole-file and cheap; a bad file is "not linked", never a throw.
 */

export interface StudioProjectShare {
  /** When this project was first shared with Studio (ms). */
  readonly since: number;
}

export interface StudioConfig {
  readonly v: 1;
  /** The hub's base URL, normalized (no trailing slash): https, or http to localhost only. */
  readonly hub: string;
  readonly studioId: string;
  /** `identity.peerId`, the same id the hub's `daemonIdOf` makes. */
  readonly daemonId: string;
  readonly name: string;
  readonly linkedAt: number;
  /** PKCS8 PEM. Never in a status, a log or an error. */
  readonly key: string;
  /** 32 bytes, base64url: `refOf`'s HMAC key. Never leaves this Mac. */
  readonly refKey: string;
  /** The last `at` sent when connecting (ms): the hub refuses one that doesn't strictly grow. */
  readonly lastAt?: number;
  /** Beluga project ids shared with Studio. */
  readonly projects: Readonly<Record<string, StudioProjectShare>>;
}

export const studioPath = (): string => path.join(belugaHome(), 'studio.json');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A parsed file, checked field by field; anything off means "not linked" (a hand-edited or old file). */
function configOf(raw: unknown): StudioConfig | undefined {
  if (!isObject(raw) || raw['v'] !== 1) return undefined;
  const str = (k: string, max: number): string | undefined => {
    const v = raw[k];
    return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
  };
  const hub = str('hub', 300);
  const studioId = str('studioId', 64);
  const daemonId = str('daemonId', 64);
  const name = str('name', 200);
  const key = str('key', 4000);
  const refKey = str('refKey', 100);
  const linkedAt = raw['linkedAt'];
  if (!hub || !studioId || !daemonId || !name || !key || !refKey) return undefined;
  if (typeof linkedAt !== 'number' || !Number.isFinite(linkedAt) || linkedAt < 0) return undefined;
  const lastAt = raw['lastAt'];
  if (lastAt !== undefined && (typeof lastAt !== 'number' || !Number.isFinite(lastAt) || lastAt < 0)) return undefined;
  const projectsRaw = raw['projects'];
  if (!isObject(projectsRaw)) return undefined;
  const projects: Record<string, StudioProjectShare> = {};
  for (const [id, share] of Object.entries(projectsRaw)) {
    if (!isObject(share) || typeof share['since'] !== 'number' || !Number.isFinite(share['since'])) return undefined;
    projects[id] = { since: share['since'] };
  }
  return { v: 1, hub, studioId, daemonId, name, key, refKey, linkedAt, ...(lastAt !== undefined ? { lastAt } : {}), projects };
}

/** The file's owner-only mode, repaired when something copied it wider (best effort; Windows has none). */
function tighten(file: string): void {
  if (process.platform === 'win32') return;
  try {
    if ((statSync(file).mode & 0o777) !== 0o600) chmodSync(file, 0o600);
  } catch {
    // Not ours to fix: reading already worked or failed on its own.
  }
}

/** The link, or undefined when there is none (or the file is unreadable, cut short, or from a version we don't know). */
export function loadStudioConfig(file: string = studioPath()): StudioConfig | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  tighten(file);
  try {
    return configOf(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/** Write the whole file or nothing: a temp file in the same folder, 0600, then rename. */
export function saveStudioConfig(cfg: StudioConfig, file: string = studioPath()): void {
  const dir = path.dirname(file);
  if (process.platform === 'win32') mkdirSync(dir, { recursive: true });
  else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      if ((statSync(dir).mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
    } catch {
      // A folder we can't tighten (someone else's) still works; the file itself is 0600.
    }
  }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export function removeStudioConfig(file: string = studioPath()): void {
  try {
    unlinkSync(file);
  } catch {
    // Already gone: unlinking twice is the same as unlinking once.
  }
}

/** A new key for one link (Ed25519, as the hub verifies). */
export const newStudioIdentity = (): Identity => generateIdentity();

/** The key this link's file holds; throws only when the file was corrupt (loadStudioConfig already refused it). */
export const identityOf = (cfg: StudioConfig): Identity => identityFromPem(cfg.key);

/** `synon-studio-v1:<text>`, exactly the bytes the hub's `signedBy` verifies. */
export const studioSign = (identity: Identity, text: string): string => signText(identity, STUDIO_LABEL, text);

/** A fresh refKey: 32 bytes, base64url. */
export const newRefKey = (): string => randomBytes(32).toString('base64url');

/**
 * An opaque, stable name for a project or plan, as the hub sees it: `dp…` for a project, `p…` for a
 * plan, 22 REF-safe characters, keyed by the refKey so nobody else can guess it and it doesn't
 * change between runs. Never contains a path, a KEY or the Beluga id.
 */
export function refOf(refKey: string, kind: 'project' | 'plan', id: string): string {
  const mac = createHmac('sha256', Buffer.from(refKey, 'base64url')).update(`${kind}\0${id}`).digest('base64url');
  return `${kind === 'project' ? 'dp' : 'p'}${mac.slice(0, 20)}`;
}

