import { expect, test, type Page } from './fixtures.js';

/**
 * One toast at a time (fork/calm/one-toast.ts, docs/calm/hooks.md §3). The app's toast and the
 * undo toast are two independent notices; under calm mode the later one replaces the earlier one
 * on the same spot, and the earlier one never comes back. With calm mode off both show, as
 * upstream does.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const toasts = (page: Page) => page.locator('[data-one-toast]');

/**
 * A quick app toast with no project needed: ⌘. (Stop the Agent) where no conversation is open
 * says why it can't run (lib/commands.ts runCommand). Settings › Environment only shows an inline
 * "Saved" (not the app toast), so it can't stand in for one.
 */
async function appToast(page: Page): Promise<void> {
  await page.keyboard.press('Meta+.');
  await expect(page.locator('[data-one-toast="global"]').filter({ hasText: 'Open a conversation' })).toBeVisible();
}

test('a newer toast replaces the older one: the undo toast takes the app toast’s place', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();

  // The app's toast first …
  await appToast(page);
  await expect(toasts(page)).toHaveCount(1);
  await expect(page.locator('[data-one-toast="global"]')).toBeVisible();

  // … then, within its few seconds, hiding a project puts up the undo toast.
  await sidebar(page).getByRole('button', { name: 'landing' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide Project' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'landing' })).toHaveCount(0);
  await expect(page.locator('[data-one-toast="undo"]').filter({ hasText: 'Hidden landing' })).toBeVisible();

  // One on screen — the newer one; the app toast is gone, not waiting behind it.
  await expect(toasts(page)).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'Hidden landing' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Open a conversation' })).toHaveCount(0);

  // The undo toast on screen is the live one: ⌘Z brings the project back.
  await page.keyboard.press('Meta+z');
  await expect(sidebar(page).getByRole('button', { name: 'landing' }).first()).toBeVisible();

  // The other way round: hide it again, then an app toast replaces the undo toast …
  await sidebar(page).getByRole('button', { name: 'landing' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide Project' }).click();
  await expect(page.locator('[data-one-toast="undo"]').filter({ hasText: 'Hidden landing' })).toBeVisible();
  await page.mouse.move(900, 450);
  await appToast(page);
  await expect(toasts(page)).toHaveCount(1);
  await expect(page.locator('[data-one-toast="undo"]')).toHaveCount(0);

  // … and the replaced undo does nothing: ⌘Z leaves the project hidden.
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);
  await expect(sidebar(page).getByRole('button', { name: 'landing' })).toHaveCount(0);
});

test('with calm mode off both toasts show, as upstream does', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('beluga.fork.calm.v1', JSON.stringify({ calm: false })));
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();

  // The undo toast first (it stays a good while); the app toast fades by itself within seconds, so it
  // goes second or it is gone before the menu has been used.
  await sidebar(page).getByRole('button', { name: 'bob-api' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide Project' }).click();
  await appToast(page);

  // Both together, each where it was: the app toast and the undo toast.
  await expect(toasts(page)).toHaveCount(2);
  await expect(page.locator('[data-one-toast="global"]')).toBeVisible();
  const undo = page.locator('[data-one-toast="undo"]').filter({ hasText: 'Hidden bob-api' });
  await expect(undo).toBeVisible();

  // And its Undo still works.
  await undo.getByRole('button', { name: 'Undo' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'bob-api' }).first()).toBeVisible();
});
