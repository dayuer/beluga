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
  // Each piece of text in its language, as the web view's own pieces are (a name in bold, a sentence around it).
  const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const text = node.textContent ?? '';
    const lead = /^\s*/.exec(text)![0];
    const tail = /\s*$/.exec(text)![0];
    if (text.trim()) node.textContent = `${lead}${t(text.trim())}${tail}`;
  }
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Shows the alert natively once, when `on`, and runs the button pressed. `on` false: nothing,
 * the caller draws its own. Returns `on`, so the caller can draw nothing while it's shown.
 */
export function useNativeAlert(on: boolean, spec: NativeAlertSpec): boolean {
  const latest = useRef(spec);
  latest.current = spec;
  // What it says: an alert that stays mounted with other words (one confirm after another) is shown again.
  const words = on ? `${spec.title}\u0000${textOf(spec.message)}` : '';
  useEffect(() => {
    if (!on) return;
    let live = true;
    const token = Math.floor(Math.random() * 2 ** 48);
    const s = latest.current;
    const buttons = [s.confirm, ...(s.cancel ? [s.cancel] : []), ...(s.alternative ? [s.alternative] : [])];
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const at = await invoke<number>('native_alert', {
          token,
          title: t(s.title),
          message: t(textOf(s.message)),
          style: s.tone === 'info' ? 'info' : 'warning',
          buttons: buttons.map((b) => ({ label: t(b.label), destructive: 'destructive' in b && Boolean(b.destructive), cancel: b === s.cancel })),
        });
        // Its page went meanwhile (taken down below): what it would have run is stale.
        if (!live) return;
        const pressed = buttons[at];
        if (pressed) pressed.run();
        else s.cancel?.run();
      } catch {
        // Couldn't show it: Esc's way out, so nothing happens behind your back.
        if (live) s.cancel?.run();
      }
    })();
    return () => {
      live = false;
      // The page that asked is gone (Esc, another sheet, the project removed): so is its alert.
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('native_alert_close', { token })).catch(() => undefined);
    };
  }, [on, words]);
  return on;
}

/** Native alerts here: the app, on a Mac (as its menus). */
export const nativeAlerts = nativeMenus;
