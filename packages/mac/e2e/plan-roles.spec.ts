import path from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures.js';
import { openWork } from './helpers.js';

/**
 * Who does each part of a plan (fork, BLG-124): New Plan › More options starts each role as the tiers
 * say (with only Claude's subscription here: Opus designs, Haiku codes, Sonnet audits, Opus takes
 * over what's hard), and Plan Settings shows the same pop-ups with the same options in the same order.
 * Settings › Auto Route says which list plans use. Narrow too, nothing spilling out.
 */

const SHOTS = process.env.E2E_SHOTS ?? path.join(import.meta.dirname, '../../../.beluga/scratch');
const main = (page: Page) => page.locator('main');

async function openPlans(page: Page): Promise<void> {
  await page.goto('/');
  await openWork(page, 'Plans');
  if (!(await page.getByRole('button', { name: 'Project: bob-api' }).isVisible())) {
    await page.getByRole('button', { name: /^Project: / }).click();
    await page.getByRole('menuitem', { name: /bob-api/ }).click();
  }
}

/** A pop-up's options, in order, as their labels. */
async function optionsOf(page: Page, combo: Locator): Promise<string[]> {
  await combo.click();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  const labels = (await list.getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0]!.trim());
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  return labels;
}

/** Nothing inside `box` ends past its right edge. */
async function spills(box: Locator): Promise<string[]> {
  return box.evaluate((root) => {
    const edge = root.getBoundingClientRect().right + 0.5;
    return [...root.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > edge && el.getBoundingClientRect().width > 0).map((el) => `${el.tagName}: ${(el.textContent ?? '').slice(0, 30)}`);
  });
}

test('New Plan’s roles start as the tiers say, and Plan Settings shows the same pop-ups', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPlans(page);
  await page.getByRole('button', { name: 'New Plan', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /^Plan in / });
  await sheet.getByRole('button', { name: 'More options' }).click();
  const roles = sheet.getByRole('group', { name: 'Who does each part' });
  await expect(roles).toBeInViewport();
  await expect(roles.getByRole('combobox', { name: 'Architecture' })).toHaveText('Strongest: Claude (Opus)');
  await expect(roles.getByRole('combobox', { name: 'Coding' })).toHaveText('Everyday: Claude (Haiku)');
  await expect(roles.getByRole('combobox', { name: 'Audit' })).toHaveText('Mid-tier: Claude (Sonnet)');
  await expect(roles.getByRole('combobox', { name: 'Hard fixes' })).toHaveText('Strongest: Claude (Opus)');
  // The four pop-ups start at one edge.
  const lefts = await roles.getByRole('combobox').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
  const created: Record<string, string[]> = {};
  for (const role of ['Architecture', 'Coding', 'Audit', 'Hard fixes']) created[role] = await optionsOf(page, roles.getByRole('combobox', { name: role }));
  expect(created['Audit']!.slice(0, 2)).toEqual(['Mid-tier: Claude (Sonnet)', 'Same as its work']);
  expect(created['Architecture']!.slice(0, 2)).toEqual(['Strongest: Claude (Opus)', 'No architect (start right away)']);
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  // The demo's plan: Plan Settings, the same options in the same order.
  await main(page).getByRole('button', { name: /^Card checkout for launch,/ }).click();
  await page.getByRole('button', { name: 'Plan Options' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Plan Settings…' }).click();
  const settings = page.getByRole('dialog', { name: 'Plan Settings' });
  const same = settings.getByRole('group', { name: 'Who does each part' });
  for (const role of ['Architecture', 'Coding', 'Audit', 'Hard fixes']) expect(await optionsOf(page, same.getByRole('combobox', { name: role }))).toEqual(created[role]);
  await settings.getByRole('button', { name: 'Cancel' }).click();
});

test('narrow: New Plan, Plan Settings and the plan’s header keep to their edges', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await openPlans(page);
  await page.getByRole('button', { name: 'New Plan', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /^Plan in / });
  await sheet.getByRole('button', { name: 'More options' }).click();
  await expect(sheet.getByRole('group', { name: 'Who does each part' })).toBeInViewport();
  expect(await spills(sheet)).toEqual([]);
  await sheet.screenshot({ path: path.join(SHOTS, 'new-plan-roles-760.png') });
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  await main(page).getByRole('button', { name: /^Card checkout for launch,/ }).click();
  // The header: the name never sits under its actions.
  const name = await page.getByRole('textbox', { name: 'Plan name' }).boundingBox();
  const runs = await main(page).getByRole('button', { name: /^Runs on / }).boundingBox();
  expect(name && runs && (name.y + name.height <= runs.y + 1 || runs.x >= name.x + name.width - 1)).toBe(true);
  await main(page).locator('header').filter({ has: page.getByRole('textbox', { name: 'Plan name' }) }).screenshot({ path: path.join(SHOTS, 'plan-header-760.png') });

  await page.getByRole('button', { name: 'Plan Options' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Plan Settings…' }).click();
  const settings = page.getByRole('dialog', { name: 'Plan Settings' });
  expect(await spills(settings)).toEqual([]);
  await settings.screenshot({ path: path.join(SHOTS, 'plan-settings-760.png') });
  await settings.getByRole('button', { name: 'Cancel' }).click();
});

test('Settings › Auto Route: which list plans’ audits, design and hard fixes use, in words', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  await page.keyboard.press('Meta+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('combobox', { name: 'Search settings' }).fill('Auto Route');
  await page.keyboard.press('Enter');
  const on = settings.getByRole('switch', { name: 'Pick a model for each task' });
  const was = await on.getAttribute('aria-checked');
  if (was !== 'true') await on.click();
  await expect(settings.getByText('Plan Audits', { exact: true })).toBeVisible();
  await expect(settings.getByText('Its tasks, and plans’ design and hard fixes, start on the one marked Used now')).toBeVisible();
  // A candidate not set up here: its model and where, never its raw id.
  await expect(settings.getByRole('combobox').filter({ hasText: 'local:' })).toHaveCount(0);
  await settings.getByText('Plan Audits', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'auto-route-plan-audits.png') });
  if (was !== 'true') await on.click();
});
