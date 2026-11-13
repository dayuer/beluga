import path from 'node:path';
import { expect, test, type Page } from './fixtures.js';

/**
 * One selected row in the sidebar (fork/sidebar/one-selected.ts): a conversation opened from Unread
 * shows there (kept while you're in it) and under its project, but only one of them is lit, and that
 * one is `aria-current="page"`.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const composer = (page: Page) => page.locator('textarea:not(.xterm-helper-textarea):not([aria-label="Plan name"]):not([aria-label="Message your agent about the plan"])');
const row = (page: Page, name: string) => sidebar(page).getByRole('button', { name, exact: true });
const projectRow = (page: Page, name: string) => sidebar(page).getByRole('button', { name, exact: true }).and(page.locator('[aria-expanded]'));

test('a conversation opened from Unread is lit once', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(sidebar(page)).toHaveAttribute('data-fork-sidebar', '');
  await expect(projectRow(page, 'landing')).toBeVisible();
  if (!(await row(page, 'new-hero').first().isVisible())) {
    const show = sidebar(page).getByRole('button', { name: "Show what's in landing" }).first();
    if (await show.isVisible()) await show.click();
  }
  await row(page, 'new-hero').first().click();
  await expect(composer(page)).toHaveAttribute('placeholder', /new-hero/);
  await composer(page).fill('Which session store should we pick for auth?');
  await composer(page).press('Enter');
  await expect(row(page, 'new-hero').first()).toHaveAttribute('data-signal-row', 'needs', { timeout: 30_000 });
  // Away from it, then back to it from Unread: open, it is in Unread (kept while you're in it) and under landing.
  await row(page, 'Overview').click();
  await page.mouse.move(900, 400);
  const unread = sidebar(page).getByRole('region', { name: 'Unread' });
  await unread.getByRole('button', { name: /^new-hero\b/ }).click();
  // Its question is open now (the composer asks for your answer).
  await expect(composer(page)).toHaveAttribute('placeholder', /answer/);
  await page.mouse.move(900, 400);

  // Both say they are selected; one is lit, the one you clicked.
  await expect(sidebar(page).getByRole('button', { name: /^new-hero\b/ })).toHaveCount(2, { timeout: 10_000 });
  await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(unread.locator('[aria-current="page"]')).toHaveAccessibleName(/^new-hero\b/);
  const dup = sidebar(page).locator('[data-fork-dup]');
  await expect(dup).toHaveCount(1);
  await expect(dup).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  if (process.env.SHOTS_DIR) await sidebar(page).screenshot({ path: path.join(process.env.SHOTS_DIR, 'sidebar-one-selected.png') });
});

test('New Task under the top entries opens the new task sheet', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).getByRole('button', { name: 'New Task…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Task' })).toBeVisible();
});
