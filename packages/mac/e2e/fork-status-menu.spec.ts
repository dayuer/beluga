import { expect, test, type Page } from './fixtures.js';

/**
 * The status menu at the bottom of the sidebar (BLG-216; docs/calm-ui.md §3, §5): in calm mode it
 * is the trigger row's own contents, written once — no repeated name and status, one marker for
 * the current status, no second colour, equal rows, and no wider than the sidebar. With calm off
 * it is upstream's card, unchanged.
 *
 * CALM_IMG=<folder>: saves the two shots for docs/calm/README.md's "开 PR 前修复" section.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const me = (page: Page) => page.getByRole('button', { name: /^Your status/ });
const card = (page: Page) => page.getByRole('dialog', { name: 'Your status' });
const statusHead = (page: Page) => card(page).locator('[class*="_statusHead_"]');
const dots = (page: Page) => card(page).locator('[class*="_dot_"]');
const hints = (page: Page) => card(page).locator('[class*="_optionHint_"]');
const rows = (page: Page) => card(page).locator('[class*="_option_"]');

/** The demo starts with the network on; a turn it off earlier in the run would leave no button. */
async function ensureNetwork(page: Page): Promise<void> {
  if (await me(page).isVisible().catch(() => false)) return;
  await page.keyboard.press('ControlOrMeta+,');
  await page.getByRole('button', { name: 'People & access' }).click();
  const on = page.getByRole('switch', { name: 'Talk with friends directly' });
  if ((await on.getAttribute('aria-checked')) !== 'true') await on.click();
  await page.keyboard.press('Escape');
  await expect(me(page)).toBeVisible({ timeout: 30_000 });
}

async function openMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  await ensureNetwork(page);
  await me(page).click();
  await expect(card(page)).toBeVisible();
  await page.waitForTimeout(400); // the entrance is over
}

/** The sidebar's bottom corner and the card above it: where the user's shot is pointed. */
async function corner(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const nav = await sidebar(page).boundingBox();
  const box = await card(page).boundingBox();
  if (!nav || !box) throw new Error('no box for the sidebar or the status card');
  const x = Math.max(0, Math.min(nav.x, box.x) - 8);
  const y = Math.max(0, box.y - 8);
  return {
    x,
    y,
    width: Math.min(page.viewportSize()!.width - x, Math.max(nav.x + nav.width, box.x + box.width) + 8 - x),
    height: Math.min(page.viewportSize()!.height - y, nav.y + nav.height - y),
  };
}

async function shot(page: Page, name: string): Promise<void> {
  if (!process.env.CALM_IMG) return;
  await page.screenshot({ path: `${process.env.CALM_IMG}/${name}.png`, clip: await corner(page) });
}

test('calm on: the menu is the button written once, one marker, equal rows, inside the sidebar', async ({ page }) => {
  await openMenu(page);
  await shot(page, 'm6-status-calm-on');

  // The header repeated the button underneath it.
  await expect(statusHead(page)).toBeHidden();

  // The card ends at the sidebar's right edge (the trigger is the sidebar row).
  const nav = (await sidebar(page).boundingBox())!;
  const box = (await card(page).boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(nav.width);
  expect(box.x + box.width).toBeLessThanOrEqual(nav.x + nav.width + 0.5);

  // One marker: the check column. The coloured dots are gone from the menu.
  await expect(dots(page)).not.toHaveCount(0); // upstream dots exist, so the hidden check below means something
  await expect(dots(page).first()).toBeHidden();
  await expect(card(page).getByRole('radio', { name: /^Online/ })).toHaveAttribute('aria-checked', 'true');

  // The hints are the hover title now, so rows are one height.
  await expect(hints(page).first()).toBeHidden();
  await expect(card(page).getByRole('radio', { name: /Do Not Disturb/ })).toHaveAttribute('title', 'Silences notifications');
  const heights = await rows(page).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
  const note = await card(page).locator('[class*="_note_"]').boundingBox();
  expect(Math.round(note!.height)).toBe(heights[0]);

  // Still usable: the note takes text, Esc closes.
  const input = card(page).getByRole('textbox', { name: 'Status note' });
  await input.fill('Heads down');
  await expect(input).toHaveValue('Heads down');
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
});

test('calm off: upstream’s card, header, colour and width unchanged', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('beluga.fork.calm.v1', JSON.stringify({ calm: false })));
  await openMenu(page);
  await shot(page, 'm6-status-calm-off');

  await expect(statusHead(page)).toBeVisible();
  await expect(statusHead(page).locator('[class*="_statusNow_"]')).not.toBeEmpty();
  const box = (await card(page).boundingBox())!;
  expect(Math.round(box.width)).toBe(300);

  // Colour and hints are upstream's; no title on the row.
  await expect(dots(page).first()).toBeVisible();
  await expect(hints(page).first()).toBeVisible();
  await expect(card(page).getByRole('radio', { name: /Do Not Disturb/ })).not.toHaveAttribute('title');
});
