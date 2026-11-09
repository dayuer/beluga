import { expect, test, type Page } from './fixtures.js';

/**
 * Settings › Appearance › Language (docs/superpowers/specs/2026-11-09-ui-i18n-design.md): the
 * window's own words switch at once, without a restart, and back.
 */

const shots = process.env.BELUGA_SHOTS;

async function pick(page: Page, combobox: string, option: string): Promise<void> {
  await page.getByRole('dialog').getByRole('combobox', { name: combobox }).click();
  await page.getByRole('option', { name: option }).click();
}

test('Simplified Chinese from Settings, then English again', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();

  await page.keyboard.press('Meta+,');
  const settings = page.getByRole('dialog');
  await settings.getByRole('button', { name: 'Appearance' }).click();
  await pick(page, 'Language', '简体中文');

  // Settings speaks Chinese at once; behind it, the sidebar and its menu button too.
  await expect(settings.getByRole('combobox', { name: '语言' })).toBeVisible();
  await expect(settings.getByRole('combobox', { name: '外观' })).toBeVisible();
  await expect(settings.getByRole('button', { name: '通用' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  if (shots) await page.screenshot({ path: `${shots}/01-language-zh.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const sidebar = page.getByRole('navigation', { name: '侧边栏' });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('button', { name: '设置与菜单' })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/02-sidebar-zh.png` });

  // Kept, and back to English from the same row.
  await page.keyboard.press('Meta+,');
  await settings.getByRole('button', { name: '外观' }).click();
  await pick(page, '语言', 'English');
  await expect(settings.getByRole('combobox', { name: 'Language' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
