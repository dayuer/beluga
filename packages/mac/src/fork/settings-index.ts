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
    after: 'Reduce motion',
    entries: rows('appearance', 'Layout', [['Calm mode', 'A still, predictable window: short motion, and nothing that moves on its own.', 'calm steady quiet still motion 沉稳 沉稳模式 动效 安静']]),
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
