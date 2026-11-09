import type { AppState } from '@beluga/core/store.js';
import { type TopTab, topTabs } from '@beluga/ui/workspace-models.js';
import { shortcutKeys } from './shortcuts.js';
import { t } from '../i18n/index.js';

/**
 * The Mac app's places: Overview, Tasks and Chat (the sidebar's top), then Search, Usage,
 * Terminal and Shared files (the toolbar, the sidebar's top icons, the right panel). ⌘1…7, the
 * Go menu, ⌃Tab and the palette follow this order; each keeps its key even when it's absent.
 */

export type PlaceKind = TopTab['kind'] | 'tasks';

export interface Place extends Omit<TopTab, 'kind'> {
  readonly kind: PlaceKind;
  /** Its ⌘ key (1…7). */
  readonly key: number;
}

export const GO_ORDER: readonly PlaceKind[] = ['overview', 'tasks', 'room', 'search', 'usage', 'terminal', 'files'];

/** A hint ending with the place's key (yours: Settings › Keyboard). */
function withKeys(hint: string, kind: PlaceKind): string {
  const keys = shortcutKeys(`go-${kind}`);
  return keys ? `${hint} · ${keys}` : hint;
}

/** The places there are now, in order, each hint ending with its key. */
export function macTabs(state: AppState): Place[] {
  const tabs = topTabs(state);
  return GO_ORDER.flatMap((kind, i): Place[] => {
    const key = i + 1;
    if (kind === 'tasks') return state.board.enabled ? [{ kind, key, label: t('common.go.tasks'), short: t('common.go.tasks'), hint: withKeys(t('common.go.tasksHint'), kind), badge: 0 }] : [];
    const tab = tabs.find((x) => x.kind === kind);
    return tab ? [{ ...tab, ...placeWords(tab, state.peers.length <= 1), kind, key, hint: withKeys(placeWords(tab, state.peers.length <= 1).hint, kind) }] : [];
  });
}

/** A place's name and hint in the language shown (the engine's topTabs has the English). */
function placeWords(tab: TopTab, solo: boolean): { readonly label: string; readonly short: string; readonly hint: string } {
  switch (tab.kind) {
    case 'room':
      return { label: solo ? t('common.go.room.label') : t('common.go.room.labelGroup'), short: t('common.go.room.short'), hint: solo ? t('common.go.room.hint') : t('common.go.room.hintGroup') };
    case 'files':
      return { label: t('common.go.files.label'), short: t('common.go.files.short'), hint: tab.badge ? t('common.go.files.hintNew', { count: tab.badge }) : t('common.go.files.hint') };
    case 'overview':
      return { label: t('common.go.overview.label'), short: t('common.go.overview.short'), hint: tab.badge ? t(tab.urgent ? 'common.go.overview.hintUrgent' : 'common.go.overview.hintNews', { count: tab.badge }) : t('common.go.overview.hint') };
    default:
      return { label: t(`common.go.${tab.kind}.label`), short: t(`common.go.${tab.kind}.label`), hint: t(`common.go.${tab.kind}.hint`) };
  }
}

/** The place ⌃Tab (+1) or ⌃⇧Tab (-1) goes to; from elsewhere, the first or last one. */
export function stepPlace(state: AppState, delta: 1 | -1): PlaceKind {
  const order = macTabs(state).map((p) => p.kind);
  const here = state.view.kind === 'task' ? 'tasks' : state.view.kind;
  const at = order.indexOf(here as PlaceKind);
  if (at < 0) return delta > 0 ? order[0]! : order[order.length - 1]!;
  return order[(at + delta + order.length) % order.length]!;
}
