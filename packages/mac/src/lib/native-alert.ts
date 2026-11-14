import { type ReactNode, isValidElement, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { t } from '../i18n/index.js';
import { nativeMenus } from './native-menu.js';

/**
 * "Are you sure?" as the Mac's own alert (src-tauri/src/native_alert.rs): an NSAlert slid down
 * from the window's title bar as a sheet, with the app's icon, its buttons laid out and keyed as
 * macOS does, a destructive one red. In the app on a Mac, for an alert that's only words and
 * buttons; one with a table or a checkbox of its own keeps the app's (components/Alert.tsx).
 */

export interface NativeAlertButton {
  readonly label: string;
  readonly destructive?: boolean;
  readonly run: () => void;
}

export interface NativeAlertSpec {
  readonly title: string;
  readonly message?: ReactNode;
  readonly tone?: 'info' | 'caution' | 'danger';
  /** What Return does: the default button. */
  readonly confirm: NativeAlertButton;
  /** What Esc does (its words), or none. */
  readonly cancel?: { readonly label: string; readonly run: () => void };
  /** A second way to go on, on the left ("Don't Save"). */
  readonly alternative?: NativeAlertButton;
}

/** A message's words, without its markup (a name in bold, a path in code). */
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const markup = isValidElement(node) || Array.isArray(node) ? renderToStaticMarkup(node as never) : String(node);
  const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Shows the alert natively once, when `on`, and runs the button pressed. `on` false: nothing,
 * the caller draws its own. Returns `on`, so the caller can draw nothing while it's shown.
 */
export function useNativeAlert(on: boolean, spec: NativeAlertSpec): boolean {
  const shown = useRef(false);
  const latest = useRef(spec);
  latest.current = spec;
  useEffect(() => {
    if (!on || shown.current) return;
    shown.current = true;
    const s = latest.current;
    const buttons = [s.confirm, ...(s.cancel ? [s.cancel] : []), ...(s.alternative ? [s.alternative] : [])];
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const at = await invoke<number>('native_alert', {
          title: t(s.title),
          message: t(textOf(s.message)),
          style: s.tone === 'info' ? 'info' : 'warning',
          buttons: buttons.map((b) => ({ label: t(b.label), destructive: 'destructive' in b && Boolean(b.destructive), cancel: b === s.cancel })),
        });
        const pressed = buttons[at];
        if (pressed) pressed.run();
        else s.cancel?.run();
      } catch {
        // Couldn't show it: Esc's way out, so nothing happens behind your back.
        s.cancel?.run();
      }
    })();
  }, [on]);
  return on;
}

/** Native alerts here: the app, on a Mac (as its menus). */
export const nativeAlerts = nativeMenus;
