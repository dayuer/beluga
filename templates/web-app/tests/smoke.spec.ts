import { expect, test } from '@playwright/test';

test('首页能打开,清单能添加和删除', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '我的清单' })).toBeVisible();
  await page.getByPlaceholder('写点什么…').fill('买牛奶');
  await page.getByRole('button', { name: '添加' }).click();
  await expect(page.getByText('买牛奶')).toBeVisible();
  await page.screenshot({ path: 'test-results/home.png' });
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.getByText('还没有内容')).toBeVisible();
});

test('可添加到主屏幕:manifest 和 service worker 就绪', async ({ page }) => {
  await page.goto('/');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThan(0);
  const ready = await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active);
  expect(ready).toBe(true);
});
