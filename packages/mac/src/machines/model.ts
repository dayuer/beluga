// Relative, not @beluga: the root's tests and typecheck read this file too.
import type { MachineKind } from '../../../../src/machines/kind.js';
import type { MachineView } from '../../../../src/machines/machines.js';
import type { MachineIcon } from '../../../../src/shared/settings-schema.js';
import { DISTRO_WORDS, KIND_WORDS } from '../../../../src/machines/words.js';
import type { LinuxDistro } from '../../../../src/machines/kind.js';
import { t } from '../i18n/index.js';
// Which mark a computer shows is shared with the phone (src/machines/look.ts).
export { type Brand, machineLook } from '../../../../src/machines/look.js';

/**
 * How Settings › Your Computers says and draws a computer (BLG-780): its kind in words, its icon
 * (the one kept on it, else its kind's brand mark or a fitting glyph), a line of what it has free,
 * and what isn't ready there with its fix. Pure, so it's tested without a window.
 */


// Said the same on the phone (BLG-810).
export { KIND_WORDS } from '../../../../src/machines/words.js';



/** The generic icons to pick from, in order (`auto` is the kind's own). */
export const ICON_CHOICES: ReadonlyArray<{ readonly value: MachineIcon; readonly label: string }> = [
  // Each label read when shown, in the language picked then.
  ...(['auto', 'server', 'cloud', 'desktop', 'laptop', 'chip', 'box'] as const).map((value) => ({ value, get label() { return t(`machines.model.icon.${value}`); } })),
];


/** "AWS · eu-west-1", "Mac mini", or the platform when the kind isn't known yet. */
export function kindLine(m: Pick<MachineView, 'kind' | 'region' | 'platform'> & { readonly distro?: LinuxDistro; readonly distroVersion?: string }): string {
  // A plain Linux box says which one: "Ubuntu 24.04".
  if (m.distro && (!m.kind || m.kind === 'linux' || m.kind === 'wsl')) return [DISTRO_WORDS[m.distro], m.distroVersion].filter(Boolean).join(' ') + (m.kind === 'wsl' ? ' · WSL' : '');
  const kind = m.kind ? KIND_WORDS[m.kind] : m.platform === 'macos' ? 'Mac' : m.platform === 'windows' ? 'Windows' : 'Linux';
  return m.region ? `${kind} · ${m.region}` : kind;
}

/** One line of what it has free, or how it is when it isn't online. */
export function loadLine(m: Pick<MachineView, 'status' | 'info' | 'rttMs' | 'note' | 'lastSeen'>, now = Date.now()): string {
  if (m.note) return m.note;
  if (m.status !== 'online') return m.status === 'offline' ? (m.lastSeen ? t('machines.model.offlineSeen', { ago: ago(now - m.lastSeen) }) : t('machines.model.offline')) : t('machines.model.looking');
  const i = m.info;
  if (!i) return t('machines.model.online');
  const parts = [t('machines.model.busy', { pct: Math.round(i.loadPerCore * 100) }), t('machines.model.memFree', { gb: i.memory.freeGB }), ...(i.disk ? [t('machines.model.disk', { gb: Math.round(i.disk.freeGB) })] : []), ...(i.agentsRunning ? [t('machines.model.working', { n: i.agentsRunning })] : []), ...(m.rttMs !== undefined ? [t('machines.model.ms', { ms: m.rttMs })] : [])];
  return parts.join(' · ');
}

/** "5 min", "just now": how long ago, in the language shown (remote-work.ts says it too). */
export const ago = (ms: number): string => {
  const min = Math.round(ms / 60_000);
  return min < 1 ? t('machines.model.ago.now') : min < 60 ? t('machines.model.ago.min', { n: min }) : min < 60 * 24 ? t('machines.model.ago.h', { n: Math.round(min / 60) }) : t('machines.model.ago.d', { n: Math.round(min / 1440) });
};

/** One item of a computer's health strip: ready, or not with its fix. */
export interface Health {
  readonly key: string;
  readonly label: string;
  readonly ok: boolean;
  /** What isn't ready, in words, and the command that fixes it there. */
  readonly fix?: { readonly words: string; readonly command?: string };
  /** Plan usage, when it's known ("42% of 5 h"). */
  readonly usage?: string;
}

/** Claude, Codex, gh and the MCP servers there, each ready or with its fix. */
export function healthOf(m: Pick<MachineView, 'name' | 'info'>): Health[] {
  const i = m.info;
  if (!i) return [];
  /** A runtime's state there; one you don't use there (not installed and `optional`) isn't shown. */
  const rt = (id: string, label: string, signIn: string, optional = false): Health[] => {
    const r = i.runtimes.find((x) => x.id === id);
    const used = r?.usage?.fiveHour ? t('machines.model.usage5h', { pct: Math.round(r.usage.fiveHour.pct) }) : r?.usage?.week ? t('machines.model.usageWeek', { pct: Math.round(r.usage.week.pct) }) : undefined;
    if (r?.state === 'ready') return [{ key: id, label, ok: true, ...(used ? { usage: used } : {}) }];
    if (r?.state === 'signed_out') return [{ key: id, label, ok: false, fix: { words: t('machines.model.signIn', { label, name: m.name }), command: signIn } }];
    return optional ? [] : [{ key: id, label, ok: false, fix: { words: t('machines.model.notSetUp', { label, name: m.name }), command: 'beluga setup' } }];
  };
  return [
    ...rt('claude', 'Claude', 'claude auth login'),
    ...rt('codex', 'Codex', 'codex login', true),
    i.gh === 'signed_in' ? { key: 'gh', label: 'gh', ok: true } : { key: 'gh', label: 'gh', ok: false, fix: { words: i.gh === 'missing' ? t('machines.model.ghMissing', { name: m.name }) : t('machines.model.signIn', { label: 'gh', name: m.name }), command: 'gh auth login' } },
    { key: 'mcp', label: t('machines.model.mcp', { n: i.mcp.length }), ok: true },
  ];
}

/** Run New Work On's choices: this computer, Best Available, and each computer by name. */
export function runOnOptions(here: string, machines: ReadonlyArray<Pick<MachineView, 'id' | 'name'>>): Array<{ value: string; label: string }> {
  return [{ value: 'here', label: here }, { value: 'best', label: t('machines.model.best') }, ...machines.map((m) => ({ value: m.id, label: m.name }))];
}
