import { inApp } from './boot.js';
import { isMac } from './system.js';
import { t } from '../i18n/index.js';
import { iconShape } from '../components/Icon.js';
import { type NativeRow, acceleratorOf } from './native-menu-model.js';

export { type NativeRow, nativeFits } from './native-menu-model.js';

/**
 * The Mac's own menus for the app's right-click menus and ⋯ dropdowns (components/SpecMenu.tsx).
 *
 * A menu the web view draws gives itself away: its blur, how a submenu opens, typing a letter to
 * jump to an item, how it goes away, and macOS's own look as it changes (macOS 26's glass). In
 * the app on a Mac, a menu is an NSMenu instead, built in one call (Tauri's menu API) when it
 * opens and dropped when it closes.
 *
 * Only what an NSMenu says the same way goes native: names, shortcuts, checkmarks, submenus,
 * groups, and the app's icons and colour dots (drawn to a picture in the menu's own text colour).
 * A menu with a line of explanation under an item, or a mark of its own (a computer's, a board's),
 * stays the web view's, so nothing it says is lost. Browsers, Windows and Linux keep the web menus.
 */

/** Native menus here: the app, on a Mac. */
export const nativeMenus = (): boolean => inApp() && isMac();

/** A row as Tauri's menu API takes it: a separator, an item, a checked item or a submenu. */
type Built = { item: 'Separator' } | { text: string; enabled: boolean; accelerator?: string; checked?: boolean; icon?: number[]; items?: Built[]; action?: () => void };

const ICON_PX = 36; // muda sets a menu image 18 pt high: 36 px on a Retina screen.
const icons = new Map<string, number[]>();

const textColour = (): string => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)');

/** An icon (or a colour dot) as a PNG in the menu's text colour, kept once drawn. */
async function picture(row: NativeRow): Promise<number[] | undefined> {
  if (!row.icon && !row.swatch) return undefined;
  const colour = textColour();
  const key = `${row.icon ?? `swatch:${row.swatch}`}|${colour}`;
  const kept = icons.get(key);
  if (kept) return kept;
  const canvas = new OffscreenCanvas(ICON_PX, ICON_PX);
  const g = canvas.getContext('2d');
  if (!g) return undefined;
  if (row.icon) {
    const shape = iconShape(row.icon);
    // The icon's 16 pt in the 18 pt the menu gives it, centred, as the web menu draws it at 13–16.
    const side = ICON_PX * (16 / 18);
    const at = (ICON_PX - side) / 2;
    g.translate(at, at);
    g.scale(side / shape.grid, side / shape.grid);
    const path = new Path2D(shape.d);
    if (shape.filled) {
      g.fillStyle = shape.color ?? colour;
      g.fill(path, shape.evenOdd ? 'evenodd' : 'nonzero');
    } else {
      g.strokeStyle = colour;
      g.lineWidth = 1.5;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke(path);
    }
  } else {
    g.fillStyle = row.swatch!;
    g.beginPath();
    g.arc(ICON_PX / 2, ICON_PX / 2, ICON_PX * 0.28, 0, Math.PI * 2);
    g.fill();
  }
  const bytes = Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  icons.set(key, bytes);
  return bytes;
}

async function build(rows: readonly NativeRow[], withIcons: boolean, withKeys: boolean): Promise<Built[]> {
  const out: Built[] = [];
  for (const [i, row] of rows.entries()) {
    if (i > 0 && (row.separate || (row.danger && !rows[i - 1]!.danger))) out.push({ item: 'Separator' });
    const text = t(row.label);
    const enabled = !row.disabled;
    if (row.submenu) {
      const icon = withIcons ? await picture(row) : undefined;
      out.push({ text, enabled, items: await build(row.submenu, withIcons, withKeys), ...(icon ? { icon } : {}) });
      continue;
    }
    const accelerator = withKeys ? acceleratorOf(row.keys) : undefined;
    const action = row.onSelect;
    const common = { text, enabled, ...(accelerator ? { accelerator } : {}), ...(action ? { action: () => action() } : {}) };
    // A checkmark takes the image's place, as in a Mac's own menus.
    if (row.checked !== undefined) out.push({ ...common, checked: row.checked });
    else {
      const icon = withIcons ? await picture(row) : undefined;
      out.push({ ...common, ...(icon ? { icon } : {}) });
    }
  }
  return out;
}

let showing = false;

/**
 * Shows the rows as the Mac's own menu: at the pointer, or at `at` (the window's points: under a
 * ⋯ button). Resolves once it has closed and what was picked has run, or false when it couldn't
 * be shown (the caller then has nothing open: a press does nothing rather than open two menus).
 */
export async function popUpNative(rows: readonly NativeRow[], at?: { readonly x: number; readonly y: number }): Promise<boolean> {
  if (showing) return true;
  showing = true;
  try {
    const [{ Menu }, { LogicalPosition }] = await Promise.all([import('@tauri-apps/api/menu'), import('@tauri-apps/api/dpi')]);
    const list = rows.length ? rows : [{ label: 'Nothing to do here', disabled: true }];
    // A picture or a shortcut NSMenu won't take mustn't cost the menu: try again without them.
    for (const [withIcons, withKeys] of [[true, true], [false, false]] as const) {
      let menu: Awaited<ReturnType<typeof Menu.new>> | undefined;
      try {
        menu = await Menu.new({ items: (await build(list, withIcons, withKeys)) as never });
      } catch {
        continue;
      }
      try {
        await menu.popup(at ? new LogicalPosition(at.x, at.y) : undefined);
        return true;
      } finally {
        // What was picked reaches its channel before the menu's resources go (Tauri keeps the order).
        void menu.close().catch(() => undefined);
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    showing = false;
  }
}
