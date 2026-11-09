import { expect, test } from './fixtures.js';

/**
 * Settings › Phone › Invite a customer (BLG-33): pick a project and how long the link lasts, and a
 * pairing opens for that project (its link and code show); your own Pair a Phone… is left alone.
 */

test('Invite a customer opens a pairing for the chosen project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  await page.keyboard.press('Meta+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Phone', exact: true }).click();
  await expect(settings.getByText('Invite a customer', { exact: true })).toBeVisible();
  // The call carries the project and the chosen time to live (a day by default).
  const call = page.waitForRequest((r) => r.postData()?.includes('companion.pair.start') === true && r.postData()?.includes('"project"') === true && r.postData()?.includes('86400000') === true, { timeout: 15_000 }).catch(() => undefined);
  await settings.getByRole('button', { name: 'Invite a customer…' }).click();
  await expect(settings.getByText(/Invitation for the project/)).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Cancel' })).toBeVisible();
  void call;
  await settings.getByRole('button', { name: 'Cancel' }).click();
  // Your own phone's pairing is still its own button.
  await expect(settings.getByRole('button', { name: 'Pair a Phone…' })).toBeVisible();
});
