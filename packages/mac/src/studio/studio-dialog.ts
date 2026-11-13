import { useSyncExternalStore } from 'react';
import { t } from '../i18n/index.js';

/**
 * The Synon Studio dialog's open state and whether this Mac is connected (docs/studio-daemon.md §8).
 *
 * Two tiny stores, the way lib/earnings.ts keeps its sheet: the dialog is opened from a project's
 * ⋯ menu or from Settings, and the menu's words ("Connect to Studio…" / "Synon Studio…") follow the
 * link, which the always-mounted dialog keeps up to date with one status call.
 */

export interface StudioDialogState {
  /** The project the dialog was opened for: its "Share this project" switch. */
  readonly projectId?: string;
}

let current: StudioDialogState | undefined;
const dialogListeners = new Set<() => void>();
const emitDialog = (): void => {
  for (const listener of dialogListeners) listener();
};

export function openStudioDialog(projectId?: string): void {
  current = { ...(projectId ? { projectId } : {}) };
  emitDialog();
}

export function closeStudioDialog(): void {
  if (!current) return;
  current = undefined;
  emitDialog();
}

export const useStudioDialog = (): StudioDialogState | undefined =>
  useSyncExternalStore(
    (listener) => {
      dialogListeners.add(listener);
      return () => void dialogListeners.delete(listener);
    },
    () => current,
  );

let linked: boolean | undefined;
const linkListeners = new Set<() => void>();

/** The dialog sets this from its status calls; undefined until the first one (the menu says Connect). */
export function setStudioLinked(value: boolean): void {
  if (linked === value) return;
  linked = value;
  for (const listener of linkListeners) listener();
}

export const useStudioLinked = (): boolean | undefined =>
  useSyncExternalStore(
    (listener) => {
      linkListeners.add(listener);
      return () => void linkListeners.delete(listener);
    },
    () => linked,
  );

/** The project ⋯ menu's entry, next to Connect Earnings…. */
export function studioMenuItem(projectId: string, isLinked: boolean | undefined): { label: string; onSelect: () => void; separate: boolean } {
  return {
    label: isLinked ? t('Synon Studio…') : t('Connect to Studio…'),
    onSelect: () => openStudioDialog(projectId),
    separate: true,
  };
}
