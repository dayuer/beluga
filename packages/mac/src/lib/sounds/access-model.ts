import { t } from '../../i18n/index.js';

/** Whether macOS lets Beluga notify (System Settings › Notifications › Beluga). */
export interface NotificationAccess {
  /**
   * `off`: turned off for Beluga; `unknown`: macOS won't say. Beluga's banners go through macOS's
   * older notification service, which the settings API doesn't describe, so on most Macs this is
   * `unknown` and a test is what tells (`notAsked` from an older app shell counts as `unknown`).
   */
  readonly state: 'allowed' | 'off' | 'notAsked' | 'unknown';
  /** Banners or alerts are on (otherwise they only collect in Notification Center). */
  readonly alerts: boolean;
  /** "Play sound for notifications" is on. */
  readonly sound: boolean;
  /**
   * A Focus (Do Not Disturb, Work…) is on and holding banners. macOS only tells apps with Full
   * Disk Access, so usually `unknown` (missing from an older app shell: `unknown` too).
   */
  readonly focus?: 'on' | 'off' | 'unknown';
  /** The Focus that's on ("Do Not Disturb"). */
  readonly focusName?: string;
}

export const UNKNOWN_ACCESS: NotificationAccess = { state: 'unknown', alerts: true, sound: true, focus: 'unknown' };

/** What fixes it: System Settings › Notifications › Beluga, or Focus settings. */
export type AccessAction = 'notifications' | 'focus';

export const ACTION_LABELS: Readonly<Record<AccessAction, string>> = {
  notifications: 'Open Notification Settings',
  focus: 'Open Focus Settings',
};

/** Beluga's own switches that keep banners away (Settings › Notifications, above). */
export interface OwnSettings {
  readonly desktop: boolean;
  /** Beluga's Do Not Disturb, while it's on ("until 3:00 PM"). */
  readonly quietUntil: string | null;
}

/** Which system the app runs on: only the Mac says anything about Beluga's notifications. */
export type NotifyOs = 'mac' | 'windows' | 'linux';

/**
 * When the system won't say whether banners are allowed: where to allow them, and where a banner
 * shows. Windows has a settings page to open; Linux desktops each keep their own, so no button.
 */
const unsaidFor = (os: NotifyOs, action?: AccessAction): { readonly detail: string; readonly where: string; readonly fix: string; readonly action?: AccessAction } => ({
  get detail() {
    return t(`common.accessModel.${os}.detail` as const);
  },
  get where() {
    return t(`common.accessModel.${os}.where` as const);
  },
  get fix() {
    return t(`common.accessModel.${os}.fix` as const);
  },
  ...(action ? { action } : {}),
});
const UNSAID: Readonly<Record<NotifyOs, { readonly detail: string; readonly where: string; readonly fix: string; readonly action?: AccessAction }>> = {
  mac: unsaidFor('mac', 'notifications'),
  windows: unsaidFor('windows', 'notifications'),
  linux: unsaidFor('linux'),
};

/** The line at the top of Settings › Notifications: how things stand, and what to do about it. */
export interface NotifyStatus {
  readonly tone: 'ok' | 'warn' | 'muted';
  /** "Notifications are on", "Blocked by macOS", "Not set up yet"… */
  readonly title: string;
  readonly detail: string;
  /** What to turn on, in one line (only when something is in the way). */
  readonly fix?: string;
  readonly action?: AccessAction;
}

/** Something in the way, and what it did to a test notification. */
type Block = NotifyStatus & { readonly action: AccessAction; readonly held: string };

/** Turned off, or banners or sound off, for Beluga in System Settings (`null`: none of these). */
function macBlock(a: NotificationAccess): Block | null {
  const action = 'notifications';
  if (a.state === 'off') return { tone: 'warn', title: t('common.accessModel.blockedTitle'), detail: t('common.accessModel.blockedDetail'), fix: t('common.accessModel.blockedFix'), action, held: t('common.accessModel.blockedHeld') };
  if (a.state !== 'allowed') return null;
  if (!a.alerts) return { tone: 'warn', title: t('common.accessModel.bannersOffTitle'), detail: t('common.accessModel.bannersOffDetail'), fix: t('common.accessModel.bannersOffFix'), action, held: t('common.accessModel.bannersOffHeld') };
  if (!a.sound) return { tone: 'warn', title: t('common.accessModel.soundOffTitle'), detail: t('common.accessModel.soundOffDetail'), fix: t('common.accessModel.soundOffFix'), action, held: t('common.accessModel.soundOffHeld') };
  return null;
}

/** A Focus that's on (`null`: none is, or macOS won't say). */
function focusBlock(a: NotificationAccess): Block | null {
  if (a.focus !== 'on') return null;
  const name = a.focusName ?? t('common.accessModel.aFocus');
  return { tone: 'warn', title: t('common.accessModel.focusTitle', { name }), detail: t('common.accessModel.focusDetail'), fix: t('common.accessModel.focusFix'), action: 'focus', held: t('common.accessModel.focusHeld', { name: a.focusName ?? t('common.accessModel.aFocusLower') }) };
}

/** An older app shell's "not asked yet" isn't true for Beluga's banners: macOS just won't say. */
const normalize = (a: NotificationAccess): NotificationAccess => (a.state === 'notAsked' ? { ...a, state: 'unknown', alerts: true, sound: true } : a);

/** How things stand, from what macOS says and Beluga's own switches. */
export function notifyStatus(raw: NotificationAccess | undefined, own: OwnSettings, os: NotifyOs = 'mac'): NotifyStatus {
  if (!raw) return { tone: 'muted', title: t('common.accessModel.checking'), detail: t('common.accessModel.checkingDetail') };
  const a = normalize(raw);
  const mac = macBlock(a) ?? focusBlock(a);
  if (mac) return mac;
  if (!own.desktop) return { tone: 'muted', title: t('common.accessModel.desktopOff'), detail: t('common.accessModel.desktopOffDetail') };
  if (own.quietUntil) return { tone: 'muted', title: t('common.accessModel.dndOn'), detail: t('common.accessModel.dndOnDetail', { until: own.quietUntil }) };
  if (a.state === 'unknown') {
    const { detail, action } = UNSAID[os];
    return { tone: 'muted', title: t('common.accessModel.sendTest'), detail, ...(action ? { action } : {}) };
  }
  const detail = t('common.accessModel.onDetail');
  if (a.focus === 'off') return { tone: 'ok', title: t('common.accessModel.on'), detail };
  return { tone: 'ok', title: t('common.accessModel.on'), detail: t('common.accessModel.onFocus', { detail }) };
}

/** What happened to the test, in a sentence, and what to do if it didn't show. */
export interface TestOutcome {
  readonly tone: 'ok' | 'warn';
  readonly text: string;
  readonly action?: AccessAction;
}

/**
 * After a test: whether the banner can have shown. When macOS seems fine, say where to look and
 * what can still hold it (a Focus macOS doesn't tell Beluga about).
 */
export function testOutcome(raw: NotificationAccess, soundName: string | null, os: NotifyOs = 'mac'): TestOutcome {
  const a = normalize(raw);
  const heard = soundName ? t('common.accessModel.heard', { name: soundName }) : '';
  const block = macBlock(a) ?? focusBlock(a);
  if (block) return { tone: 'warn', text: `${block.held}${heard}`, action: block.action };
  // macOS closes the banners of the app you're using as soon as you click in it.
  const unsaid = UNSAID[os];
  const look = t('common.accessModel.sent', { where: unsaid.where, heard });
  if (a.state === 'unknown') return { tone: 'ok', text: `${look} ${unsaid.fix}`, ...(unsaid.action ? { action: unsaid.action } : {}) };
  if (a.focus === 'off') return { tone: 'ok', text: look };
  return { tone: 'ok', text: t('common.accessModel.nothing', { look }), action: 'focus' };
}
