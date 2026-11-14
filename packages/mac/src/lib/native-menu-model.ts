import type { IconName } from '../components/Icon.js';

/** The pure part of lib/native-menu.ts: which menus can be native, and their shortcuts as NSMenu takes them. */

/** What a row of a native menu needs; components/SpecMenu.tsx's ActionItem fits it. */
export interface NativeRow {
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly keys?: string;
  readonly icon?: IconName;
  readonly mark?: unknown;
  readonly separate?: boolean;
  readonly checked?: boolean;
  readonly swatch?: string;
  readonly submenu?: readonly NativeRow[];
  readonly onSelect?: () => void;
}

/** Whether a native menu can say everything these rows say (no explanation lines, no own marks). */
export function nativeFits(rows: readonly NativeRow[]): boolean {
  return rows.every((r) => !r.hint && r.mark == null && (!r.submenu || nativeFits(r.submenu)));
}

const MODIFIERS: Readonly<Record<string, string>> = { '⌃': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift', '⌘': 'Cmd' };
const NAMED: Readonly<Record<string, string>> = {
  '↩': 'Enter', '⏎': 'Enter', '⌤': 'Enter', '⌫': 'Backspace', '⌦': 'Delete', '⎋': 'Escape', '⇥': 'Tab',
  '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown',
  Space: 'Space', Esc: 'Escape', Enter: 'Enter', Return: 'Enter', Tab: 'Tab', Delete: 'Backspace',
};

/**
 * A shortcut as the app writes it (⇧⌘C, ⌘↩, ⌥⌘1) as an accelerator NSMenu shows on the right
 * ("Shift+Cmd+C"), or undefined when it isn't one (then the row shows none rather than a wrong one).
 */
export function acceleratorOf(keys: string | undefined): string | undefined {
  if (!keys) return undefined;
  let rest = keys.trim();
  const mods: string[] = [];
  while (rest.length > 1 && MODIFIERS[rest[0]!]) {
    mods.push(MODIFIERS[rest[0]!]!);
    rest = rest.slice(1);
  }
  const key = NAMED[rest] ?? (/^[A-Za-z0-9]$/.test(rest) ? rest.toUpperCase() : /^F([1-9]|1[0-2])$/.test(rest) ? rest : /^[,.\/;'\[\]\\`=-]$/.test(rest) ? rest : undefined);
  if (!key || !mods.length) return undefined;
  return [...new Set(mods)].concat(key).join('+');
}
