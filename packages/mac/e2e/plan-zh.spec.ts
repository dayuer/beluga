import path from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures.js';

/**
 * Plan roles and Plan Settings in Simplified Chinese (fork, BLG-125): New Plan with More options open,
 * Plan Settings, the plan's ••• menu, and Settings › Auto Route show no English but names (models,
 * agents, the project and the plan's title). Changing the audit agent and when tests run in Plan
 * Settings says so in Chinese, in its toast and in the plan's feed. Screenshots in the scratch folder.
 */

const SHOTS = process.env.E2E_SHOTS ?? path.join(import.meta.dirname, '../../../.beluga/scratch');
const main = (page: Page) => page.locator('main');

/** Names that stay as they are: models and agents, the demo's project and plan, things like Mac and Markdown. */
const NAMES = /Card checkout for launch|bob-api|Claude|Opus|Sonnet|Haiku|Codex|OpenCode|Copilot|GLM|DeepSeek|Deepseek|Glm|flash|Mac|Markdown|Issue|Actions|Overview|\d+(\.\d+)?/g;

/** The English words left in what `box` shows. */
async function english(box: Locator): Promise<string[]> {
  const text = (await box.innerText()).replace(/“[^”]*”/g, '').replace(NAMES, '');
  return [...new Set(text.match(/[A-Za-z]{2,}/g) ?? [])];
}

async function openPlans(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('beluga.language', 'zh-CN'));
  await page.reload();
  await page.getByRole('navigation', { name: '侧边栏' }).getByRole('button', { name: '工作', exact: true }).click();
  await page.getByRole('tablist', { name: '工作' }).getByRole('tab', { name: '计划' }).click();
}

test('New Plan, Plan Settings, the ••• menu and Auto Route speak Chinese; a change says so in Chinese', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPlans(page);

  // New Plan, More options open.
  await page.getByRole('button', { name: '新建计划', exact: true }).click();
  const sheet = page.getByRole('dialog').last();
  await sheet.getByRole('button', { name: '更多选项' }).click();
  await expect(sheet.getByRole('group', { name: '谁来做哪部分' })).toBeVisible();
  await expect(sheet.getByRole('group', { name: '谁来做哪部分' }).getByRole('combobox', { name: '审计' })).toContainText('中级：Claude (Sonnet)');
  expect(await english(sheet)).toEqual([]);
  await sheet.screenshot({ path: path.join(SHOTS, 'zh-new-plan.png') });
  await sheet.getByRole('button', { name: '取消' }).click();

  // The plan's ••• menu.
  await main(page).getByRole('button', { name: /^Card checkout for launch[,，]/ }).click();
  await page.getByRole('button', { name: '计划选项' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: '计划设置…' })).toBeVisible();
  expect(await english(menu)).toEqual([]);
  await page.screenshot({ path: path.join(SHOTS, 'zh-plan-menu.png') });

  // Plan Settings: in Chinese; change the audit agent and when tests run.
  await menu.getByRole('menuitem', { name: '计划设置…' }).click();
  const settings = page.getByRole('dialog', { name: '计划设置' });
  await expect(settings).toBeVisible();
  expect(await english(settings)).toEqual([]);
  await settings.screenshot({ path: path.join(SHOTS, 'zh-plan-settings.png') });
  await settings.getByRole('group', { name: '谁来做哪部分' }).getByRole('combobox', { name: '审计' }).click();
  await page.getByRole('option', { name: /^Claude · Opus/ }).click();
  await settings.getByRole('combobox', { name: '何时运行测试' }).click();
  await page.getByRole('option', { name: /仅在最后/ }).click();
  await settings.getByRole('button', { name: '保存' }).click();
  const toast = page.getByRole('status').filter({ hasText: '计划设置已保存' });
  await expect(toast).toBeVisible();
  expect(await english(toast)).toEqual([]);
  await expect(toast).toContainText('Claude (Opus) 负责审计这个计划的里程碑');
  await page.screenshot({ path: path.join(SHOTS, 'zh-toast.png') });

  // The feed says what changed, in Chinese.
  await main(page).getByRole('button', { name: '发生了什么', exact: true }).click();
  const feed = page.getByRole('complementary', { name: '发生了什么' });
  await expect(feed).toContainText('从现在起把审计交给 Claude (Opus)');
  await expect(feed).toContainText('只在最后一步运行测试套件');
  await feed.screenshot({ path: path.join(SHOTS, 'zh-feed.png') });
  await page.keyboard.press('Escape');

  // Settings › Auto Route: its groups.
  await page.keyboard.press('Meta+,');
  const prefs = page.getByRole('dialog').last();
  await prefs.getByRole('combobox').first().fill('自动路由');
  await page.keyboard.press('Enter');
  const on = prefs.getByRole('switch', { name: '自动为任务选模型' });
  const was = await on.getAttribute('aria-checked');
  if (was !== 'true') await on.click();
  for (const group of ['自动路由', '疑难任务', '其他任务', '计划审计']) {
    const box = prefs.locator('section').filter({ has: page.getByRole('heading', { name: group, exact: true }) });
    await expect(box).toBeVisible();
    expect(await english(box), group).toEqual([]);
  }
  await prefs.locator('section').filter({ has: page.getByRole('heading', { name: '计划审计', exact: true }) }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'zh-auto-route.png') });
  if (was !== 'true') await on.click();
});
