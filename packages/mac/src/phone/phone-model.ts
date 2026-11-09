import { t } from '../i18n/index.js';
import type { DeviceView } from '../../../../src/companion/protocol.js';
import type { PhoneTouchData } from '../../../../src/ipc/client.js';

/**
 * What the Mac says about your phones (docs/companion.md, "On the Mac"): pure, so it's tested
 * without a window.
 */

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago". */
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return t('phone.model.justNow');
  const m = Math.round(s / 60);
  if (m < 60) return t('phone.model.minAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('phone.model.hAgo', { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t('phone.model.yesterday') : t('phone.model.daysAgo', { n: d });
}

/** One phone's state in words: "linked", "last seen 12 min ago", "not linked yet". */
export function seenText(d: { readonly linked: boolean; readonly lastSeen?: number }, now: number): string {
  if (d.linked) return t('phone.model.linked');
  return d.lastSeen ? t('phone.model.lastSeen', { when: ago(d.lastSeen, now) }) : t('phone.model.notLinked');
}

/** The footer mark: lit while any phone is linked, outlined while they're all away; its hover text. */
export function markOf(devices: readonly DeviceView[], now: number): { readonly lit: boolean; readonly title: string } {
  const linked = devices.filter((d) => d.linked);
  if (linked.length) return { lit: true, title: linked.map((d) => `${d.name} · ${t('phone.model.linked')}`).join(t('phone.model.listSep')) };
  const last = [...devices].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))[0];
  return { lit: false, title: last ? `${last.name} · ${seenText(last, now)}` : t('phone.model.pair') };
}

/** "8 min left" for an open pairing. */
export function leftText(expiresAt: number, now: number): string {
  const m = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  return m <= 1 ? t('phone.model.lessMinute') : t('phone.model.minLeft', { n: m });
}

const KEY_WORDS: Record<string, string> = {
  get back() { return t('phone.model.key.back'); },
  get home() { return t('phone.model.key.home'); },
  get recents() { return t('phone.model.key.recents'); },
  get enter() { return t('phone.model.key.enter'); },
  get notifications() { return t('phone.model.key.notifications'); },
  get quick_settings() { return t('phone.model.key.quick_settings'); },
  get lock() { return t('phone.model.key.lock'); },
  get power_dialog() { return t('phone.model.key.power_dialog'); },
};

/** What Claude just did on the phone, as the mirror's caption says it (BLG-186). Never what it typed. */
export function touchCaption(touch: PhoneTouchData): string {
  switch (touch.op) {
    case 'tap':
      return t('phone.model.tapped');
    case 'long_press':
      return t('phone.model.held');
    case 'swipe':
      return t('phone.model.swiped');
    case 'type':
      return t('phone.model.typed');
    case 'key':
      return t('phone.model.pressed', { key: (touch.what ? KEY_WORDS[touch.what] : undefined) ?? touch.what ?? t('phone.model.aKey') });
    case 'scroll':
      return touch.what ? t('phone.model.scrolledWhat', { what: touch.what }) : t('phone.model.scrolled');
    case 'open':
      return t('phone.model.opened', { what: touch.what ?? t('phone.model.anApp') });
  }
}
