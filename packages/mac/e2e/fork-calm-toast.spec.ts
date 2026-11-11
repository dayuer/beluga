import { expect, test, type Page } from './fixtures.js';

/**
 * One toast at a time (fork/calm/one-toast.ts, docs/calm/hooks.md §3). The app's toast and the
 * undo toast are two independent notices; under calm mode the later one replaces the earlier one
 * on the same spot, and the earlier one never comes back. With calm mode off both show, as
 * upstream does.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const toasts = (page: Page) => page.locator('[data-one-toast]');

/** Settings › Environment saves a variable and says so: a quick app toast, no project needed. */
async function savedToast(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Meta+,');
  const settings = page.getByRole('dialog');
  await settings.getByRole('button', { name: 'Environment', exact: true }).click();
  await settings.getByRole('button', { name: 'Add variable' }).click();
  await settings.getByLabel('Name', { exact: true }).last().fill(name);
  await settings.getByLabel(/^Value of/).last().fill('one line');
  // Saving happens when the row is done, so leave the name field.
  await settings.getByLabel('Name', { exact: true }).last().click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.keyboard.press('Escape');
}

test('a newer toast replaces the older one: the undo toast takes the app toast’s place', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();

  // The app's toast first …
  await savedToast(page, 'BELUGA_CALM_ONE');
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
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toHaveCount(0);

  // The hidden undo does nothing: ⌘Z leaves the project hidden.
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);
  await expect(sidebar(page).getByRole('button', { name: 'landing' })).toHaveCount(0);
});

test('with calm mode off both toasts show, as upstream does', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('beluga.fork.calm.v1', JSON.stringify({ calm: false })));
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();

  await savedToast(page, 'BELUGA_CALM_OFF');
  await sidebar(page).getByRole('button', { name: 'bob-api' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide Project' }).click();

  // Both together, each where it was: the app toast and the undo toast.
  await expect(toasts(page)).toHaveCount(2);
  await expect(page.locator('[data-one-toast="global"]')).toBeVisible();
  const undo = page.locator('[data-one-toast="undo"]').filter({ hasText: 'Hidden bob-api' });
  await expect(undo).toBeVisible();

  // And its Undo still works.
  await undo.getByRole('button', { name: 'Undo' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'bob-api' }).first()).toBeVisible();
});
