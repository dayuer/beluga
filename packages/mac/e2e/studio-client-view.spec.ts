import { expect, test } from './fixtures.js';
import { openWork } from './helpers.js';

/** A plan's page shows what a Synon Studio customer would see of it (M1): filtered, no paths or task keys. */

test('Customer view: the plan as a customer gets it, without paths, branches, models or keys', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await openWork(page, 'Plans');
  if (!(await page.getByRole('button', { name: 'Project: bob-api' }).isVisible())) {
    await page.getByRole('button', { name: /^Project: / }).click();
    await page.getByRole('menuitem', { name: /bob-api/ }).click();
  }
  await page.locator('main').getByRole('button', { name: /^Card checkout for launch,/ }).click();
  await expect(page.getByRole('textbox', { name: 'Plan name' })).toBeVisible();

  await page.locator('main').getByRole('button', { name: 'Customer view' }).click();
  const sheet = page.getByRole('dialog', { name: 'What the customer sees' });
  await expect(sheet).toBeVisible();
  const view = sheet.getByTestId('studio-client-view');
  await expect(view).toBeVisible();
  await expect(view.getByText('Milestones')).toBeVisible();

  const text = await view.innerText();
  expect(text).toContain('Card checkout');
  expect(text).not.toMatch(/\//);
  expect(text).not.toMatch(/\b[A-Z]{2,}-\d+\b/);
  expect(text).not.toMatch(/\.(?:ts|tsx|js|json|env)\b/);
  expect(text).not.toMatch(/\b(?:claude|opus|sonnet|haiku|fable|codex)\b/i);
  expect(text).not.toMatch(/\b(?:ws|conv)[:_]/);

  if (process.env.STUDIO_SHOT) await page.screenshot({ path: process.env.STUDIO_SHOT });
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
});
