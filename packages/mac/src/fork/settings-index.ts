import type { SettingEntry, SettingsPane } from '../lib/settings-search.js';

/**
 * This fork's own settings rows for the search (BLG-740), each block placed right after the
 * upstream group it follows in its pane. Upstream's list stays as upstream wrote it and passes
 * through `withForkSettings` once, so syncing upstream never conflicts there (docs/fork.md).
 */
type Entry = SettingEntry<SettingsPane>;

const rows = (pane: SettingsPane, group: string, list: ReadonlyArray<readonly [string, string?, string?]>): Entry[] =>
  list.map(([label, detail, keywords]) => ({ pane, label, group, ...(detail ? { detail } : {}), ...(keywords ? { keywords } : {}) }));
const group = (pane: SettingsPane, label: string, detail?: string, keywords?: string): Entry => ({ pane, label, isGroup: true, ...(detail ? { detail } : {}), ...(keywords ? { keywords } : {}) });

/** `after`: the upstream group (in the same pane) this block comes after. */
export const FORK_SETTINGS: ReadonlyArray<{ readonly after: string; readonly entries: readonly Entry[] }> = [
  {
    after: 'Your agents',
    entries: [
      group('claude', 'Auto Route', 'Which model a task without an agent goes to', 'auto route model glm deepseek haiku opus hard'),
      ...rows('claude', 'Auto Route', [
        ['Pick a model for each task', 'Which model a task without an agent goes to', 'auto route autopilot model pick'],
        ['Urgent and high are hard too', undefined, 'urgent high priority hard opus'],
      ]),
    ],
  },
  {
    after: 'Pair a phone',
    entries: [
      group('phone', 'Invite a customer', 'The customer sees only this project: its conversations, cards and screenshots.', 'invite customer client project link expires share'),
      ...rows('phone', 'Invite a customer', [
        ['Project', 'The customer sees only this project: its conversations, cards and screenshots.', 'invite customer client project'],
        ['Link valid for', 'After that the link stops working; a phone already paired stays until you remove it.', 'invite link expires days validity'],
      ]),
    ],
  },
  {
    after: 'Reduce motion',
    entries: rows('appearance', 'Layout', [['Calm mode', 'A still, predictable window: short motion, and nothing that moves on its own.', 'calm steady quiet still motion 沉稳 沉稳模式 动效 安静']]),
  },
  {
    // BLG-218: 「我的共享」——一个默认 + 少数例外，取代沉稳模式下「在房间中」那两组。
    after: 'In the room',
    entries: [
      group('people', 'My sharing', 'One default for every circle; only the ones that differ are listed.', '我的共享 共享 圈 信任 默认 例外 批量 sharing trust default circle'),
      ...rows('people', 'My sharing', [['All circles', 'The level for every circle that doesn’t have its own.', '默认 所有圈 policy ask trusted blocked full 共享级别']]),
    ],
  },
];

/** Upstream's list with each fork block after its group's last row (at the end when that group is gone). */
export function withForkSettings(base: readonly Entry[], blocks = FORK_SETTINGS): Entry[] {
  const out = [...base];
  for (const { after, entries } of blocks) {
    const pane = entries[0]?.pane;
    let at = -1;
    out.forEach((e, i) => {
      if (e.pane === pane && (e.label === after || e.group === after)) at = i;
    });
    out.splice(at < 0 ? out.length : at + 1, 0, ...entries);
  }
  return out;
}
