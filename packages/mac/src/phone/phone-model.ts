import type { DeviceView } from '../../../../src/companion/protocol.js';
import type { PhoneTouchData } from '../../../../src/ipc/client.js';

/**
 * What the Mac says about your phones (docs/companion.md, "On the Mac"): pure, so it's tested
 * without a window.
 */

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago". */
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** One phone's state in words: "linked", "last seen 12 min ago", "not linked yet". */
export function seenText(d: { readonly linked: boolean; readonly lastSeen?: number }, now: number): string {
  if (d.linked) return 'linked';
  return d.lastSeen ? `last seen ${ago(d.lastSeen, now)}` : 'not linked yet';
}

/** The footer mark: lit while any phone is linked, outlined while they're all away; its hover text. */
export function markOf(devices: readonly DeviceView[], now: number): { readonly lit: boolean; readonly title: string } {
  const linked = devices.filter((d) => d.linked);
  if (linked.length) return { lit: true, title: linked.map((d) => `${d.name} · linked`).join(', ') };
  const last = [...devices].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))[0];
  return { lit: false, title: last ? `${last.name} · ${seenText(last, now)}` : 'Pair a phone' };
}

/** "8 min left" for an open pairing. */
export function leftText(expiresAt: number, now: number): string {
  const m = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  return m <= 1 ? 'less than a minute left' : `${m} min left`;
}

const KEY_WORDS: Record<string, string> = { back: 'Back', home: 'Home', recents: 'Recents', enter: 'Enter', notifications: 'the notifications', quick_settings: 'Quick settings', lock: 'Lock', power_dialog: 'the power menu' };

/** What Claude just did on the phone, as the mirror's caption says it (BLG-186). Never what it typed. */
export function touchCaption(t: PhoneTouchData): string {
  switch (t.op) {
    case 'tap':
      return 'The agent tapped';
    case 'long_press':
      return 'The agent pressed and held';
    case 'swipe':
      return 'The agent swiped';
    case 'type':
      return 'The agent typed';
    case 'key':
      return `The agent pressed ${KEY_WORDS[t.what ?? ''] ?? t.what ?? 'a key'}`;
    case 'scroll':
      return t.what ? `The agent scrolled ${t.what}` : 'The agent scrolled';
    case 'open':
      return `The agent opened ${t.what ?? 'an app'}`;
  }
}

/** How long a client invite may last, in days (the daemon's default is 1, its most 7). */
export const INVITE_DAYS = [1, 2, 3, 7] as const;
export const DEFAULT_INVITE_DAYS = 1;

/** The arguments of `companion.pair.start` for a customer's invite to one project. */
export function clientInviteArgs(project: string, days: number = DEFAULT_INVITE_DAYS): { project: string; ttlMs: number } {
  const d = Math.min(Math.max(Math.round(days) || DEFAULT_INVITE_DAYS, 1), 7);
  return { project, ttlMs: d * 24 * 3600_000 };
}

/** 「客户 · 项目名」 on a customer's phone in the list; nothing on your own (BLG-34). */
export function clientTag(d: Pick<DeviceView, 'client'>, projects: readonly { readonly id: string; readonly name: string }[]): string | undefined {
  if (!d.client) return undefined;
  return `Customer · ${(projects.find((x) => x.id === d.client!.project)?.name ?? d.client.project)}`;
}
