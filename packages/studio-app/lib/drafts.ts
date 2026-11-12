import { LIMITS, PLATFORMS, type StudioPlatform } from '../../../src/studio/protocol';
import { kv } from './kv';

/** The request being typed, keyed by project. Only the text and platform picks; never sent. */
export interface NewDraft {
  readonly goal: string;
  readonly platforms: StudioPlatform[];
  readonly updatedAt: number;
}

/** An action already handed to the hub. It keeps its opId across retries and reloads, so the
 * hub's idempotency (docs/studio-hub.md §7.1) turns a double send into one queue entry. */
export interface PendingNew {
  readonly opId: string;
  readonly goal: string;
  readonly platforms: StudioPlatform[];
  readonly updatedAt: number;
}

const draftKey = (pid: string): string => `draft:new:${pid}`;
const pendingKey = (pid: string): string => `pending:new:${pid}`;

const isPlatform = (v: unknown): v is StudioPlatform => typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v);
const platformsOf = (v: unknown): StudioPlatform[] => (Array.isArray(v) ? [...new Set(v.filter(isPlatform))] : []);

export function readDraft(pid: string): NewDraft | undefined {
  const d = kv.get<Partial<NewDraft>>(draftKey(pid));
  if (!d || typeof d.goal !== 'string' || typeof d.updatedAt !== 'number') return undefined;
  return { goal: d.goal.slice(0, LIMITS.text), platforms: platformsOf(d.platforms), updatedAt: d.updatedAt };
}

export function writeDraft(pid: string, draft: NewDraft): void {
  kv.set(draftKey(pid), { ...draft, goal: draft.goal.slice(0, LIMITS.text) });
}

export function clearDraft(pid: string): void {
  kv.remove(draftKey(pid));
}

export function readPending(pid: string): PendingNew | undefined {
  const p = kv.get<Partial<PendingNew>>(pendingKey(pid));
  if (!p || typeof p.opId !== 'string' || typeof p.goal !== 'string' || typeof p.updatedAt !== 'number') return undefined;
  return { opId: p.opId, goal: p.goal, platforms: platformsOf(p.platforms), updatedAt: p.updatedAt };
}

export function writePending(pid: string, pending: PendingNew): void {
  kv.set(pendingKey(pid), { ...pending, goal: pending.goal.slice(0, LIMITS.text) });
}

export function clearPending(pid: string): void {
  kv.remove(pendingKey(pid));
}
