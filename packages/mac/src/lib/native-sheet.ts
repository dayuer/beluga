import { useEffect, useRef } from 'react';
import type { IconName } from '../components/Icon.js';
import { locale, t } from '../i18n/index.js';
import { nativeMenus, picture } from './native-menu.js';

/**
 * A form sheet as the Mac's own (src-tauri/src/native_sheet.rs): an NSPanel slid down from the
 * title bar, every control the system's. The page keeps the form's state: `useNativeSheet` sends
 * the whole form when it opens and again when it changes, and hands each change back to you.
 * Names and words go through t() here; labels get their colon (a Chinese one in Chinese).
 */

export interface SheetChoice {
  readonly value: string;
  readonly label: string;
  readonly icon?: IconName;
  /** A mark of its own (an agent's logo, a priority's bars): drawn when it's an SVG. */
  readonly mark?: unknown;
}

export type SheetRowSpec =
  | { readonly kind: 'textarea'; readonly id: string; readonly value: string; readonly placeholder?: string; readonly lines?: number; readonly mentions?: readonly string[]; readonly focus?: boolean }
  | { readonly kind: 'text'; readonly id: string; readonly label?: string; readonly value: string; readonly placeholder?: string; readonly hint?: string; readonly focus?: boolean }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'disclosure'; readonly id: string; readonly label: string; readonly open: boolean }
  | { readonly kind: 'popup'; readonly id: string; readonly label: string; readonly value: string; readonly options: readonly SheetChoice[]; readonly hint?: string }
  | { readonly kind: 'segmented'; readonly id: string; readonly label: string; readonly value: string; readonly options: readonly SheetChoice[]; readonly hint?: string; readonly disabled?: boolean };

export interface SheetSpec {
  readonly title: string;
  readonly intro?: string;
  readonly rows: readonly SheetRowSpec[];
  /** A checkbox left of the buttons ("Start with your agent"). */
  readonly footer?: { readonly id: string; readonly label: string; readonly detail?: string; readonly checked: boolean };
  readonly cancel?: string;
  readonly submit: string;
  readonly canSubmit: boolean;
  readonly busy?: boolean;
  readonly error?: string;
  readonly width?: number;
}

export interface SheetHandlers {
  readonly change: (id: string, value: string) => void;
  readonly submit: () => void;
  readonly cancel: () => void;
}

/** Native sheets here: the app, on a Mac (as its menus). */
export const nativeSheets = nativeMenus;

const colon = (label: string): string => `${t(label)}${locale() === 'zh-CN' ? '：' : ':'}`;

async function choices(options: readonly SheetChoice[]): Promise<unknown[]> {
  return Promise.all(
    options.map(async (o) => {
      const made = await picture(o.icon ? { icon: o.icon } : o.mark != null ? { mark: o.mark } : undefined);
      return { value: o.value, label: t(o.label), ...(made ? { icon: made.png, template: made.template } : {}) };
    }),
  );
}

/** The form as the sheet takes it: words translated, labels with their colon, pictures drawn. */
async function wire(spec: SheetSpec): Promise<unknown> {
  const rows = await Promise.all(
    spec.rows.map(async (row) => {
      switch (row.kind) {
        case 'textarea':
          return { ...row, ...(row.placeholder ? { placeholder: t(row.placeholder) } : {}), mentions: (row.mentions ?? []).map((handle) => ({ handle })) };
        case 'text':
          return { ...row, ...(row.label ? { label: colon(row.label) } : {}), ...(row.placeholder ? { placeholder: t(row.placeholder) } : {}), ...(row.hint ? { hint: t(row.hint) } : {}) };
        case 'note':
          return { ...row, text: t(row.text) };
        case 'disclosure':
          return { ...row, label: t(row.label) };
        case 'popup':
        case 'segmented':
          return { ...row, label: colon(row.label), options: await choices(row.options), ...(row.hint ? { hint: t(row.hint) } : {}) };
      }
    }),
  );
  return {
    title: t(spec.title),
    ...(spec.intro ? { intro: t(spec.intro) } : {}),
    rows,
    ...(spec.footer ? { footer: { ...spec.footer, label: t(spec.footer.label), ...(spec.footer.detail ? { detail: t(spec.footer.detail) } : {}) } } : {}),
    cancel: t(spec.cancel ?? 'Cancel'),
    submit: t(spec.submit),
    canSubmit: spec.canSubmit,
    busy: Boolean(spec.busy),
    ...(spec.error ? { error: spec.error } : {}),
    ...(spec.width ? { width: spec.width } : {}),
  };
}

/**
 * Shows `spec` as the Mac's own sheet while `on`, and keeps it in step with the page's state.
 * Returns `on`: the caller draws nothing of its own then.
 */
export function useNativeSheet(on: boolean, spec: SheetSpec, handlers: SheetHandlers): boolean {
  const latest = useRef(handlers);
  latest.current = handlers;
  const opened = useRef<Promise<boolean> | undefined>(undefined);
  // The form as it was last sent (its JSON), so a render that changed nothing sends nothing.
  const sent = useRef('');
  // Each send's turn: a slower one (pictures still drawing) never lands after a newer one.
  const turn = useRef(0);
  const key = JSON.stringify(spec, (_k, v: unknown) => (typeof v === 'object' && v !== null && '$$typeof' in v ? `mark:${String((v as { key?: unknown }).key ?? '')}` : v));

  useEffect(() => {
    if (!on) return;
    let unlisten: (() => void) | undefined;
    let gone = false;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen<{ kind: 'change'; id: string; value: string } | { kind: 'submit' } | { kind: 'cancel' }>('native-sheet', ({ payload }) => {
        if (payload.kind === 'change') latest.current.change(payload.id, payload.value);
        else if (payload.kind === 'submit') latest.current.submit();
        else latest.current.cancel();
      });
      if (gone) return off();
      unlisten = off;
    })();
    return () => {
      gone = true;
      unlisten?.();
      opened.current = undefined;
      sent.current = '';
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('native_sheet_close')).catch(() => undefined);
    };
  }, [on]);

  useEffect(() => {
    if (!on || key === sent.current) return;
    sent.current = key;
    const mine = ++turn.current;
    void (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const wired = await wire(spec);
      if (mine !== turn.current && opened.current) return;
      if (!opened.current) {
        opened.current = invoke<boolean>('native_sheet_open', { spec: wired }).catch(() => false);
        if (!(await opened.current)) latest.current.cancel();
      } else {
        await opened.current;
        await invoke('native_sheet_update', { spec: wired }).catch(() => undefined);
      }
    })();
  });
  return on;
}
