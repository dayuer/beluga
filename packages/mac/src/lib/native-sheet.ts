import { useEffect, useRef, useState } from 'react';
import type { IconName } from '../components/Icon.js';
import type { SelectEntry } from '../components/select-parts.js';
import { isSection } from '../components/select-model.js';
import { locale, t } from '../i18n/index.js';
import { hexOf } from './hex-colour.js';
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
  /** A line under it in the open menu (a pop-up's option). */
  readonly hint?: string;
  /** Its section in a pop-up: a new one starts with a line and its title. */
  readonly section?: string;
  readonly disabled?: boolean;
  /** A word in a card's corner ("Now"). */
  readonly badge?: string;
}

/** A pop-up button's options (components/Select.tsx's entries: sections, descriptions, icons) as the sheet's. */
export function choicesOf(entries: readonly SelectEntry<string>[]): SheetChoice[] {
  return entries.flatMap((e) =>
    (isSection(e) ? e.options.map((o) => [o, e.section] as const) : [[e, undefined] as const]).map(([o, section]) => ({
      value: o.value,
      label: o.label,
      ...(typeof o.icon === 'string' ? { icon: o.icon } : o.icon ? { mark: o.icon } : {}),
      ...(typeof o.description === 'string' && o.description ? { hint: o.description } : {}),
      ...(section !== undefined ? { section } : {}),
      ...(o.disabled ? { disabled: true } : {}),
    })),
  );
}

export type SheetRowSpec =
  | { readonly kind: 'textarea'; readonly id: string; readonly value: string; readonly placeholder?: string; readonly lines?: number; readonly mentions?: readonly string[]; readonly focus?: boolean; readonly maxLength?: number }
  /** `maxLength`, `upper` and `keep` (the only characters it takes) apply as you type, in the field itself. */
  | { readonly kind: 'text'; readonly id: string; readonly label?: string; readonly value: string; readonly placeholder?: string; readonly hint?: string; readonly focus?: boolean; readonly maxLength?: number; readonly upper?: boolean; readonly keep?: string }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'disclosure'; readonly id: string; readonly label: string; readonly open: boolean }
  | { readonly kind: 'checkbox'; readonly id: string; readonly label?: string; readonly text: string; readonly checked: boolean; readonly hint?: string; readonly disabled?: boolean }
  /** Option cards side by side (the app's own, plans.module.css's .modeCards): icon, name, line; the label a heading above. */
  | { readonly kind: 'cards'; readonly id: string; readonly label: string; readonly value: string; readonly options: readonly SheetChoice[] }
  /** A tinted box of words (.modeConfirm): what changes, its second line dimmer. */
  | { readonly kind: 'callout'; readonly text: string; readonly detail?: string }
  /** One option to a line, each with its icon and its line under it (the app's option cards, as AppKit draws them). */
  | { readonly kind: 'radio'; readonly id: string; readonly label: string; readonly value: string; readonly options: readonly SheetChoice[] }
  /** A push button ("Choose Another Folder…"): pressing it is a change to "press". */
  | { readonly kind: 'button'; readonly id: string; readonly label?: string; readonly text: string; readonly hint?: string }
  | { readonly kind: 'popup'; readonly id: string; readonly label: string; readonly value: string; readonly options: readonly SheetChoice[]; readonly hint?: string }
  | { readonly kind: 'segmented'; readonly id: string; readonly label: string; readonly value: string; readonly options: readonly SheetChoice[]; readonly hint?: string; readonly disabled?: boolean };

export interface SheetSpec {
  readonly title: string;
  readonly intro?: string;
  readonly rows: readonly SheetRowSpec[];
  /** A checkbox left of the buttons ("Start with your agent"). */
  readonly footer?: { readonly id: string; readonly label: string; readonly detail?: string; readonly checked: boolean };
  /** A button on the left of the buttons' row ("Delete Board…"): pressing it is a change to "press". */
  readonly aside?: { readonly id: string; readonly label: string };
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

/**
 * Words made of parts, each translated on its own (as the web sheet's pieces are), joined:
 * the whole would be a sentence the catalog doesn't have. A part that's a name stays as it is.
 */
export const parts = (...pieces: ReadonlyArray<string | false | undefined>): string => pieces.filter((p): p is string => Boolean(p)).map((p) => t(p)).join(' · ');
/** "Label: value" with the label translated and the language's own colon. */
export const labelled = (label: string, value: string): string => `${colon(label)} ${value}`;

async function choices(options: readonly SheetChoice[]): Promise<unknown[]> {
  return Promise.all(
    options.map(async (o) => {
      const made = await picture(o.icon ? { icon: o.icon } : o.mark != null ? { mark: o.mark } : undefined);
      return {
        value: o.value,
        label: t(o.label),
        ...(made ? { icon: made.png, template: made.template } : {}),
        ...(o.hint ? { hint: t(o.hint) } : {}),
        ...(o.section !== undefined ? { section: t(o.section) } : {}),
        ...(o.disabled ? { disabled: true } : {}),
        ...(o.badge ? { badge: t(o.badge) } : {}),
      };
    }),
  );
}

/** The colours the sheet draws in, as the page has them now (Settings › Appearance: light or dark, the theme, the accent). */
export interface SheetPalette {
  readonly dark: boolean;
  /** `#rrggbb`: var(--accent), the cards' outline and tint, the main button. */
  readonly accent: string;
  /** `#rrggbb`: var(--bg), under the cards. */
  readonly bg: string;
  /** `#rrggbb`: var(--bg-raised), the sheet itself. */
  readonly surface: string;
}

/** The page's colours now, read off a probe under :root (custom properties resolve only on an element). */
function palette(): SheetPalette | undefined {
  if (typeof document === 'undefined') return undefined;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.documentElement.appendChild(probe);
  const read = (v: string): string | undefined => {
    probe.style.color = `var(${v})`;
    return hexOf(getComputedStyle(probe).color);
  };
  const accent = read('--accent');
  const bg = read('--bg');
  const surface = read('--bg-raised') ?? bg;
  probe.remove();
  if (!accent || !bg || !surface) return undefined;
  return { dark: document.documentElement.dataset.theme === 'dark', accent, bg, surface };
}

/** The form as the sheet takes it: words translated, labels with their colon, pictures drawn. */
async function wire(spec: SheetSpec): Promise<unknown> {
  const colours = palette();
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
        case 'button':
          return { ...row, ...(row.label ? { label: colon(row.label) } : {}), text: t(row.text), ...(row.hint ? { hint: t(row.hint) } : {}) };
        case 'checkbox':
          return { ...row, ...(row.label ? { label: colon(row.label) } : {}), text: t(row.text), ...(row.hint ? { hint: t(row.hint) } : {}) };
        case 'radio':
          return { ...row, label: colon(row.label), options: await choices(row.options) };
        case 'cards':
          return { ...row, label: t(row.label), options: await choices(row.options) };
        case 'callout':
          return { kind: 'callout', text: t(row.text), ...(row.detail ? { detail: t(row.detail) } : {}) };
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
    ...(spec.aside ? { aside: { ...spec.aside, label: t(spec.aside.label) } } : {}),
    cancel: t(spec.cancel ?? 'Cancel'),
    submit: t(spec.submit),
    canSubmit: spec.canSubmit,
    busy: Boolean(spec.busy),
    ...(spec.error ? { error: spec.error } : {}),
    ...(spec.width ? { width: spec.width } : {}),
    ...(colours ? { palette: colours } : {}),
  };
}

/**
 * Shows `spec` as the Mac's own sheet while `on`, and keeps it in step with the page's state.
 * Returns `on`: the caller draws nothing of its own then.
 */
export function useNativeSheet(on: boolean, spec: SheetSpec, handlers: SheetHandlers): boolean {
  const latest = useRef(handlers);
  latest.current = handlers;
  // The sheet once it's open: its id, which its updates and close carry (null: it couldn't open).
  const opened = useRef<Promise<number | null> | undefined>(undefined);
  // The form as it was last sent (its JSON), so a render that changed nothing sends nothing.
  const sent = useRef('');
  // Each send's turn: a slower one (pictures still drawing) never lands after a newer one.
  const turn = useRef(0);
  // This mount's life: bumped when it ends, so a send still on its way when the sheet went (Esc,
  // another sheet) opens nothing, updates nothing and cancels nothing.
  const life = useRef(0);
  // A change the page didn't take as typed (clamped, refused, a checkbox that can't change) has
  // to go back to the control: each change sends the form again.
  const [, poke] = useState(0);
  // The colours count too: switching the theme or accent with the sheet open draws it again.
  const key = JSON.stringify(palette() ?? null) + JSON.stringify(spec, (_k, v: unknown) => (typeof v === 'object' && v !== null && '$$typeof' in v ? `mark:${String((v as { key?: unknown }).key ?? '')}` : v));

  useEffect(() => {
    if (!on) return;
    const mine = life.current;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen<{ kind: 'change'; id: string; value: string } | { kind: 'submit' } | { kind: 'cancel' }>('native-sheet', ({ payload }) => {
        if (mine !== life.current) return;
        if (payload.kind === 'change') {
          latest.current.change(payload.id, payload.value);
          sent.current = '';
          poke((n) => n + 1);
        } else if (payload.kind === 'submit') latest.current.submit();
        else latest.current.cancel();
      });
      if (mine !== life.current) return off();
      unlisten = off;
    })();
    return () => {
      life.current++;
      unlisten?.();
      const was = opened.current;
      opened.current = undefined;
      sent.current = '';
      // Closed by its id once it's open: one still opening is closed as soon as it is.
      void was?.then((id) => (id === null ? undefined : import('@tauri-apps/api/core').then(({ invoke }) => invoke('native_sheet_close', { id })))).catch(() => undefined);
    };
  }, [on]);

  useEffect(() => {
    if (!on || key === sent.current) return;
    sent.current = key;
    const mine = ++turn.current;
    const alive = life.current;
    void (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const wired = await wire(spec);
      if (alive !== life.current || (mine !== turn.current && opened.current)) return;
      if (!opened.current) {
        opened.current = invoke<number | null>('native_sheet_open', { spec: wired }).catch(() => null);
        if ((await opened.current) === null && alive === life.current) latest.current.cancel();
      } else {
        const id = await opened.current;
        if (id === null || alive !== life.current) return;
        await invoke('native_sheet_update', { id, spec: wired }).catch(() => undefined);
      }
    })();
  });
  return on;
}
