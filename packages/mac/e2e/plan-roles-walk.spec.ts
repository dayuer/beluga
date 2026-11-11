import path from 'node:path';
import { expect, test, type Page } from './fixtures.js';
import { openWork } from './helpers.js';

/**
 * A walk through the plan's role screens (BLG-121), for its design review: New Plan › More options,
 * a role's pop-up, the plan's ••• menu and its submenus (the role ones moved to Plan Settings, BLG-123), How It Runs, Settings › Auto Route, in
 * English and Simplified Chinese, wide and narrow. Screenshots only: WALK=1 SHOTS=dir npx playwright test e2e/plan-roles-walk.spec.ts
 */

test.skip(!process.env.WALK, 'A screenshot walk for design reviews (WALK=1)');

const SHOTS = process.env.SHOTS ?? path.join(import.meta.dirname, '../../../.beluga/scratch/walk');
const main = (page: Page) => page.locator('main');
const shot = (name: string) => path.join(SHOTS, `${name}.png`);

async function openPlans(page: Page, lang: 'en' | 'zh-CN'): Promise<void> {
  await page.goto('/');
  await page.evaluate((l) => localStorage.setItem('beluga.language', l), lang);
  await page.reload();
  if (lang === 'en') return openWork(page, 'Plans');
  await page.getByRole('navigation', { name: '侧边栏' }).getByRole('button', { name: '工作', exact: true }).click();
  await page.getByRole('tablist', { name: '工作' }).getByRole('tab', { name: '计划' }).click();
}

for (const lang of ['en', 'zh-CN'] as const) {
  for (const width of [1440, 760]) {
    test(`walk ${lang} ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      const tag = `${lang}-${width}`;
      await page.setViewportSize({ width, height: 900 });
      await openPlans(page, lang);
      // The demo's plan lives in bob-api; New Plan from there.
      const newPlan = lang === 'en' ? 'New Plan' : '新建计划';
      await page.getByRole('button', { name: newPlan, exact: true }).first().click();
      const sheet = page.getByRole('dialog').last();
      await expect(sheet).toBeVisible();
      await sheet.screenshot({ path: shot(`01-new-plan-${tag}`) });
      await sheet.getByRole('button', { name: lang === 'en' ? 'More options' : '更多选项' }).click();
      await sheet.screenshot({ path: shot(`02-new-plan-more-${tag}`) });
      const combos = sheet.getByRole('combobox');
      const n = await combos.count();
      // The first role's pop-up (Architecture), open.
      await combos.nth(n - 4).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`03-role-popup-arch-${tag}`) });
      await page.keyboard.press('Escape');
      await combos.nth(n - 3).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`04-role-popup-work-${tag}`) });
      await page.keyboard.press('Escape');
      await sheet.getByRole('button', { name: lang === 'en' ? 'Cancel' : '取消' }).click();

      // The demo's running plan and its ••• menu.
      await main(page).getByRole('button', { name: /^Card checkout for launch[,，]/ }).click();
      await expect(main(page).locator('[data-ready="true"]')).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: shot(`05-plan-page-${tag}`) });
      await page.getByRole('button', { name: lang === 'en' ? 'Plan Options' : /计划选项|Plan Options/ }).click();
      const menu = page.getByRole('menu').first();
      await expect(menu).toBeVisible();
      await page.screenshot({ path: shot(`06-plan-menu-${tag}`) });
      const sub = async (en: string, zh: RegExp, name: string) => {
        await menu.getByRole('menuitem', { name: lang === 'en' ? en : zh }).hover();
        await page.waitForTimeout(400);
        await page.screenshot({ path: shot(`${name}-${tag}`) });
      };
      await sub('Agent for Its Work', /编码|工作|Agent for Its Work/, '07-menu-work');
      await sub('When to Run Tests', /测试|When to Run Tests/, '11-menu-tests');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      // How It Runs (the header's run-mode button).
      await main(page).getByRole('button', { name: /^(Runs on|运行于|运行方式)/ }).first().click({ timeout: 10_000 }).catch(() => undefined);
      const mode = page.getByRole('dialog').last();
      if (await mode.isVisible()) {
        await mode.getByRole('radio').nth(2).click();
        await mode.screenshot({ path: shot(`12-how-it-runs-${tag}`) });
        await page.keyboard.press('Escape');
      }

      // Settings › Auto Route.
      await page.keyboard.press('Meta+,');
      const settings = page.getByRole('dialog').last();
      await settings.getByRole('combobox').first().fill(lang === 'en' ? 'Auto Route' : '自动路由');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await page.screenshot({ path: shot(`13-auto-route-${tag}`) });
      const sw = settings.getByRole('switch', { name: /Pick a model for each task|自动为任务选模型/ });
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
      await page.waitForTimeout(500);
      await sw.scrollIntoViewIfNeeded();
      await page.screenshot({ path: shot(`14-auto-route-on-${tag}`) });
      await settings.getByText(/^(Plan Audits|计划审计)$/).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot(`15-auto-route-review-${tag}`) });
      // Leave it as the demo had it.
      await sw.click();
    });
  }
}
