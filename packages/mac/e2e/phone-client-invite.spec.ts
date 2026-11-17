import { expect, test } from './fixtures.js';

/**
 * Settings › Phone › Invite a customer (BLG-33): pick a project and how long the link lasts, and
 * Beluga asks the daemon for a pairing for that project (companion.pair.start with the project and
 * the time to live). The demo daemon has no network to listen on, so the pairing itself never opens
 * here: what's checked is the call, and that your own Pair a Phone… is left alone.
 */

test('Invite a customer asks for a pairing tied to the project', async ({ page }) => {
  const sent: string[] = [];
  page.on('websocket', (ws) => ws.on('framesent', (f) => sent.push(String(f.payload))));
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  await page.keyboard.press('Meta+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Phone', exact: true }).click();
  await expect(settings.getByRole('heading', { name: 'Invite a customer' })).toBeVisible();
  await expect(settings.getByRole('combobox', { name: 'Project' })).toBeVisible();
  await settings.getByRole('button', { name: 'Invite a customer…' }).click();
  await expect.poll(() => sent.find((p) => p.includes('companion.pair.start'))).toBeTruthy();
  const call = sent.find((p) => p.includes('companion.pair.start'))!;
  expect(call).toContain('"project"');
  // A day, the default.
  expect(call).toContain('86400000');
  // Your own phone's button stays the owner's: it asks for no project.
  await expect(settings.getByRole('button', { name: 'Pair a Phone…' })).toBeVisible();
});
