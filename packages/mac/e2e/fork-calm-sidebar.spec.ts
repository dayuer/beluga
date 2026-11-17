import { expect, test, type Page } from './fixtures.js';

/**
 * The sidebar's order waits for you (fork/calm/hold-order.ts, docs/calm/hooks.md §1): while the
 * pointer is in the sidebar, a conversation turning "needs you" does not reorder the list under
 * your hand; 600 ms after you leave it does. With calm mode off it changes under the pointer, as
 * upstream does.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
// A conversation's message box (not a plan page's name or chat, which may still be leaving the screen).
const composer = (page: Page) => page.locator('textarea:not(.xterm-helper-textarea):not([aria-label="Plan name"]):not([aria-label="Message your agent about the plan"])');
const unreadSection = (page: Page) => sidebar(page).getByRole('region', { name: 'Unread' });
const row = (page: Page, name: string) => sidebar(page).getByRole('button', { name, exact: true });
const projectRow = (page: Page, name: string) => sidebar(page).getByRole('button', { name, exact: true }).and(page.locator('[aria-expanded]'));

async function openWorkspace(page: Page, name: string, project: string): Promise<void> {
  await expect(projectRow(page, project)).toBeVisible();
  if (!(await row(page, name).isVisible())) {
    const show = sidebar(page).getByRole('button', { name: `Show what's in ${project}` }).first();
    if (await show.isVisible()) await show.click();
  }
  await row(page, name).click();
  await expect(composer(page)).toHaveAttribute('placeholder', new RegExp(name));
}

/** The Unread list as it shows: each row's name and where it sits. A reorder shows up here. */
async function unreadRows(page: Page): Promise<{ name: string; y: number }[]> {
  const rows = unreadSection(page).locator('[data-signal-row]');
  const out: { name: string; y: number }[] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const item = rows.nth(i);
    const box = await item.boundingBox();
    out.push({ name: (await item.getAttribute('aria-label')) ?? '', y: box ? Math.round(box.y) : -1 });
  }
  return out;
}

/** A question in new-hero, asked once the pointer is already resting in the sidebar. */
async function askInNewHero(page: Page): Promise<void> {
  await openWorkspace(page, 'new-hero', 'landing');
  await composer(page).fill('Which session store should we pick for auth?');
  // Into the sidebar first: the hold must already be on when the conversation starts waiting.
  await page.mouse.move(40, 300);
}

test('a conversation turning needs-you waits while the pointer is in the sidebar', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  await askInNewHero(page);
  const before = await unreadRows(page);

  await composer(page).press('Enter');
  const hero = row(page, 'new-hero');
  await expect(hero).toHaveAttribute('data-signal-row', 'needs', { timeout: 30_000 });

  // It needs you now, but the list stays exactly as it was under the pointer …
  expect(await unreadRows(page)).toEqual(before);
  await page.waitForTimeout(800); // past the grace period, and the pointer is still in
  expect(await unreadRows(page)).toEqual(before);

  // … and only leaving the sidebar brings the new order in.
  await page.mouse.move(900, 450);
  await expect.poll(async () => JSON.stringify(await unreadRows(page)), { timeout: 10_000 }).not.toBe(JSON.stringify(before));

  // Answer it, so the next test starts from a conversation that isn't waiting (one demo daemon per worker).
  await row(page, 'new-hero').click();
  await page.getByRole('button', { name: /Signed cookies/ }).click();
  await expect(row(page, 'new-hero')).not.toHaveAttribute('data-signal-row', 'needs', { timeout: 30_000 });
});

test('with calm mode off the order changes under the pointer, as upstream does', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('beluga.fork.calm.v1', JSON.stringify({ calm: false })));
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  await askInNewHero(page);
  const before = await unreadRows(page);

  await composer(page).press('Enter');
  await expect(row(page, 'new-hero')).toHaveAttribute('data-signal-row', 'needs', { timeout: 30_000 });

  // No wait to leave: the list changes while the pointer is still in the sidebar.
  await expect.poll(async () => JSON.stringify(await unreadRows(page)), { timeout: 10_000 }).not.toBe(JSON.stringify(before));
});
